"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import KakaoMap, { type KakaoMapMarker, type KakaoMapPolyline } from "@/components/KakaoMap";
import PropertySheet from "@/components/PropertySheet";
import ProgressBar from "@/components/ProgressBar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { calcTransitTime, totalTransitMinutes, type TransitResult } from "@/lib/transit-calculator";
import { loadStreetLights, filterLightsAlongRoute, calcStreetLightDensity } from "@/lib/street-lights";
import { computeStatsWithCommute, toFeatureVector, type FeatureStats } from "@/lib/feature-engineer";
import { createModel, updateModel, type RewardModel } from "@/lib/reward-model";
import { selectPair } from "@/lib/query-selector";
import { createConvergenceState, checkConvergence, type ConvergenceState } from "@/lib/convergence";
import type { Property, Building, StreetLight } from "@/types";

const MIN_ROUNDS = 5;
const MAX_ROUNDS = 25;
const BUSAN_UNIV = { lat: 35.2340, lng: 129.0800 };

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
  const [sheetSide, setSheetSide] = useState<"a" | "b" | null>(null);
  const [mapFocusSide, setMapFocusSide] = useState<"a" | "b" | null>(null);
  const [round, setRound] = useState(0);
  const [convergenceScore, setConvergenceScore] = useState(0);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [loading, setLoading] = useState(true);
  const [convergePrompt, setConvergePrompt] = useState<string | null>(null);

  const modelRef = useRef<RewardModel | null>(null);
  const statsRef = useRef<FeatureStats | null>(null);
  const commuteByIdRef = useRef<Map<string, number> | null>(null);
  const convRef = useRef<ConvergenceState>(createConvergenceState());
  const usedPairsRef = useRef<Set<string>>(new Set());
  const peakScoreRef = useRef(0);

  useEffect(() => {
    async function init() {
      const { data: bld } = await supabase
        .from("buildings")
        .select("*")
        .eq("id", buildingId)
        .single();
      if (bld) setBuilding(bld as Building);

      let query = supabase
        .from("properties")
        .select("*")
        .gte("monthly_rent", minRent)
        .lte("monthly_rent", maxRent);

      if (minDeposit > 0) query = query.gte("deposit", minDeposit);
      if (maxDeposit < 50000) query = query.lte("deposit", maxDeposit);

      const { data: props } = await query;

      if (props && props.length >= 2 && bld) {
        const typed = props as Property[];
        setProperties(typed);

        const { stats, commuteById } = await computeStatsWithCommute(typed, bld as Building);
        statsRef.current = stats;
        commuteByIdRef.current = commuteById;

        let userWeights: Record<string, number> | undefined;
        if (weightsParam) {
          try { userWeights = JSON.parse(weightsParam); } catch { /* ignore */ }
        }
        const model = createModel(undefined, userWeights);
        modelRef.current = model;
      } else if (props && props.length >= 2) {
        setProperties(props as Property[]);
      }

      setLoading(false);
    }
    init();
  }, [buildingId, minRent, maxRent, minDeposit, maxDeposit, weightsParam]);

  const enrichPair = useCallback(
    async (a: Property, b: Property, bld: Building) => {
      let transitA: TransitResult | undefined;
      let transitB: TransitResult | undefined;
      let lightsA: StreetLight[] = [];
      let lightsB: StreetLight[] = [];
      let densityA: number | undefined;
      let densityB: number | undefined;

      try {
        [transitA, transitB] = await Promise.all([
          calcTransitTime(a, bld),
          calcTransitTime(b, bld),
        ]);
      } catch {
        /* gate DB 미구축 시 이동시간 없이 진행 */
      }

      try {
        const allLights = await loadStreetLights();
        if (allLights.length > 0) {
          const routeA = [
            ...(transitA?.propertyToGateRoute ?? []),
            ...(transitA?.gateToBuildingRoute ?? []),
          ];
          const routeB = [
            ...(transitB?.propertyToGateRoute ?? []),
            ...(transitB?.gateToBuildingRoute ?? []),
          ];

          if (routeA.length >= 2) {
            lightsA = filterLightsAlongRoute(allLights, routeA, 30);
          }
          if (routeB.length >= 2) {
            lightsB = filterLightsAlongRoute(allLights, routeB, 30);
          }

          if (transitA) densityA = calcStreetLightDensity(lightsA.length, transitA.walkDistanceM);
          if (transitB) densityB = calcStreetLightDensity(lightsB.length, transitB.walkDistanceM);
        }
      } catch {
        /* 가로등 데이터 없으면 무시 */
      }

      setPair({ a, b, transitA, transitB, lightsA, lightsB, densityA, densityB });
    },
    [],
  );

  useEffect(() => {
    if (!building || properties.length < 2 || !modelRef.current || !statsRef.current) return;
    const initial = selectPair(
      modelRef.current,
      properties,
      statsRef.current,
      usedPairsRef.current,
      commuteByIdRef.current ?? undefined,
    );
    usedPairsRef.current.add([initial.a.id, initial.b.id].sort().join("-"));
    enrichPair(initial.a, initial.b, building);
  }, [building, properties, enrichPair]);

  const handleSelect = useCallback(async (property: Property) => {
    if (!pair || !building || !modelRef.current || !statsRef.current) return;
    const preferred: "a" | "b" = property.id === pair.a.id ? "a" : "b";

    const currentPair = pair;
    setSheetSide(null);
    setMapFocusSide(null);
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
    const wTransit = preferred === "a" ? currentPair.transitA : currentPair.transitB;
    const lTransit = preferred === "a" ? currentPair.transitB : currentPair.transitA;
    const wCommute =
      totalTransitMinutes(wTransit) ?? commuteByIdRef.current?.get(winner.id) ?? null;
    const lCommute =
      totalTransitMinutes(lTransit) ?? commuteByIdRef.current?.get(loser.id) ?? null;
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
      router.push(`/results?session=${sessionId}&building=${buildingId}&minRent=${minRent}&maxRent=${maxRent}&minDeposit=${minDeposit}&maxDeposit=${maxDeposit}`);
      return;
    }

    if (conv.converged) {
      setConvergePrompt(conv.reason ?? "선호도 학습이 충분히 완료되었습니다!");
      return;
    }

    setTimeout(() => {
      if (!modelRef.current || !statsRef.current || !building) return;
      const next = selectPair(
        modelRef.current,
        properties,
        statsRef.current,
        usedPairsRef.current,
        commuteByIdRef.current ?? undefined,
      );
      usedPairsRef.current.add([next.a.id, next.b.id].sort().join("-"));
      enrichPair(next.a, next.b, building);
    }, 300);
  }, [pair, building, round, sessionId, buildingId, properties, enrichPair, router]);

  const handleContinue = useCallback(() => {
    setConvergePrompt(null);
    if (!building || !modelRef.current || !statsRef.current) return;
    setTimeout(() => {
      const next = selectPair(
        modelRef.current!,
        properties,
        statsRef.current!,
        usedPairsRef.current,
        commuteByIdRef.current ?? undefined,
      );
      usedPairsRef.current.add([next.a.id, next.b.id].sort().join("-"));
      enrichPair(next.a, next.b, building!);
    }, 300);
  }, [building, properties, enrichPair]);

  const handleMarkerClick = useCallback((_: KakaoMapMarker, index: number) => {
    if (index === 0) setMapFocusSide((prev) => (prev === "a" ? null : "a"));
    else if (index === 1) setMapFocusSide((prev) => (prev === "b" ? null : "b"));
  }, []);

  // --- Build markers ---
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
  if (mapFocusSide === "a" && pair?.lightsA) {
    pair.lightsA.forEach((l) =>
      allMarkers.push({ lat: l.lat, lng: l.lng, color: "light", excludeFromBounds: true }),
    );
  } else if (mapFocusSide === "b" && pair?.lightsB) {
    pair.lightsB.forEach((l) =>
      allMarkers.push({ lat: l.lat, lng: l.lng, color: "light", excludeFromBounds: true }),
    );
  }

  const routePolylines: KakaoMapPolyline[] = [];
  if (mapFocusSide === "a" && pair?.transitA) {
    const t = pair.transitA;
    if (t.propertyToGateRoute.length >= 2) {
      routePolylines.push({ path: t.propertyToGateRoute, color: "#ef4444", weight: 5, opacity: 0.8 });
    }
    if (t.gateToBuildingRoute.length >= 2) {
      routePolylines.push({ path: t.gateToBuildingRoute, color: "#3b82f6", weight: 5, opacity: 0.8 });
    }
    if (t.busPath.length >= 2) {
      routePolylines.push({ path: t.busPath, color: "#22c55e", weight: 4, opacity: 0.7, style: "shortdash" });
    }
  } else if (mapFocusSide === "b" && pair?.transitB) {
    const t = pair.transitB;
    if (t.propertyToGateRoute.length >= 2) {
      routePolylines.push({ path: t.propertyToGateRoute, color: "#ef4444", weight: 5, opacity: 0.8 });
    }
    if (t.gateToBuildingRoute.length >= 2) {
      routePolylines.push({ path: t.gateToBuildingRoute, color: "#3b82f6", weight: 5, opacity: 0.8 });
    }
    if (t.busPath.length >= 2) {
      routePolylines.push({ path: t.busPath, color: "#22c55e", weight: 4, opacity: 0.7, style: "shortdash" });
    }
  }

  const sheetProperty = sheetSide === "a" ? pair?.a : sheetSide === "b" ? pair?.b : null;
  const sheetTransit = sheetSide === "a" ? pair?.transitA : sheetSide === "b" ? pair?.transitB : undefined;
  const sheetDensity = sheetSide === "a" ? pair?.densityA : sheetSide === "b" ? pair?.densityB : undefined;

  if (loading) {
    return (
      <main className="flex h-dvh items-center justify-center">
        <p className="text-sm text-gray-400 animate-pulse">매물 불러오는 중…</p>
      </main>
    );
  }

  if (properties.length < 2) {
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-4 px-6">
        <p className="text-center text-gray-600">비교할 매물이 부족합니다 (최소 2개 필요)</p>
        <button className="text-sm text-blue-600 underline" onClick={() => router.back()}>
          필터 조건 변경
        </button>
      </main>
    );
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <div className="absolute inset-x-0 top-0 z-10 px-4 pt-3">
        <ProgressBar
          convergence={convergenceScore}
          round={round}
          minRounds={MIN_ROUNDS}
          maxRounds={MAX_ROUNDS}
        />
      </div>

      <KakaoMap
        center={building ? { lat: building.lat, lng: building.lng } : BUSAN_UNIV}
        level={5}
        markers={allMarkers}
        polylines={routePolylines}
        className="absolute inset-0"
        autoFit
        fitPadding={120}
        onMarkerClick={handleMarkerClick}
      />

      {!pair && !loading && properties.length >= 2 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="rounded-xl bg-white/90 px-5 py-3 shadow-md backdrop-blur-sm">
            <p className="text-sm text-gray-500 animate-pulse">다음 매물 준비 중…</p>
          </div>
        </div>
      )}

      {pair && !sheetSide && !convergePrompt && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex gap-2 px-4 pb-4">
          <button
            onClick={() => setSheetSide("a")}
            className={`flex-1 rounded-2xl px-4 py-3.5 text-left shadow-lg transition active:scale-[0.98] ${
              mapFocusSide === "a" ? "bg-red-50 ring-2 ring-red-400" : "bg-white"
            }`}
          >
            <span className="text-xs font-bold text-red-500">A</span>
            <p className="mt-0.5 text-sm font-semibold">
              {pair.a.monthly_rent}만/월
              <span className="ml-1 font-normal text-gray-400">
                보증금 {pair.a.deposit}만
              </span>
            </p>
            {pair.transitA && pair.transitA.walkMin > 0 && (
              <p className="mt-0.5 text-xs text-gray-400">
                도보 {pair.transitA.walkMin}분
                {pair.transitA.busMin > 0 && ` · 버스 ${pair.transitA.busMin}분`}
              </p>
            )}
          </button>

          <button
            onClick={() => setSheetSide("b")}
            className={`flex-1 rounded-2xl px-4 py-3.5 text-left shadow-lg transition active:scale-[0.98] ${
              mapFocusSide === "b" ? "bg-blue-50 ring-2 ring-blue-400" : "bg-white"
            }`}
          >
            <span className="text-xs font-bold text-blue-500">B</span>
            <p className="mt-0.5 text-sm font-semibold">
              {pair.b.monthly_rent}만/월
              <span className="ml-1 font-normal text-gray-400">
                보증금 {pair.b.deposit}만
              </span>
            </p>
            {pair.transitB && pair.transitB.walkMin > 0 && (
              <p className="mt-0.5 text-xs text-gray-400">
                도보 {pair.transitB.walkMin}분
                {pair.transitB.busMin > 0 && ` · 버스 ${pair.transitB.busMin}분`}
              </p>
            )}
          </button>
        </div>
      )}

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
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={handleContinue}
                >
                  비교 더 하기
                </Button>
                <Button
                  className="flex-1"
                  onClick={() =>
                    router.push(`/results?session=${sessionId}&building=${buildingId}&minRent=${minRent}&maxRent=${maxRent}&minDeposit=${minDeposit}&maxDeposit=${maxDeposit}`)
                  }
                >
                  결과 보기
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <PropertySheet
        property={sheetProperty ?? null}
        open={sheetSide !== null}
        onClose={() => setSheetSide(null)}
        onSelect={handleSelect}
        walkTimeMin={sheetTransit?.walkMin}
        walkDistanceM={sheetTransit?.walkDistanceM}
        busTimeMin={sheetTransit?.busMin}
        streetLightCount={sheetSide === "a" ? pair?.lightsA?.length : sheetSide === "b" ? pair?.lightsB?.length : undefined}
        streetLightDensity={sheetDensity}
        label={sheetSide === "a" ? "매물 A" : sheetSide === "b" ? "매물 B" : undefined}
      />
    </main>
  );
}

export default function ComparePage() {
  return (
    <Suspense>
      <CompareContent />
    </Suspense>
  );
}
