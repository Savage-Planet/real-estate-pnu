"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, RotateCcw, X, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import KakaoMap, { type KakaoMapMarker } from "@/components/KakaoMap";
import PropertyListCard from "@/components/PropertyListCard";
import { supabase } from "@/lib/supabase";
import { computeStatsWithCommute, toFeatureVector, getMeanWeightLabels } from "@/lib/feature-engineer";
import { createModel, updateModel, scoreProperty, getMeanWeight, type RewardModel } from "@/lib/reward-model";
import { calcWalkRoute } from "@/lib/gate-distance";
import type { Property, Comparison, Building } from "@/types";

const PAGE_SIZE = 10;
const BUSAN_UNIV = { lat: 35.2340, lng: 129.0800 };

interface ScoredProperty {
  property: Property;
  score: number;
  walkMin?: number;
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

  const [ranked, setRanked] = useState<ScoredProperty[]>([]);
  const [building, setBuilding] = useState<Building | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [weightLabels, setWeightLabels] = useState<Array<{ name: string; value: number }>>([]);

  const [detailArticle, setDetailArticle] = useState<Record<string, unknown> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailPropertyId, setDetailPropertyId] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      let propsQuery = supabase.from("properties").select("*")
        .gte("monthly_rent", minRent)
        .lte("monthly_rent", maxRent);
      if (minDeposit > 0) propsQuery = propsQuery.gte("deposit", minDeposit);
      if (maxDeposit < 99999) propsQuery = propsQuery.lte("deposit", maxDeposit);

      const [{ data: bld }, { data: comparisons }, { data: props }] = await Promise.all([
        supabase.from("buildings").select("*").eq("id", buildingId).single(),
        supabase
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

      let model: RewardModel = createModel();
      const propMap = new Map(typed.map((p) => [p.id, p]));

      for (const c of comps) {
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
      }

      const scored: ScoredProperty[] = typed.map((p) => ({
        property: p,
        score: scoreProperty(model, toFeatureVector(p, stats, commuteById.get(p.id))),
      }));
      scored.sort((a, b) => b.score - a.score);

      const minScore = scored[scored.length - 1]?.score ?? 0;
      const maxScore = scored[0]?.score ?? 1;
      const range = maxScore - minScore || 1;
      const normalized = scored.map((s) => ({
        ...s,
        score: (s.score - minScore) / range,
      }));

      const walkResults = await Promise.all(
        normalized.map((s) => calcWalkRoute(s.property, buildingId).catch(() => null)),
      );
      for (let i = 0; i < normalized.length; i++) {
        if (walkResults[i]) {
          normalized[i].walkMin = walkResults[i]!.totalWalkMin;
        }
      }

      setRanked(normalized);

      const w = getMeanWeight(model);
      const labels = getMeanWeightLabels(w);
      setWeightLabels(labels);

      setLoading(false);
    }
    init();
  }, [sessionId, buildingId, minRent, maxRent, minDeposit, maxDeposit]);

  async function handleCardClick(propertyId: string) {
    setDetailPropertyId(propertyId);
    setDetailLoading(true);
    setDetailArticle(null);

    try {
      const res = await fetch(`/api/article/${propertyId}`);
      if (res.ok) {
        const data = await res.json();
        setDetailArticle(data);
      }
    } catch {
      /* 네이버 API 실패 시 무시 */
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setDetailPropertyId(null);
    setDetailArticle(null);
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
    return markers;
  }, [pageItems, building, page]);

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-gray-400 animate-pulse">결과 생성 중…</p>
      </main>
    );
  }

  const articleInfo = detailArticle?.articleDetail as Record<string, unknown> | undefined;

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

        {weightLabels.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-5 rounded-2xl border bg-gray-50 p-4"
          >
            <p className="mb-3 text-xs font-semibold text-gray-500">학습된 선호도 가중치</p>
            <div className="space-y-2">
              {weightLabels.slice(0, 8).map(({ name, value }) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-gray-500">{name}</span>
                  <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
                    <div
                      className={`absolute inset-y-0 rounded-full ${value >= 0 ? "left-1/2 bg-blue-500" : "right-1/2 bg-red-400"}`}
                      style={{ width: `${Math.abs(value) * 50}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs tabular-nums text-gray-500">
                    {value >= 0 ? "+" : ""}{value.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}

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
              onClick={() => handleCardClick(item.property.id)}
            />
          ))}
        </motion.div>

        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              이전
            </Button>
            <span className="text-sm text-gray-400">
              {page + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
            >
              다음
            </Button>
          </div>
        )}

        <div className="mt-8 mb-6 flex justify-center">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => router.push("/")}
          >
            <RotateCcw className="size-4" />
            처음부터 다시 하기
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {detailPropertyId && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeDetail}
          >
            <motion.div
              className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl"
              style={{ maxHeight: "70vh" }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-bold">매물 상세 정보</h3>
                <button onClick={closeDetail} className="rounded-full p-1 text-gray-400 hover:bg-gray-100">
                  <X className="size-5" />
                </button>
              </div>

              {detailLoading && (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="size-6 animate-spin text-gray-400" />
                </div>
              )}

              {!detailLoading && articleInfo && (
                <div className="overflow-y-auto space-y-3 text-sm" style={{ maxHeight: "calc(70vh - 80px)" }}>
                  <InfoRow label="매물명" value={String(articleInfo.articleName ?? "-")} />
                  <InfoRow label="거래 유형" value={String(articleInfo.tradeTypeName ?? "-")} />
                  <InfoRow label="가격" value={String(articleInfo.dealOrWarrantPrc ?? "-")} />
                  <InfoRow label="면적" value={`${articleInfo.area1 ?? "-"}㎡ / 전용 ${articleInfo.area2 ?? "-"}㎡`} />
                  <InfoRow label="방향" value={String(articleInfo.direction ?? "-")} />
                  <InfoRow label="층" value={`${articleInfo.floorInfo ?? "-"}`} />
                  <InfoRow label="입주가능일" value={String(articleInfo.moveInDate ?? "-")} />
                  <InfoRow label="관리비" value={String(articleInfo.maintenanceFee ?? "-")} />
                  {articleInfo.articleFeatureDesc != null && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1">특징</p>
                      <p className="text-gray-700">{String(articleInfo.articleFeatureDesc)}</p>
                    </div>
                  )}
                  <a
                    href={`https://new.land.naver.com/rooms?articleNo=${detailPropertyId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 flex items-center gap-1 text-blue-600 text-sm font-medium"
                  >
                    네이버 부동산에서 보기
                    <ExternalLink className="size-3.5" />
                  </a>
                </div>
              )}

              {!detailLoading && !articleInfo && (
                <div className="py-8 text-center text-sm text-gray-400">
                  매물 상세 정보를 불러올 수 없습니다.
                  <br />
                  <a
                    href={`https://new.land.naver.com/rooms?articleNo=${detailPropertyId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-blue-600 font-medium"
                  >
                    네이버 부동산에서 직접 보기
                    <ExternalLink className="size-3.5" />
                  </a>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-20 shrink-0 text-xs text-gray-400">{label}</span>
      <span className="text-gray-700">{value}</span>
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
