"use client";

import { useState, useEffect, useMemo, Suspense, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, RotateCcw, X, ExternalLink, MapPin, Home, Clock, Bus, Shield, ArrowUpRight, ArrowDownRight, Sparkles, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import KakaoMap, { type KakaoMapMarker } from "@/components/KakaoMap";
import PropertyListCard from "@/components/PropertyListCard";
import { supabase } from "@/lib/supabase";
import {
  computeStatsWithCommute,
  toFeatureVector,
  getMeanWeightLabels,
  FEATURE_NAMES,
} from "@/lib/feature-engineer";
import {
  createModel,
  updateModel,
  scoreProperty,
  getMeanWeight,
  userWeightsToPrior,
  type RewardModel,
} from "@/lib/reward-model";
import { calcWalkRoute } from "@/lib/gate-distance";
import { computeRoundMetrics, type RoundMetrics } from "@/lib/convergence";
import { getMaxExpectedVolumeRemoval } from "@/lib/query-selector";
import { posteriorConcentration } from "@/lib/reward-model";
import ConvergenceChart from "@/components/ConvergenceChart";
import type { Property, Comparison, Building, Amenity } from "@/types";
import {
  loadAmenitiesByTypes,
  calcNearestAmenities,
  calcAmenityProximityScore,
  type NearestAmenity,
} from "@/lib/amenities";

const PAGE_SIZE = 10;
const BUSAN_UNIV = { lat: 35.2340, lng: 129.0800 };

interface ScoredProperty {
  property: Property;
  score: number;
  walkMin?: number;
  nearestAmenities?: NearestAmenity[];
}

function priceLabel(p: Property): string {
  if (p.trade_type === "전세") return `전세 ${p.deposit.toLocaleString()}만`;
  return `월세 ${p.monthly_rent}만/월`;
}

function pyeong(area: number): string {
  return `실${(area / 3.3058).toFixed(1)}평`;
}

function buildYearLabel(p: Property): string {
  if (p.within_4y) return "4년 이내";
  if (p.within_10y) return "10년 이내";
  if (p.within_15y) return "15년 이내";
  if (p.within_25y) return "25년 이내";
  return "25년 초과";
}

function optionTags(p: Property): string[] {
  const tags: string[] = [];
  if (p.has_elevator) tags.push("엘리베이터");
  if (p.has_cctv) tags.push("CCTV");
  if (p.has_entrance_security) tags.push("현관보안");
  if (p.has_closet || p.has_builtin_closet) tags.push("수납공간");
  if (p.parking) tags.push("주차가능");
  return tags;
}

function explainCacheKey(
  sessionId: string,
  buildingId: string,
  topItems: ScoredProperty[],
  compCount: number,
): string {
  const topIds = topItems.slice(0, 3).map((x) => x.property.id).join(",");
  return `explain:${sessionId}:${buildingId}:${compCount}:${topIds}`;
}

function ResultsContent() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session") ?? "";
  const buildingId = params.get("building") ?? "";
  const minRent = Number(params.get("minRent") ?? 0);
  const maxRent = Number(params.get("maxRent") ?? 999);
  const minDeposit = Number(params.get("minDeposit") ?? 0);
  const maxDeposit = Number(params.get("maxDeposit") ?? 99999);
  const weightsParam = params.get("weights");
  /** v2 계층 모델에서 전달된 순위 ID (콤마 구분) */
  const topIdsParam = params.get("topIds");
  /** v2 선택 카테고리 레이블 */
  const categoryParam = params.get("category");
  const isV2 = Boolean(topIdsParam);
  /** 선택된 편의시설 타입 목록 */
  const amenityTypesParam = params.get("amenityTypes") ?? "";
  const amenityTypes = amenityTypesParam ? amenityTypesParam.split(",").filter(Boolean) : [];

  const [ranked, setRanked] = useState<ScoredProperty[]>([]);
  const [building, setBuilding] = useState<Building | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [weightLabels, setWeightLabels] = useState<Array<{ name: string; value: number }>>([]);
  const [initialWeightLabels, setInitialWeightLabels] = useState<Array<{ name: string; value: number }>>([]);

  const [detailProperty, setDetailProperty] = useState<Property | null>(null);
  const [roundMetrics, setRoundMetrics] = useState<RoundMetrics[]>([]);

  interface Explanation {
    summary?: string;
    whyTop1?: string[];
    top1VsTop2?: string[];
    weightShift?: string[];
    caveat?: string;
  }

  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const explainInflightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    async function init() {
      let propsQuery = supabase.from("properties").select("*")
        .gte("monthly_rent", minRent)
        .lte("monthly_rent", maxRent);
      if (minDeposit > 0) propsQuery = propsQuery.gte("deposit", minDeposit);
      if (maxDeposit < 99999) propsQuery = propsQuery.lte("deposit", maxDeposit);

      const [{ data: bld }, { data: comparisons }, { data: props }] = await Promise.all([
        supabase.from("buildings").select("*").eq("id", buildingId).single(),
        isV2
          ? Promise.resolve({ data: [] as unknown[] })  // v2는 comparisons 불필요
          : supabase
              .from("comparisons")
              .select("*")
              .eq("session_id", sessionId)
              .order("round", { ascending: true }),
        propsQuery,
      ]);

      if (bld) setBuilding(bld as Building);
      if (!comparisons || !props || props.length === 0 || !bld) {
        setLoading(false);
        return;
      }

      const typed = props as Property[];
      const comps = comparisons as Comparison[];
      const { stats, commuteById } = await computeStatsWithCommute(typed, bld as Building);

      // Compute initial weights from user preferences
      let userWeights: Record<string, number> | undefined;
      if (weightsParam) {
        try { userWeights = JSON.parse(weightsParam); } catch { /* ignore */ }
      }
      const initialPrior = userWeightsToPrior(userWeights);
      const initialLabels = FEATURE_NAMES.map((name, i) => ({
        name,
        value: initialPrior[i] ?? 0,
      }));
      setInitialWeightLabels(initialLabels);

      let model: RewardModel = createModel(undefined, userWeights);
      const propMap = new Map(typed.map((p) => [p.id, p]));
      const metricsHistory: RoundMetrics[] = [];
      let topKHistory: string[][] = [];

      for (let ci = 0; ci < comps.length; ci++) {
        const c = comps[ci];
        const pA = propMap.get(c.property_a);
        const pB = propMap.get(c.property_b);
        if (!pA || !pB) continue;
        const winner = c.preferred === "a" ? pA : pB;
        const loser = c.preferred === "a" ? pB : pA;
        model = updateModel(
          model,
          toFeatureVector(winner, stats, commuteById.get(winner.id)),
          toFeatureVector(loser, stats, commuteById.get(loser.id)),
        );

        const m = computeRoundMetrics(
          model, typed, stats, ci + 1, topKHistory,
          commuteById ?? undefined,
        );
        metricsHistory.push(m);
        topKHistory = [...topKHistory, typed
          .map((p) => ({ id: p.id, s: scoreProperty(model, toFeatureVector(p, stats, commuteById.get(p.id))) }))
          .sort((a, b) => b.s - a.s)
          .slice(0, 5)
          .map((x) => x.id),
        ];
      }
      setRoundMetrics(metricsHistory);

      let scored: ScoredProperty[];
      if (isV2 && topIdsParam) {
        // v2: topIds 순서대로 우선 정렬, 나머지는 뒤에 붙임
        const topIds = topIdsParam.split(",").filter(Boolean);
        const topIdSet = new Set(topIds);
        const propMap = new Map(typed.map((p) => [p.id, p]));
        const topProps: ScoredProperty[] = topIds
          .map((id, rank) => {
            const p = propMap.get(id);
            if (!p) return null;
            return { property: p, score: 1 - rank / topIds.length };
          })
          .filter((x): x is ScoredProperty => x !== null);
        const rest: ScoredProperty[] = typed
          .filter((p) => !topIdSet.has(p.id))
          .map((p) => ({ property: p, score: 0 }));
        scored = [...topProps, ...rest];
      } else {
        scored = typed.map((p) => ({
          property: p,
          score: scoreProperty(model, toFeatureVector(p, stats, commuteById.get(p.id))),
        }));
        scored.sort((a, b) => b.score - a.score);
      }

      // 같은 위치(lat/lng 소수점 4자리) 중복 매물 제거: 순위가 높은 것만 유지
      const seenLocations = new Set<string>();
      const deduped = scored.filter((s) => {
        const locKey = `${s.property.lat.toFixed(4)}_${s.property.lng.toFixed(4)}`;
        if (seenLocations.has(locKey)) return false;
        seenLocations.add(locKey);
        return true;
      });

      const minScore = deduped[deduped.length - 1]?.score ?? 0;
      const maxScore = deduped[0]?.score ?? 1;
      const range = maxScore - minScore || 1;
      const normalized = deduped.map((s) => ({
        ...s,
        score: isV2 ? s.score : (s.score - minScore) / range,
      }));

      const walkResults = await Promise.all(
        normalized.map((s) => calcWalkRoute(s.property, buildingId).catch(() => null)),
      );
      for (let i = 0; i < normalized.length; i++) {
        if (walkResults[i]) normalized[i].walkMin = walkResults[i]!.totalWalkMin;
      }

      // 편의시설 로딩 및 점수 반영
      if (amenityTypes.length > 0) {
        const amenities = await loadAmenitiesByTypes(amenityTypes);
        if (amenities.length > 0) {
          const nearestMap = calcNearestAmenities(
            normalized.map((s) => s.property),
            amenities,
          );
          const AMENITY_WEIGHT = 0.15; // 15% 가중치
          for (const item of normalized) {
            const nearest = nearestMap.get(item.property.id) ?? [];
            item.nearestAmenities = nearest;
            const amenityScore = calcAmenityProximityScore(nearest);
            item.score = item.score * (1 - AMENITY_WEIGHT) + amenityScore * AMENITY_WEIGHT;
          }
          // 편의시설 반영 후 재정렬
          normalized.sort((a, b) => b.score - a.score);
        }
      }

      setRanked(normalized);

      const w = getMeanWeight(model);
      const labels = getMeanWeightLabels(w);
      setWeightLabels(labels);

      setLoading(false);

      const wc = labels.map((learned) => {
        const ini = initialLabels.find((iw) => iw.name === learned.name);
        const initialVal = ini?.value ?? 0;
        return { name: learned.name, initial: initialVal, final: learned.value, delta: learned.value - initialVal };
      });
      fetchExplanation(normalized, (bld as Building).name, wc, comps.length);
    }
    init();
  }, [sessionId, buildingId, minRent, maxRent, minDeposit, maxDeposit, weightsParam]);

  async function fetchExplanation(
    topItems: ScoredProperty[],
    bldName: string,
    wc: Array<{ name: string; initial: number; final: number; delta: number }>,
    compCount: number,
  ) {
    const cacheKey = explainCacheKey(sessionId, buildingId, topItems, compCount);
    if (typeof window !== "undefined") {
      const cached = window.sessionStorage.getItem(cacheKey);
      if (cached) {
        try {
          setExplanation(JSON.parse(cached) as Explanation);
          setExplainError(null);
          return;
        } catch {
          // Ignore corrupted cache and continue with network request.
        }
      }
    }

    if (explainInflightRef.current.has(cacheKey)) return;
    explainInflightRef.current.add(cacheKey);

    setExplainLoading(true);
    setExplainError(null);
    try {
      const topProperties = topItems.slice(0, 3).map((item, i) => ({
        rank: i + 1,
        price: priceLabel(item.property),
        deposit: `${item.property.deposit.toLocaleString()}만`,
        area: pyeong(item.property.exclusive_area),
        rooms: item.property.rooms,
        direction: item.property.direction || "-",
        year: buildYearLabel(item.property),
        walkMin: item.walkMin ?? null,
        busMin: item.property.bus_to_gate_min ?? null,
        options: optionTags(item.property),
        address: item.property.address,
        score: Math.round(item.score * 100),
      }));

      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buildingName: bldName,
          topProperties,
          weightChanges: wc.slice(0, 8),
          totalComparisons: compCount,
        }),
      });
      const data = await res.json();
      if (data.ok && data.explanation) {
        const parsed = data.explanation as Explanation;
        setExplanation(parsed);
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(cacheKey, JSON.stringify(parsed));
        }
      } else {
        setExplainError(data.error ?? "설명 생성 실패");
      }
    } catch (e) {
      setExplainError(`요청 실패: ${String(e)}`);
    } finally {
      explainInflightRef.current.delete(cacheKey);
      setExplainLoading(false);
    }
  }

  function handleCardClick(propertyId: string) {
    const found = ranked.find((r) => r.property.id === propertyId);
    if (found) setDetailProperty(found.property);
  }

  const pageItems = ranked.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(ranked.length / PAGE_SIZE);

  const mapMarkers: KakaoMapMarker[] = useMemo(() => {
    const markers: KakaoMapMarker[] = [];
    pageItems.forEach((item, i) => {
      const rank = page * PAGE_SIZE + i + 1;
      markers.push({
        lat: item.property.lat,
        lng: item.property.lng,
        label: `${rank}위`,
        color: i === 0 ? "red" : "blue",
      });
    });
    if (building) {
      markers.push({ lat: building.lat, lng: building.lng, label: building.name, color: "star" });
    }
    // 선택된 편의시설 최근접 위치 마커 (light = 노란 점)
    if (amenityTypes.length > 0) {
      const seenAmenityPos = new Set<string>();
      for (const item of pageItems) {
        for (const na of item.nearestAmenities ?? []) {
          const posKey = `${na.lat.toFixed(5)}_${na.lng.toFixed(5)}`;
          if (seenAmenityPos.has(posKey)) continue;
          seenAmenityPos.add(posKey);
          markers.push({
            lat: na.lat,
            lng: na.lng,
            label: `${na.icon}${na.label}`,
            color: "light",
            excludeFromBounds: true,
          });
        }
      }
    }
    return markers;
  }, [pageItems, building, page, amenityTypes]);

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-gray-400 animate-pulse">결과 생성 중…</p>
      </main>
    );
  }

  // Build initial vs final comparison data
  const weightComparison = weightLabels.map((learned) => {
    const initial = initialWeightLabels.find((iw) => iw.name === learned.name);
    const initialVal = initial?.value ?? 0;
    const delta = learned.value - initialVal;
    return { name: learned.name, initial: initialVal, final: learned.value, delta };
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col">
      <div className="relative h-[40vh] w-full shrink-0">
        <KakaoMap
          center={building ? { lat: building.lat, lng: building.lng } : BUSAN_UNIV}
          level={5}
          markers={mapMarkers}
          className="absolute inset-0"
          autoFit
          fitPadding={60}
        />
      </div>

      <div className="flex-1 px-4 py-5">
        {/* v2 결과 배너 */}
        {isV2 && categoryParam && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3"
          >
            <p className="text-xs font-semibold text-blue-700">
              AI 선호 학습 완료 · 선택 카테고리: <span className="font-bold">{categoryParam}</span>
            </p>
            <p className="mt-0.5 text-[11px] text-blue-600">
              계층적 추천 모델 v2가 분석한 맞춤 순위입니다
            </p>
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5"
        >
          <button
            className="mb-2 flex items-center gap-1 text-sm text-gray-400"
            onClick={() => router.back()}
          >
            <ArrowLeft className="size-4" />
            비교로 돌아가기
          </button>
          <h1 className="text-xl font-bold tracking-tight">추천 결과</h1>
          <p className="mt-1 text-sm text-gray-500">
            학습된 선호도 기반 · 필터 범위 매물 {ranked.length}개 중 순위화
            {building && ` · ${building.name} 기준`}
          </p>
        </motion.div>

        {/* Weight comparison: Initial vs Learned */}
        {weightComparison.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-5 rounded-2xl border bg-gray-50 p-4"
          >
            <p className="mb-3 text-xs font-semibold text-gray-500">선호도 변화 (초기 → 학습)</p>
            <div className="space-y-2">
              {weightComparison.slice(0, 10).map(({ name, initial, final: fin, delta }) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-xs text-gray-500">{name}</span>
                  <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
                    <div
                      className={`absolute inset-y-0 rounded-full ${fin >= 0 ? "left-1/2 bg-blue-500" : "right-1/2 bg-red-400"}`}
                      style={{ width: `${Math.min(Math.abs(fin) * 50, 50)}%` }}
                    />
                    <div
                      className={`absolute inset-y-0 rounded-full border-2 ${initial >= 0 ? "left-1/2 border-blue-300" : "right-1/2 border-red-300"}`}
                      style={{ width: `${Math.min(Math.abs(initial) * 50, 50)}%`, background: "transparent" }}
                    />
                  </div>
                  <span className="flex w-14 shrink-0 items-center justify-end gap-0.5 text-right text-xs tabular-nums">
                    {Math.abs(delta) > 0.01 ? (
                      <>
                        {delta > 0 ? (
                          <ArrowUpRight className="size-3 text-green-500" />
                        ) : (
                          <ArrowDownRight className="size-3 text-red-400" />
                        )}
                        <span className={delta > 0 ? "text-green-600" : "text-red-500"}>
                          {delta > 0 ? "+" : ""}{delta.toFixed(2)}
                        </span>
                      </>
                    ) : (
                      <span className="text-gray-400">{fin.toFixed(2)}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-gray-400">
              테두리: 초기 가중치 · 채움: 학습 후 가중치
            </p>
          </motion.div>
        )}

        {/* Convergence metrics chart */}
        {roundMetrics.length >= 2 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="mb-5 rounded-2xl border bg-gray-50 p-4"
          >
            <p className="mb-3 text-xs font-semibold text-gray-500">수렴 지표 변화</p>
            <ConvergenceChart data={roundMetrics} />
          </motion.div>
        )}

        {/* AI Explanation */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mb-5 rounded-2xl border bg-gradient-to-br from-indigo-50 to-white p-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600">
              <Sparkles className="size-3.5" />
              AI 분석
            </p>
            {!explainLoading && (
              <button
                onClick={() => {
                  if (ranked.length > 0 && building) {
                    fetchExplanation(ranked, building.name, weightComparison, ranked.length);
                  }
                }}
                className="rounded-full p-1 text-gray-400 hover:bg-indigo-100 hover:text-indigo-600 transition"
              >
                <RefreshCw className="size-3.5" />
              </button>
            )}
          </div>

          {explainLoading && (
            <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
              <Loader2 className="size-4 animate-spin" />
              분석 중...
            </div>
          )}

          {explainError && (
            <p className="text-xs text-red-400">{explainError}</p>
          )}

          {explanation && !explainLoading && (
            <div className="space-y-3 text-sm text-gray-700">
              {explanation.summary && (
                <p className="font-semibold text-gray-900">{explanation.summary}</p>
              )}

              {explanation.whyTop1 && explanation.whyTop1.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-indigo-500">1위 선택 이유</p>
                  <ul className="space-y-0.5 text-xs">
                    {explanation.whyTop1.map((r, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className="mt-0.5 text-indigo-400">•</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {explanation.top1VsTop2 && explanation.top1VsTop2.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-indigo-500">1위 vs 2위 핵심 차이</p>
                  <ul className="space-y-0.5 text-xs">
                    {explanation.top1VsTop2.map((d, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className="mt-0.5 text-indigo-400">•</span>
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {explanation.weightShift && explanation.weightShift.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-indigo-500">가중치 변화 해석</p>
                  <ul className="space-y-0.5 text-xs">
                    {explanation.weightShift.map((w, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className="mt-0.5 text-indigo-400">•</span>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {explanation.caveat && (
                <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">
                  {explanation.caveat}
                </p>
              )}
            </div>
          )}
        </motion.div>

        {/* Property list */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="flex flex-col gap-3"
        >
          {pageItems.map((item, i) => (
            <PropertyListCard
              key={item.property.id}
              property={item.property}
              rank={page * PAGE_SIZE + i + 1}
              score={item.score}
              walkMin={item.walkMin}
              nearestAmenities={item.nearestAmenities}
              onClick={() => handleCardClick(item.property.id)}
            />
          ))}
        </motion.div>

        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              이전
            </Button>
            <span className="text-sm text-gray-400">{page + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
              다음
            </Button>
          </div>
        )}

        <div className="mt-8 mb-6 flex justify-center">
          <Button variant="outline" className="gap-2" onClick={() => router.push("/")}>
            <RotateCcw className="size-4" />
            처음부터 다시 하기
          </Button>
        </div>
      </div>

      {/* Property detail modal - uses our own DB data */}
      <AnimatePresence>
        {detailProperty && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDetailProperty(null)}
          >
            <motion.div
              className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl"
              style={{ maxHeight: "75vh" }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-bold">매물 상세 정보</h3>
                <button onClick={() => setDetailProperty(null)} className="rounded-full p-1 text-gray-400 hover:bg-gray-100">
                  <X className="size-5" />
                </button>
              </div>

              <div className="overflow-y-auto space-y-4" style={{ maxHeight: "calc(75vh - 80px)" }}>
                {/* Price header */}
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    {priceLabel(detailProperty)}
                  </h2>
                  {detailProperty.trade_type !== "전세" && (
                    <p className="text-sm text-gray-500">보증금 {detailProperty.deposit.toLocaleString()}만</p>
                  )}
                  <p className="mt-0.5 flex items-center gap-1 text-sm text-gray-500">
                    <MapPin className="size-3.5 shrink-0" />
                    {detailProperty.address}
                  </p>
                </div>

                {/* Info grid */}
                <div className="grid grid-cols-3 gap-3">
                  <InfoCell icon={<Home className="size-4" />} label="실평수" value={pyeong(detailProperty.exclusive_area)} />
                  <InfoCell icon={<Home className="size-4" />} label="방" value={`${detailProperty.rooms}개`} />
                  <InfoCell icon={<Home className="size-4" />} label="방향" value={detailProperty.direction || "-"} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <InfoCell icon={<Clock className="size-4" />} label="관리비" value={`${(detailProperty.maintenance_fee / 10000).toFixed(1)}만`} />
                  <InfoCell icon={<Home className="size-4" />} label="년식" value={buildYearLabel(detailProperty)} />
                  <InfoCell icon={<Home className="size-4" />} label="유형" value={detailProperty.property_type} />
                </div>

                {/* Walk / Bus info */}
                {(detailProperty.walk_to_gate_min != null || detailProperty.bus_to_gate_min != null) && (
                  <div className="rounded-xl bg-gray-50 p-3">
                    <p className="mb-2 text-xs font-semibold text-gray-500">이동 정보</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                      {detailProperty.walk_to_gate_min != null && detailProperty.walk_to_gate_min > 0 && (
                        <span className="flex items-center gap-1.5">
                          <Clock className="size-4 text-green-600" />
                          도보 {Math.round(detailProperty.walk_to_gate_min)}분
                          {detailProperty.walk_to_gate_m != null && (
                            <span className="text-xs text-gray-400">({(detailProperty.walk_to_gate_m / 1000).toFixed(1)}km)</span>
                          )}
                        </span>
                      )}
                      {detailProperty.bus_to_gate_min != null && detailProperty.bus_to_gate_min > 0 && (
                        <span className="flex items-center gap-1.5">
                          <Bus className="size-4 text-emerald-600" />
                          버스 {Math.round(detailProperty.bus_to_gate_min)}분
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Option tags */}
                {optionTags(detailProperty).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {optionTags(detailProperty).map((tag) => (
                      <span
                        key={tag}
                        className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
                      >
                        <Shield className="size-3" />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Naver link */}
                <a
                  href={`https://new.land.naver.com/rooms?articleNo=${detailProperty.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm font-medium text-blue-600"
                >
                  네이버 부동산에서 보기
                  <ExternalLink className="size-3.5" />
                </a>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

function InfoCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl bg-gray-50 py-3">
      <span className="text-gray-400">{icon}</span>
      <span className="text-[11px] text-gray-400">{label}</span>
      <span className="text-sm font-semibold text-gray-800">{value}</span>
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense>
      <ResultsContent />
    </Suspense>
  );
}
