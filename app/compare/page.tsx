"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import KakaoMap, { type KakaoMapMarker, type KakaoMapPolyline } from "@/components/KakaoMap";
import ProgressBar from "@/components/ProgressBar";
import { Button } from "@/components/ui/button";
import { X, GitCompareArrows, Route } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { calcTransitForDisplay, type TransitResult } from "@/lib/transit-calculator";
import { loadStreetLights, filterLightsAlongRoute, calcStreetLightDensity } from "@/lib/street-lights";
import {
  computeStatsWithCommute,
  mergeCommuteFeatures,
  toFeatureVector,
  type CommuteFeatures,
  type FeatureStats,
} from "@/lib/feature-engineer";
import { createModel, updateModel, type RewardModel } from "@/lib/reward-model";
import { selectPair } from "@/lib/query-selector";
import { createConvergenceState, checkConvergence, type ConvergenceState } from "@/lib/convergence";
import type { Property, Building, StreetLight } from "@/types";
import {
  formatCompareError,
  logCompare,
  logCompareError,
  withTimeout,
} from "@/lib/compare-log";

const MIN_ROUNDS = 5;
const MAX_ROUNDS = 25;
const BUSAN_UNIV = { lat: 35.2340, lng: 129.0800 };
const ENRICH_TRANSIT_TIMEOUT_MS = 60_000;
const ENRICH_LIGHTS_TIMEOUT_MS = 45_000;

interface PairState {
  a: Property;
  b: Property;
  transitA?: TransitResult;
  transitB?: TransitResult;
  lightsA?: StreetLight[];
  lightsB?: StreetLight[];
  densityA?: number;
  densityB?: number;
}

function priceLabel(p: Property): string {
  if (p.trade_type === "전세") return `전세 ${p.deposit.toLocaleString()}만`;
  return `월세 ${p.monthly_rent}만`;
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

function betterLower(a: number, b: number): "a" | "b" | null {
  if (a < b) return "a";
  if (b < a) return "b";
  return null;
}
function betterHigher(a: number, b: number): "a" | "b" | null {
  if (a > b) return "a";
  if (b > a) return "b";
  return null;
}

function CompareContent() {
  const router = useRouter();
  const params = useSearchParams();
  const buildingId = params.get("building") ?? "";
  const minRent = Number(params.get("minRent") ?? 10);
  const maxRent = Number(params.get("maxRent") ?? 100);
  const minDeposit = Number(params.get("minDeposit") ?? 0);
  const maxDeposit = Number(params.get("maxDeposit") ?? 50000);
  const weightsParam = params.get("weights");

  const [building, setBuilding] = useState<Building | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [pair, setPair] = useState<PairState | null>(null);
  const [round, setRound] = useState(0);
  const [convergenceScore, setConvergenceScore] = useState(0);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [loading, setLoading] = useState(true);
  const [convergePrompt, setConvergePrompt] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [initWarning, setInitWarning] = useState<string | null>(null);
  const [pairLoadError, setPairLoadError] = useState<string | null>(null);

  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showRoutes, setShowRoutes] = useState(false);

  const modelRef = useRef<RewardModel | null>(null);
  const statsRef = useRef<FeatureStats | null>(null);
  const commuteByIdRef = useRef<Map<string, CommuteFeatures> | null>(null);
  const convRef = useRef<ConvergenceState>(createConvergenceState());
  const usedPairsRef = useRef<Set<string>>(new Set());
  const peakScoreRef = useRef(0);

  const resultsUrl = useCallback(
    () =>
      `/results?session=${sessionId}&building=${buildingId}&minRent=${minRent}&maxRent=${maxRent}&minDeposit=${minDeposit}&maxDeposit=${maxDeposit}&weights=${encodeURIComponent(weightsParam || "{}")}`,
    [sessionId, buildingId, minRent, maxRent, minDeposit, maxDeposit, weightsParam],
  );

  useEffect(() => {
    async function init() {
      setInitError(null);
      setInitWarning(null);
      try {
        const { data: bld, error: bErr } = await supabase
          .from("buildings")
          .select("*")
          .eq("id", buildingId)
          .single();
        if (bErr) {
          logCompareError("buildings", bErr);
          setInitWarning((w) => (w ? `${w} · 건물: ${bErr.message}` : `건물 조회: ${bErr.message}`));
        }
        if (bld) setBuilding(bld as Building);

        let query = supabase
          .from("properties")
          .select("*")
          .gte("monthly_rent", minRent)
          .lte("monthly_rent", maxRent);
        if (minDeposit > 0) query = query.gte("deposit", minDeposit);
        if (maxDeposit < 50000) query = query.lte("deposit", maxDeposit);

        const { data: props, error: pErr } = await query;
        if (pErr) {
          logCompareError("properties", pErr);
          setInitError(`매물 조회 실패: ${pErr.message}`);
          return;
        }

        if (props && props.length >= 2 && bld) {
          const typed = props as Property[];
          setProperties(typed);

          try {
            const { stats, commuteById } = await computeStatsWithCommute(typed, bld as Building);
            statsRef.current = stats;
            commuteByIdRef.current = commuteById;

            let userWeights: Record<string, number> | undefined;
            if (weightsParam) {
              try { userWeights = JSON.parse(weightsParam); } catch { /* ignore */ }
            }
            const model = createModel(undefined, userWeights);
            modelRef.current = model;
            logCompare("init 완료", `매물 ${typed.length}개, 통계·모델 준비됨`);

            try {
              const initial = selectPair(model, typed, stats, usedPairsRef.current, commuteById);
              usedPairsRef.current.add([initial.a.id, initial.b.id].sort().join("-"));
              logCompare("첫 페어 선택", `${initial.a.id} vs ${initial.b.id}`);
              void enrichPair(initial.a, initial.b, bld as Building);
            } catch (pe) {
              logCompareError("selectPair(초기 페어)", pe);
              setPairLoadError(`페어 선택 실패: ${formatCompareError(pe)}`);
            }
          } catch (e) {
            logCompareError("computeStatsWithCommute", e);
            setInitError(`통학 통계 계산 실패: ${formatCompareError(e)}`);
          }
        } else if (props && props.length >= 2) {
          setProperties(props as Property[]);
          setInitWarning(
            "건물(building) 정보가 없어 비교를 시작할 수 없습니다. 이전 단계에서 건물을 선택했는지, URL의 building 파라미터가 유효한지 확인하세요.",
          );
        }
      } catch (e) {
        logCompareError("init", e);
        setInitError(`초기화 실패: ${formatCompareError(e)}`);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [buildingId, minRent, maxRent, minDeposit, maxDeposit, weightsParam]);

  const enrichPair = useCallback(
    async (a: Property, b: Property, bld: Building) => {
      setPairLoadError(null);
      let transitA: TransitResult | undefined;
      let transitB: TransitResult | undefined;
      let lightsA: StreetLight[] = [];
      let lightsB: StreetLight[] = [];
      let densityA: number | undefined;
      let densityB: number | undefined;

      logCompare("enrichPair 시작", `${a.id} vs ${b.id}`);

      try {
        try {
          [transitA, transitB] = await withTimeout(
            Promise.all([calcTransitForDisplay(a, bld), calcTransitForDisplay(b, bld)]),
            ENRICH_TRANSIT_TIMEOUT_MS,
            "도보/버스 경로(calcTransitForDisplay)",
          );
        } catch (e) {
          logCompareError("calcTransitForDisplay", e);
          setPairLoadError(`경로: ${formatCompareError(e)}`);
        }

        try {
          const allLights = await withTimeout(
            loadStreetLights(),
            ENRICH_LIGHTS_TIMEOUT_MS,
            "가로등 목록(loadStreetLights)",
          );
          if (allLights.length > 0) {
            const routeA = [
              ...(transitA?.propertyToGateRoute ?? []),
              ...(transitA?.gateToBuildingRoute ?? []),
            ];
            const routeB = [
              ...(transitB?.propertyToGateRoute ?? []),
              ...(transitB?.gateToBuildingRoute ?? []),
            ];
            try {
              if (routeA.length >= 2) lightsA = filterLightsAlongRoute(allLights, routeA, 30);
              if (routeB.length >= 2) lightsB = filterLightsAlongRoute(allLights, routeB, 30);
            } catch (e) {
              logCompareError("filterLightsAlongRoute", e);
            }
            if (transitA) densityA = calcStreetLightDensity(lightsA.length, transitA.walkDistanceM);
            if (transitB) densityB = calcStreetLightDensity(lightsB.length, transitB.walkDistanceM);
          }
        } catch (e) {
          logCompareError("loadStreetLights", e);
        }
      } catch (e) {
        logCompareError("enrichPair", e);
        setPairLoadError(`페어 준비: ${formatCompareError(e)}`);
      } finally {
        setPair({ a, b, transitA, transitB, lightsA, lightsB, densityA, densityB });
        logCompare("enrichPair setPair 완료", `${a.id} vs ${b.id}`);
      }
    },
    [],
  );

  const handleSelect = useCallback(async (property: Property) => {
    if (!pair || !building || !modelRef.current || !statsRef.current) return;
    const preferred: "a" | "b" = property.id === pair.a.id ? "a" : "b";

    const currentPair = pair;
    setShowCompareModal(false);
    setShowRoutes(false);
    setPair(null);

    await supabase.from("comparisons").insert({
      session_id: sessionId,
      property_a: currentPair.a.id,
      property_b: currentPair.b.id,
      preferred,
      round: round + 1,
    });

    const winner = preferred === "a" ? currentPair.a : currentPair.b;
    const loser = preferred === "a" ? currentPair.b : currentPair.a;
    const wCommute = mergeCommuteFeatures(undefined, commuteByIdRef.current?.get(winner.id));
    const lCommute = mergeCommuteFeatures(undefined, commuteByIdRef.current?.get(loser.id));
    const winnerFeat = toFeatureVector(winner, statsRef.current, wCommute);
    const loserFeat = toFeatureVector(loser, statsRef.current, lCommute);
    modelRef.current = updateModel(modelRef.current, winnerFeat, loserFeat);

    const nextRound = round + 1;
    const conv = checkConvergence(
      convRef.current,
      modelRef.current,
      properties,
      statsRef.current,
      nextRound,
      MIN_ROUNDS,
      MAX_ROUNDS,
      commuteByIdRef.current ?? undefined,
    );
    convRef.current = conv;

    const newScore = Math.max(peakScoreRef.current, conv.convergenceScore);
    peakScoreRef.current = newScore;

    setRound(nextRound);
    setConvergenceScore(newScore);

    if (nextRound >= MAX_ROUNDS) {
      router.push(resultsUrl());
      return;
    }

    if (conv.converged) {
      setConvergePrompt(conv.reason ?? "선호도 학습이 충분히 완료되었습니다!");
      return;
    }

    setTimeout(() => {
      if (!modelRef.current || !statsRef.current || !building) return;
      try {
        const next = selectPair(
          modelRef.current,
          properties,
          statsRef.current,
          usedPairsRef.current,
          commuteByIdRef.current ?? undefined,
        );
        usedPairsRef.current.add([next.a.id, next.b.id].sort().join("-"));
        void enrichPair(next.a, next.b, building);
      } catch (e) {
        logCompareError("selectPair(다음 라운드)", e);
        setPairLoadError(`다음 페어 선택: ${formatCompareError(e)}`);
      }
    }, 300);
  }, [pair, building, round, sessionId, properties, enrichPair, router, resultsUrl]);

  const handleContinue = useCallback(() => {
    setConvergePrompt(null);
    if (!building || !modelRef.current || !statsRef.current) return;
    setTimeout(() => {
      try {
        const next = selectPair(
          modelRef.current!,
          properties,
          statsRef.current!,
          usedPairsRef.current,
          commuteByIdRef.current ?? undefined,
        );
        usedPairsRef.current.add([next.a.id, next.b.id].sort().join("-"));
        void enrichPair(next.a, next.b, building!);
      } catch (e) {
        logCompareError("selectPair(수렴 후 계속)", e);
        setPairLoadError(`페어 선택: ${formatCompareError(e)}`);
      }
    }, 300);
  }, [building, properties, enrichPair]);

  // ── Markers ──
  const allMarkers: KakaoMapMarker[] = [];
  if (pair) {
    allMarkers.push(
      { lat: pair.a.lat, lng: pair.a.lng, label: `A: ${pair.a.monthly_rent}만`, color: "red" },
      { lat: pair.b.lat, lng: pair.b.lng, label: `B: ${pair.b.monthly_rent}만`, color: "blue" },
    );
  }
  if (building) {
    allMarkers.push({ lat: building.lat, lng: building.lng, label: building.name, color: "star" });
  }

  // ── Polylines ──
  const routePolylines: KakaoMapPolyline[] = [];
  if (showRoutes && pair) {
    if (pair.transitA) {
      const t = pair.transitA;
      if (t.propertyToGateRoute.length >= 2)
        routePolylines.push({ path: t.propertyToGateRoute, color: "#ef4444", weight: 5, opacity: 0.8 });
      if (t.gateToBuildingRoute.length >= 2)
        routePolylines.push({ path: t.gateToBuildingRoute, color: "#f97316", weight: 4, opacity: 0.7 });
      if (t.busPath.length >= 2)
        routePolylines.push({ path: t.busPath, color: "#22c55e", weight: 4, opacity: 0.7, style: "shortdash" });
    }
    if (pair.transitB) {
      const t = pair.transitB;
      if (t.propertyToGateRoute.length >= 2)
        routePolylines.push({ path: t.propertyToGateRoute, color: "#3b82f6", weight: 5, opacity: 0.8 });
      if (t.gateToBuildingRoute.length >= 2)
        routePolylines.push({ path: t.gateToBuildingRoute, color: "#8b5cf6", weight: 4, opacity: 0.7 });
      if (t.busPath.length >= 2)
        routePolylines.push({ path: t.busPath, color: "#06b6d4", weight: 4, opacity: 0.7, style: "shortdash" });
    }
  }

  // ── Early returns ──
  if (loading) {
    return (
      <main className="flex h-dvh items-center justify-center">
        <p className="text-sm text-gray-400 animate-pulse">매물 불러오는 중…</p>
      </main>
    );
  }
  if (initError) {
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-4 px-6">
        <p className="text-center font-semibold text-red-600">초기화 오류</p>
        <p className="max-w-md text-center text-sm text-gray-600">{initError}</p>
        <Button variant="outline" onClick={() => router.back()}>돌아가기</Button>
      </main>
    );
  }
  if (properties.length >= 2 && !building) {
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-4 px-6">
        <p className="text-center font-semibold text-amber-800">건물 정보 없음</p>
        <p className="max-w-md text-center text-sm text-gray-600">
          {initWarning ?? "URL의 building 파라미터가 없거나 잘못되었습니다."}
        </p>
        <Button variant="outline" onClick={() => router.back()}>돌아가기</Button>
      </main>
    );
  }
  if (properties.length < 2) {
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-4 px-6">
        <p className="text-center text-gray-600">비교할 매물이 부족합니다 (최소 2개 필요)</p>
        <button className="text-sm text-blue-600 underline" onClick={() => router.back()}>필터 조건 변경</button>
      </main>
    );
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      {/* Progress bar */}
      <div className="absolute inset-x-0 top-0 z-10 px-4 pt-3">
        <ProgressBar learningRate={convergenceScore} round={round} minRounds={MIN_ROUNDS} maxRounds={MAX_ROUNDS} />
      </div>

      {pairLoadError && (
        <div className="absolute inset-x-0 top-14 z-20 mx-4 max-h-24 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 shadow-sm">
          <p className="font-semibold">참고</p>
          <p className="mt-0.5 text-amber-900">{pairLoadError}</p>
        </div>
      )}

      {/* Route time overlay */}
      {showRoutes && pair && (
        <div className="absolute left-4 right-4 top-[72px] z-20 rounded-xl bg-white/95 px-4 py-3 shadow-md backdrop-blur-sm">
          <div className="flex items-center gap-4 text-sm">
            <div className="flex-1">
              <span className="mr-2 font-bold text-red-500">A</span>
              {pair.transitA ? (
                <>
                  <span className="text-gray-700">🚶 {pair.transitA.walkMin}분</span>
                  <span className="mx-1 text-gray-300">·</span>
                  <span className="text-gray-500 text-xs">({(pair.transitA.walkDistanceM / 1000).toFixed(1)}km)</span>
                  {pair.transitA.busMin > 0 && (
                    <>
                      <span className="mx-1 text-gray-300">·</span>
                      <span className="text-gray-700">🚌 {pair.transitA.busMin}분</span>
                    </>
                  )}
                </>
              ) : (
                <span className="text-gray-400">경로 없음</span>
              )}
            </div>
            <div className="h-6 w-px bg-gray-200" />
            <div className="flex-1">
              <span className="mr-2 font-bold text-blue-500">B</span>
              {pair.transitB ? (
                <>
                  <span className="text-gray-700">🚶 {pair.transitB.walkMin}분</span>
                  <span className="mx-1 text-gray-300">·</span>
                  <span className="text-gray-500 text-xs">({(pair.transitB.walkDistanceM / 1000).toFixed(1)}km)</span>
                  {pair.transitB.busMin > 0 && (
                    <>
                      <span className="mx-1 text-gray-300">·</span>
                      <span className="text-gray-700">🚌 {pair.transitB.busMin}분</span>
                    </>
                  )}
                </>
              ) : (
                <span className="text-gray-400">경로 없음</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Map */}
      <KakaoMap
        center={building ? { lat: building.lat, lng: building.lng } : BUSAN_UNIV}
        level={5}
        markers={allMarkers}
        polylines={routePolylines}
        className="absolute inset-0"
        autoFit
        fitPadding={120}
      />

      {/* Pair loading spinner */}
      {!pair && !loading && properties.length >= 2 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="rounded-xl bg-white/90 px-5 py-3 shadow-md backdrop-blur-sm">
            <p className="text-sm text-gray-500 animate-pulse">다음 매물 준비 중…</p>
          </div>
        </div>
      )}

      {/* Bottom: Action buttons + Property cards */}
      {pair && !convergePrompt && (
        <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-4">
          {/* Action buttons */}
          <div className="mb-2 flex gap-2">
            <button
              onClick={() => { setShowCompareModal(true); setShowRoutes(false); }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/95 py-2.5 text-sm font-semibold text-gray-700 shadow-md backdrop-blur-sm transition active:scale-[0.97]"
            >
              <GitCompareArrows className="size-4" />
              매물 비교
            </button>
            <button
              onClick={() => setShowRoutes((prev) => !prev)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold shadow-md backdrop-blur-sm transition active:scale-[0.97] ${
                showRoutes
                  ? "bg-blue-500 text-white"
                  : "bg-white/95 text-gray-700"
              }`}
            >
              <Route className="size-4" />
              거리 비교
            </button>
          </div>

          {/* A / B cards */}
          <div className="flex gap-2">
            {/* Card A */}
            <div className="flex flex-1 flex-col rounded-2xl bg-white p-3 shadow-lg">
              <span className="mb-1 text-xs font-bold text-red-500">A</span>
              <p className="text-sm font-semibold">{priceLabel(pair.a)}</p>
              {pair.a.trade_type !== "전세" && (
                <p className="text-xs text-gray-400">보증금 {pair.a.deposit.toLocaleString()}만</p>
              )}
              <p className="mt-0.5 text-xs text-gray-500">
                {pyeong(pair.a.exclusive_area)} · {pair.a.rooms}방
              </p>
              {pair.transitA && pair.transitA.walkMin > 0 && (
                <p className="mt-0.5 text-[11px] text-gray-400">
                  도보 {pair.transitA.walkMin}분
                  {pair.transitA.busMin > 0 && ` · 버스 ${pair.transitA.busMin}분`}
                </p>
              )}
              <Button
                size="sm"
                className="mt-2 w-full bg-red-500 text-white hover:bg-red-600"
                onClick={() => handleSelect(pair.a)}
              >
                A 선택
              </Button>
            </div>

            {/* Card B */}
            <div className="flex flex-1 flex-col rounded-2xl bg-white p-3 shadow-lg">
              <span className="mb-1 text-xs font-bold text-blue-500">B</span>
              <p className="text-sm font-semibold">{priceLabel(pair.b)}</p>
              {pair.b.trade_type !== "전세" && (
                <p className="text-xs text-gray-400">보증금 {pair.b.deposit.toLocaleString()}만</p>
              )}
              <p className="mt-0.5 text-xs text-gray-500">
                {pyeong(pair.b.exclusive_area)} · {pair.b.rooms}방
              </p>
              {pair.transitB && pair.transitB.walkMin > 0 && (
                <p className="mt-0.5 text-[11px] text-gray-400">
                  도보 {pair.transitB.walkMin}분
                  {pair.transitB.busMin > 0 && ` · 버스 ${pair.transitB.busMin}분`}
                </p>
              )}
              <Button
                size="sm"
                className="mt-2 w-full bg-blue-500 text-white hover:bg-blue-600"
                onClick={() => handleSelect(pair.b)}
              >
                B 선택
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Comparison Modal */}
      <AnimatePresence>
        {showCompareModal && pair && (
          <motion.div
            className="absolute inset-0 z-30 flex items-end justify-center bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowCompareModal(false)}
          >
            <motion.div
              className="w-full max-w-lg rounded-t-2xl bg-white shadow-xl"
              style={{ maxHeight: "75vh" }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 pt-4 pb-2">
                <h3 className="text-base font-bold">매물 비교</h3>
                <button onClick={() => setShowCompareModal(false)} className="rounded-full p-1 text-gray-400 hover:bg-gray-100">
                  <X className="size-5" />
                </button>
              </div>

              <div className="overflow-y-auto px-5 pb-4" style={{ maxHeight: "calc(75vh - 120px)" }}>
                {/* Header */}
                <div className="mb-2 grid grid-cols-[1fr_1fr_1fr] gap-2 border-b pb-2">
                  <span className="text-xs text-gray-400">항목</span>
                  <span className="text-center text-xs font-bold text-red-500">A</span>
                  <span className="text-center text-xs font-bold text-blue-500">B</span>
                </div>

                <CmpRow label="거래유형" a={pair.a.trade_type} b={pair.b.trade_type} />
                <CmpRow
                  label="가격"
                  a={priceLabel(pair.a)}
                  b={priceLabel(pair.b)}
                  better={betterLower(pair.a.monthly_rent || pair.a.deposit, pair.b.monthly_rent || pair.b.deposit)}
                />
                {(pair.a.trade_type !== "전세" || pair.b.trade_type !== "전세") && (
                  <CmpRow
                    label="보증금"
                    a={`${pair.a.deposit.toLocaleString()}만`}
                    b={`${pair.b.deposit.toLocaleString()}만`}
                    better={betterLower(pair.a.deposit, pair.b.deposit)}
                  />
                )}
                <CmpRow
                  label="관리비"
                  a={`${(pair.a.maintenance_fee / 10000).toFixed(1)}만`}
                  b={`${(pair.b.maintenance_fee / 10000).toFixed(1)}만`}
                  better={betterLower(pair.a.maintenance_fee, pair.b.maintenance_fee)}
                />
                <CmpRow
                  label="실평수"
                  a={pyeong(pair.a.exclusive_area)}
                  b={pyeong(pair.b.exclusive_area)}
                  better={betterHigher(pair.a.exclusive_area, pair.b.exclusive_area)}
                />
                <CmpRow
                  label="방"
                  a={`${pair.a.rooms}개`}
                  b={`${pair.b.rooms}개`}
                  better={betterHigher(pair.a.rooms, pair.b.rooms)}
                />
                <CmpRow label="방향" a={pair.a.direction || "-"} b={pair.b.direction || "-"} />
                <CmpRow label="년식" a={buildYearLabel(pair.a)} b={buildYearLabel(pair.b)} />
                <CmpRow label="유형" a={pair.a.property_type} b={pair.b.property_type} />
                <CmpRow
                  label="주차"
                  a={pair.a.parking ? "가능" : "불가"}
                  b={pair.b.parking ? "가능" : "불가"}
                />
                <CmpRow
                  label="엘리베이터"
                  a={pair.a.has_elevator ? "있음" : "없음"}
                  b={pair.b.has_elevator ? "있음" : "없음"}
                />
                <CmpRow
                  label="CCTV"
                  a={pair.a.has_cctv ? "있음" : "없음"}
                  b={pair.b.has_cctv ? "있음" : "없음"}
                />
                {(pair.a.noise_level != null || pair.b.noise_level != null) && (
                  <CmpRow
                    label="소음"
                    a={pair.a.noise_level != null ? `${pair.a.noise_level}dB` : "-"}
                    b={pair.b.noise_level != null ? `${pair.b.noise_level}dB` : "-"}
                    better={
                      pair.a.noise_level != null && pair.b.noise_level != null
                        ? betterLower(pair.a.noise_level, pair.b.noise_level)
                        : null
                    }
                  />
                )}
                {(pair.transitA || pair.transitB) && (
                  <>
                    <CmpRow
                      label="도보"
                      a={pair.transitA ? `${pair.transitA.walkMin}분` : "-"}
                      b={pair.transitB ? `${pair.transitB.walkMin}분` : "-"}
                      better={
                        pair.transitA && pair.transitB
                          ? betterLower(pair.transitA.walkMin, pair.transitB.walkMin)
                          : null
                      }
                    />
                    <CmpRow
                      label="버스"
                      a={pair.transitA?.busMin ? `${pair.transitA.busMin}분` : "-"}
                      b={pair.transitB?.busMin ? `${pair.transitB.busMin}분` : "-"}
                      better={
                        pair.transitA?.busMin && pair.transitB?.busMin
                          ? betterLower(pair.transitA.busMin, pair.transitB.busMin)
                          : null
                      }
                    />
                  </>
                )}
                {(pair.densityA != null || pair.densityB != null) && (
                  <CmpRow
                    label="가로등"
                    a={pair.densityA != null ? `${pair.densityA.toFixed(1)}개/100m` : "-"}
                    b={pair.densityB != null ? `${pair.densityB.toFixed(1)}개/100m` : "-"}
                    better={
                      pair.densityA != null && pair.densityB != null
                        ? betterHigher(pair.densityA, pair.densityB)
                        : null
                    }
                  />
                )}
              </div>

              {/* Select buttons */}
              <div className="flex gap-3 border-t px-5 py-3">
                <Button
                  className="flex-1 bg-red-500 text-white hover:bg-red-600"
                  onClick={() => handleSelect(pair.a)}
                >
                  A 선택
                </Button>
                <Button
                  className="flex-1 bg-blue-500 text-white hover:bg-blue-600"
                  onClick={() => handleSelect(pair.b)}
                >
                  B 선택
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Convergence prompt */}
      <AnimatePresence>
        {convergePrompt && (
          <motion.div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 px-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            >
              <p className="mb-2 text-lg font-bold">학습 완료!</p>
              <p className="mb-5 text-sm text-gray-500">{convergePrompt}</p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={handleContinue}>
                  비교 더 하기
                </Button>
                <Button className="flex-1" onClick={() => router.push(resultsUrl())}>
                  결과 보기
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

function CmpRow({ label, a, b, better }: { label: string; a: string; b: string; better?: "a" | "b" | null }) {
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 border-b border-gray-50 py-2 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-center text-sm ${better === "a" ? "font-semibold text-green-600" : "text-gray-700"}`}>
        {a}
      </span>
      <span className={`text-center text-sm ${better === "b" ? "font-semibold text-green-600" : "text-gray-700"}`}>
        {b}
      </span>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense>
      <CompareContent />
    </Suspense>
  );
}
