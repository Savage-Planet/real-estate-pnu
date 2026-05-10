"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import KakaoMap, { type KakaoMapMarker, type KakaoMapPolyline } from "@/components/KakaoMap";
import { Button } from "@/components/ui/button";
import { X, GitCompareArrows, Footprints, BusFront, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { calcTransitForDisplay, type TransitResult } from "@/lib/transit-calculator";
import { loadStreetLights, filterLightsAlongRoute, calcStreetLightDensity } from "@/lib/street-lights";
import {
  computeStatsWithCommute,
  type CommuteFeatures,
  type FeatureStats,
} from "@/lib/feature-engineer";
import type { Property, Building, StreetLight } from "@/types";
import { formatCompareError, logCompare, logCompareError, withTimeout } from "@/lib/compare-log";
import {
  loadAmenitiesByTypes,
  calcNearestAmenities,
  type NearestAmenity,
} from "@/lib/amenities";
import {
  samplePoints,
  fetchRouteElevations,
  calcSlopePolylines,
  SLOPE_LEVELS,
} from "@/lib/elevation";
import {
  InteractiveNavigator,
  type NavigatorStep,
  type MacroStep,
  type MicroStep,
} from "@/lib/hierarchical/v2/interactive-navigator";
import { CATEGORY_NAMES } from "@/lib/hierarchical/v2/feature-groups";

const BUSAN_UNIV = { lat: 35.2340, lng: 129.0800 };
const ENRICH_TRANSIT_TIMEOUT_MS = 60_000;
const ENRICH_LIGHTS_TIMEOUT_MS = 45_000;

// ──────────────────────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────────────────────

function priceLabel(p: Property): string {
  if (p.trade_type === "전세") return `전세 ${p.deposit.toLocaleString()}만`;
  return `월세 ${p.monthly_rent}만`;
}

function pyeong(area: number): string {
  return `실${(area / 3.3058).toFixed(1)}평`;
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

// ──────────────────────────────────────────────────────────
// Macro 단계 UI (가상 아이템 비교)
// ──────────────────────────────────────────────────────────

function MacroCompareView({
  step,
  onAnswer,
}: {
  step: MacroStep;
  onAnswer: (w: "a" | "b") => void;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-between px-4 py-6">
      {/* 헤더 */}
      <div className="w-full max-w-md">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">
            선호도 파악 중 · {step.round + 1}단계
          </p>
          <p className="text-xs text-muted-foreground">
            {CATEGORY_NAMES.join(" · ")}
          </p>
        </div>
        {/* 진행 바 */}
        <div className="h-1.5 w-full rounded-full bg-gray-100">
          <motion.div
            className="h-full rounded-full bg-blue-500"
            initial={{ width: 0 }}
            animate={{ width: `${step.macroProgress * 100}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
        <p className="mt-3 text-center text-base font-semibold">
          어떤 매물이 더 마음에 드세요?
        </p>
        <p className="mt-0.5 text-center text-xs text-muted-foreground">
          실제 매물이 아닌 선호 유형 파악을 위한 질문입니다
        </p>
      </div>

      {/* 카드 */}
      <div className="flex w-full max-w-md flex-col gap-3 sm:flex-row">
        {(["a", "b"] as const).map((side) => {
          const item = side === "a" ? step.itemA : step.itemB;
          const color = side === "a" ? "red" : "blue";
          return (
            <motion.button
              key={side}
              whileTap={{ scale: 0.97 }}
              onClick={() => onAnswer(side)}
              className={`flex flex-1 flex-col items-center gap-3 rounded-2xl border-2 p-5 text-left transition hover:border-${color}-400 hover:shadow-md`}
            >
              <div className="text-4xl">{item.icon}</div>
              <div>
                <p className="text-sm font-bold">{item.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{item.desc}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {item.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <Button
                size="sm"
                className={`w-full ${color === "red" ? "bg-red-500 hover:bg-red-600" : "bg-blue-500 hover:bg-blue-600"} text-white`}
              >
                {side === "a" ? "A" : "B"} 선택
              </Button>
            </motion.button>
          );
        })}
      </div>

      <div className="h-4" />
    </main>
  );
}

// ──────────────────────────────────────────────────────────
// Micro 단계 UI (실제 매물 비교)
// ──────────────────────────────────────────────────────────

interface PairEnrichState {
  transitA?: TransitResult;
  transitB?: TransitResult;
  lightsA?: StreetLight[];
  lightsB?: StreetLight[];
  densityA?: number;
  densityB?: number;
  nearestAmenitiesA?: NearestAmenity[];
  nearestAmenitiesB?: NearestAmenity[];
  /** 경사도 색상 폴리라인 (A/B 각각의 도보 경로) */
  slopePolylinesA?: KakaoMapPolyline[];
  slopePolylinesB?: KakaoMapPolyline[];
}

function buildYearLabel(p: Property): string {
  if (p.within_4y) return "4년 이내";
  if (p.within_10y) return "10년 이내";
  if (p.within_15y) return "15년 이내";
  if (p.within_25y) return "25년 이내";
  return "25년 초과";
}

/** A와 B의 핵심 차이를 1~2개 뽑아 한줄로 반환 */
function buildDiffLine(
  pA: Property,
  pB: Property,
  transitA?: TransitResult,
  transitB?: TransitResult,
): string {
  const aStrengths: string[] = [];
  const bStrengths: string[] = [];

  // 가격 (월세 기준, 전세는 보증금)
  const priceA = pA.trade_type === "전세" ? pA.deposit : pA.monthly_rent;
  const priceB = pB.trade_type === "전세" ? pB.deposit : pB.monthly_rent;
  if (priceA < priceB - 3) aStrengths.push("가격 유리");
  else if (priceB < priceA - 3) bStrengths.push("가격 유리");

  // 도보 거리
  const walkA = transitA?.walkMin ?? pA.walk_to_gate_min ?? 999;
  const walkB = transitB?.walkMin ?? pB.walk_to_gate_min ?? 999;
  if (walkA < walkB - 3) aStrengths.push("가까움");
  else if (walkB < walkA - 3) bStrengths.push("가까움");

  // 면적
  if (pA.exclusive_area > pB.exclusive_area + 5) aStrengths.push("넓은 방");
  else if (pB.exclusive_area > pA.exclusive_area + 5) bStrengths.push("넓은 방");

  // 보안 (CCTV / 인터폰 / 방범창)
  const secA = (pA.has_cctv ? 1 : 0) + (pA.has_intercom ? 1 : 0) + (pA.has_entrance_security ? 1 : 0);
  const secB = (pB.has_cctv ? 1 : 0) + (pB.has_intercom ? 1 : 0) + (pB.has_entrance_security ? 1 : 0);
  if (secA > secB + 1) aStrengths.push("보안 강점");
  else if (secB > secA + 1) bStrengths.push("보안 강점");

  // 엘리베이터
  if (pA.has_elevator && !pB.has_elevator) aStrengths.push("엘리베이터");
  else if (pB.has_elevator && !pA.has_elevator) bStrengths.push("엘리베이터");

  // 상위 2개만 사용
  const aTop = aStrengths.slice(0, 2).join("·");
  const bTop = bStrengths.slice(0, 2).join("·");

  if (!aTop && !bTop) return "비슷한 조건의 매물입니다";
  if (!bTop) return `A: ${aTop}이 유리`;
  if (!aTop) return `B: ${bTop}이 유리`;
  return `A: ${aTop}   B: ${bTop}`;
}

function MicroCompareView({
  step,
  enrichState,
  building,
  onAnswer,
}: {
  step: MicroStep;
  enrichState: PairEnrichState;
  building: Building | null;
  onAnswer: (w: "a" | "b") => void;
}) {
  const [showModal, setShowModal] = useState(false);
  /**
   * 현재 지도에 표시할 경로:
   *   null  = 경로 없음
   *   { side: 'a'|'b', type: 'walk'|'bus' }
   */
  const [activeRoute, setActiveRoute] = useState<{ side: "a" | "b"; type: "walk" | "bus" } | null>(null);

  const { propertyA: pA, propertyB: pB } = step;
  const {
    transitA, transitB, densityA, densityB,
    nearestAmenitiesA, nearestAmenitiesB,
    slopePolylinesA, slopePolylinesB,
  } = enrichState;

  const diffLine = buildDiffLine(pA, pB, transitA, transitB);

  function toggleRoute(side: "a" | "b", type: "walk" | "bus") {
    setActiveRoute((prev) =>
      prev?.side === side && prev.type === type ? null : { side, type },
    );
  }

  const showSlopeLegend =
    activeRoute?.type === "walk" &&
    ((activeRoute.side === "a" && slopePolylinesA && slopePolylinesA.length > 0) ||
      (activeRoute.side === "b" && slopePolylinesB && slopePolylinesB.length > 0));

  const allMarkers: KakaoMapMarker[] = [
    { lat: pA.lat, lng: pA.lng, label: `A: ${pA.monthly_rent}만`, color: "red" },
    { lat: pB.lat, lng: pB.lng, label: `B: ${pB.monthly_rent}만`, color: "blue" },
  ];
  if (building) {
    allMarkers.push({ lat: building.lat, lng: building.lng, label: building.name, color: "star" });
  }

  const routePolylines: KakaoMapPolyline[] = [];
  if (activeRoute) {
    const isA = activeRoute.side === "a";
    const transit = isA ? transitA : transitB;
    const slopePolylines = isA ? slopePolylinesA : slopePolylinesB;
    const walkColor = isA ? "#ef4444" : "#3b82f6";
    const busColor  = isA ? "#dc2626" : "#1d4ed8";

    if (activeRoute.type === "walk" && transit) {
      if (slopePolylines && slopePolylines.length > 0) {
        routePolylines.push(...slopePolylines);
      } else {
        if (transit.propertyToGateRoute.length >= 2)
          routePolylines.push({ path: transit.propertyToGateRoute, color: walkColor, weight: 5, opacity: 0.85 });
        if (transit.gateToBuildingRoute.length >= 2)
          routePolylines.push({ path: transit.gateToBuildingRoute, color: walkColor, weight: 4, opacity: 0.7 });
      }
    }

    if (activeRoute.type === "bus" && transit?.busPath && transit.busPath.length >= 2) {
      routePolylines.push({ path: transit.busPath, color: busColor, weight: 5, opacity: 0.8, style: "dashed" });
    }
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      {/* 상단 진행 표시 */}
      <div className="absolute inset-x-0 top-0 z-10 px-4 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-gray-600">
            {step.categoryIcon} {step.categoryLabel} 비교 중
          </span>
          <span className="text-[11px] text-muted-foreground">
            {step.round + 1}번째 비교
          </span>
        </div>
        <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100">
          <motion.div
            className="h-full rounded-full bg-blue-500"
            initial={{ width: 0 }}
            animate={{ width: `${step.microProgress * 100}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
        {/* A/B 핵심 차이 한줄 */}
        <div className="mt-1.5 rounded-lg bg-white/80 px-3 py-1 text-center text-[11px] font-medium text-gray-600 backdrop-blur-sm">
          {diffLine}
        </div>
      </div>

      {/* 지도 */}
      <KakaoMap
        center={building ? { lat: building.lat, lng: building.lng } : BUSAN_UNIV}
        level={5}
        markers={allMarkers}
        polylines={routePolylines}
        className="absolute inset-0"
        autoFit
        fitPadding={120}
      />

      {/* 경사도 범례 (도보 경로 + slope 데이터 있을 때만) */}
      {showSlopeLegend && (
        <div className="absolute left-3 top-[92px] z-10 rounded-xl bg-white/90 px-2.5 py-2 text-[10px] shadow backdrop-blur-sm">
          <p className="mb-1.5 font-bold text-gray-600">경사도</p>
          {SLOPE_LEVELS.map((lv) => (
            <div key={lv.color} className="flex items-center gap-1.5 leading-tight">
              <span className="inline-block h-2 w-5 rounded-sm" style={{ background: lv.color }} />
              <span className="text-gray-600">{lv.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* 하단 */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-4">
        {/* 매물 비교 버튼 (단일) */}
        <div className="mb-2">
          <button
            onClick={() => { setShowModal(true); setActiveRoute(null); }}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/95 py-2.5 text-sm font-semibold text-gray-700 shadow-md backdrop-blur-sm transition active:scale-[0.97]"
          >
            <GitCompareArrows className="size-4" />
            매물 상세 비교
          </button>
        </div>

        {/* A / B 카드 */}
        <div className="flex gap-2">
          {(["a", "b"] as const).map((side) => {
            const p = side === "a" ? pA : pB;
            const transit = side === "a" ? transitA : transitB;
            const themeColor = side === "a" ? "red" : "blue";
            const nearestAmenities = side === "a" ? nearestAmenitiesA : nearestAmenitiesB;
            const isWalkActive = activeRoute?.side === side && activeRoute.type === "walk";
            const isBusActive  = activeRoute?.side === side && activeRoute.type === "bus";
            const hasBus = transit?.busMin != null && transit.busMin > 0;
            return (
              <div key={side} className="flex flex-1 flex-col rounded-2xl bg-white p-3 shadow-lg">
                {/* 헤더 */}
                <div className="mb-1.5 flex items-center justify-between">
                  <span className={`text-xs font-bold text-${themeColor}-500`}>{side.toUpperCase()}</span>
                  {/* 경로 토글 버튼 */}
                  <div className="flex gap-1">
                    <button
                      onClick={() => toggleRoute(side, "walk")}
                      title="도보 경로"
                      className={`flex items-center gap-0.5 rounded-lg px-1.5 py-1 text-[10px] font-semibold transition ${
                        isWalkActive
                          ? themeColor === "red" ? "bg-red-500 text-white" : "bg-blue-500 text-white"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      <Footprints className="size-3" />
                      도보
                    </button>
                    {hasBus && (
                      <button
                        onClick={() => toggleRoute(side, "bus")}
                        title="버스 경로"
                        className={`flex items-center gap-0.5 rounded-lg px-1.5 py-1 text-[10px] font-semibold transition ${
                          isBusActive
                            ? themeColor === "red" ? "bg-red-500 text-white" : "bg-blue-500 text-white"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        }`}
                      >
                        <BusFront className="size-3" />
                        버스
                      </button>
                    )}
                  </div>
                </div>
                {/* 매물 정보 */}
                <p className="text-sm font-semibold">{priceLabel(p)}</p>
                {p.trade_type !== "전세" && (
                  <p className="text-xs text-gray-400">보증금 {p.deposit.toLocaleString()}만</p>
                )}
                <p className="mt-0.5 text-xs text-gray-500">
                  {pyeong(p.exclusive_area)} · {p.rooms}방
                </p>
                {transit && transit.walkMin > 0 && (
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    🚶 {transit.walkMin}분
                    {transit.busMin > 0 && `  🚌 ${transit.busMin}분`}
                  </p>
                )}
                {nearestAmenities && nearestAmenities.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {nearestAmenities.slice(0, 2).map((a) => (
                      <span
                        key={a.type}
                        className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600"
                      >
                        {a.icon} {Math.round(a.distM)}m
                      </span>
                    ))}
                  </div>
                )}
                <Button
                  size="sm"
                  className={`mt-2 w-full text-white ${themeColor === "red" ? "bg-red-500 hover:bg-red-600" : "bg-blue-500 hover:bg-blue-600"}`}
                  onClick={() => onAnswer(side)}
                >
                  {side.toUpperCase()} 선택
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 비교 모달 */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            className="absolute inset-0 z-30 flex items-end justify-center bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowModal(false)}
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
                <h3 className="text-base font-bold">매물 상세 비교</h3>
                <button onClick={() => setShowModal(false)} className="rounded-full p-1 text-gray-400 hover:bg-gray-100">
                  <X className="size-5" />
                </button>
              </div>

              <div className="overflow-y-auto px-5 pb-4" style={{ maxHeight: "calc(75vh - 120px)" }}>
                <div className="mb-2 grid grid-cols-[1fr_1fr_1fr] gap-2 border-b pb-2">
                  <span className="text-xs text-gray-400">항목</span>
                  <span className="text-center text-xs font-bold text-red-500">A</span>
                  <span className="text-center text-xs font-bold text-blue-500">B</span>
                </div>
                <CmpRow label="거래유형" a={pA.trade_type} b={pB.trade_type} />
                <CmpRow label="가격" a={priceLabel(pA)} b={priceLabel(pB)} better={betterLower(pA.monthly_rent || pA.deposit, pB.monthly_rent || pB.deposit)} />
                <CmpRow label="보증금" a={`${pA.deposit.toLocaleString()}만`} b={`${pB.deposit.toLocaleString()}만`} better={betterLower(pA.deposit, pB.deposit)} />
                <CmpRow label="관리비" a={`${(pA.maintenance_fee / 10000).toFixed(1)}만`} b={`${(pB.maintenance_fee / 10000).toFixed(1)}만`} better={betterLower(pA.maintenance_fee, pB.maintenance_fee)} />
                <CmpRow label="실평수" a={pyeong(pA.exclusive_area)} b={pyeong(pB.exclusive_area)} better={betterHigher(pA.exclusive_area, pB.exclusive_area)} />
                <CmpRow label="방" a={`${pA.rooms}개`} b={`${pB.rooms}개`} better={betterHigher(pA.rooms, pB.rooms)} />
                <CmpRow label="방향" a={pA.direction || "-"} b={pB.direction || "-"} />
                <CmpRow label="년식" a={buildYearLabel(pA)} b={buildYearLabel(pB)} />
                <CmpRow label="주차" a={pA.parking ? "가능" : "불가"} b={pB.parking ? "가능" : "불가"} />
                <CmpRow label="엘리베이터" a={pA.has_elevator ? "있음" : "없음"} b={pB.has_elevator ? "있음" : "없음"} />
                <CmpRow label="CCTV" a={pA.has_cctv ? "있음" : "없음"} b={pB.has_cctv ? "있음" : "없음"} />
                <CmpRow label="방범창" a={pA.has_entrance_security ? "있음" : "없음"} b={pB.has_entrance_security ? "있음" : "없음"} />
                <CmpRow label="인터폰" a={pA.has_intercom ? "있음" : "없음"} b={pB.has_intercom ? "있음" : "없음"} />
                {(pA.noise_level != null || pB.noise_level != null) && (
                  <CmpRow
                    label="소음"
                    a={pA.noise_level != null ? `${pA.noise_level}dB` : "-"}
                    b={pB.noise_level != null ? `${pB.noise_level}dB` : "-"}
                    better={pA.noise_level != null && pB.noise_level != null ? betterLower(pA.noise_level, pB.noise_level) : null}
                  />
                )}
                {(transitA || transitB) && (
                  <>
                    <CmpRow
                      label="도보"
                      a={transitA ? `${transitA.walkMin}분` : "-"}
                      b={transitB ? `${transitB.walkMin}분` : "-"}
                      better={transitA && transitB ? betterLower(transitA.walkMin, transitB.walkMin) : null}
                    />
                    <CmpRow
                      label="버스"
                      a={transitA?.busMin ? `${transitA.busMin}분` : "-"}
                      b={transitB?.busMin ? `${transitB.busMin}분` : "-"}
                      better={transitA?.busMin && transitB?.busMin ? betterLower(transitA.busMin, transitB.busMin) : null}
                    />
                  </>
                )}
                {(densityA != null || densityB != null) && (
                  <CmpRow
                    label="가로등"
                    a={densityA != null ? `${densityA.toFixed(1)}개/100m` : "-"}
                    b={densityB != null ? `${densityB.toFixed(1)}개/100m` : "-"}
                    better={densityA != null && densityB != null ? betterHigher(densityA, densityB) : null}
                  />
                )}
              </div>

              <div className="flex gap-3 border-t px-5 py-3">
                <Button className="flex-1 bg-red-500 text-white hover:bg-red-600" onClick={() => { onAnswer("a"); setShowModal(false); }}>A 선택</Button>
                <Button className="flex-1 bg-blue-500 text-white hover:bg-blue-600" onClick={() => { onAnswer("b"); setShowModal(false); }}>B 선택</Button>
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
      <span className={`text-center text-sm ${better === "a" ? "font-semibold text-green-600" : "text-gray-700"}`}>{a}</span>
      <span className={`text-center text-sm ${better === "b" ? "font-semibold text-green-600" : "text-gray-700"}`}>{b}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// 메인 Compare 컨텐츠
// ──────────────────────────────────────────────────────────

function CompareContent() {
  const router = useRouter();
  const params = useSearchParams();
  const buildingId = params.get("building") ?? "";
  const minRent = Number(params.get("minRent") ?? 10);
  const maxRent = Number(params.get("maxRent") ?? 100);
  const minDeposit = Number(params.get("minDeposit") ?? 0);
  const maxDeposit = Number(params.get("maxDeposit") ?? 50000);
  // preferences 페이지에서 넘어온 사용자 서열 (Borda prior 초기화용)
  const rank1Param = params.get("rank1");
  const rank2Param = params.get("rank2");
  // 사용자가 선택한 편의시설 타입 (콤마 구분)
  const amenityTypesParam = params.get("amenityTypes") ?? "";
  const initialRanking: number[] = [
    ...(rank1Param !== null ? [Number(rank1Param)] : []),
    ...(rank2Param !== null ? [Number(rank2Param)] : []),
  ];
  const [sessionId] = useState(() => crypto.randomUUID());

  const [building, setBuilding] = useState<Building | null>(null);
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  // Navigator ref (초기화 후 교체 없음)
  const navRef = useRef<InteractiveNavigator | null>(null);

  // 현재 스텝 (React state로 재렌더 트리거)
  const [step, setStep] = useState<NavigatorStep | null>(null);

  // Micro 단계 경로·가로등 enrich 상태
  const [enrichState, setEnrichState] = useState<PairEnrichState>({});
  const [enrichLoading, setEnrichLoading] = useState(false);

  const resultsUrl = useCallback(
    (topIds: string[], category: string) => {
      const p = new URLSearchParams({
        session: sessionId,
        building: buildingId,
        minRent: String(minRent),
        maxRent: String(maxRent),
        minDeposit: String(minDeposit),
        maxDeposit: String(maxDeposit),
        topIds: topIds.join(","),
        category,
      });
      if (amenityTypesParam) p.set("amenityTypes", amenityTypesParam);
      return `/results?${p.toString()}`;
    },
    [sessionId, buildingId, minRent, maxRent, minDeposit, maxDeposit, amenityTypesParam],
  );

  // ── 초기 데이터 로드 ──
  useEffect(() => {
    async function init() {
      setInitError(null);
      try {
        const { data: bld, error: bErr } = await supabase
          .from("buildings")
          .select("*")
          .eq("id", buildingId)
          .single();
        if (bErr) logCompareError("buildings", bErr);
        if (bld) setBuilding(bld as Building);

        let query = supabase.from("properties").select("*")
          .gte("monthly_rent", minRent)
          .lte("monthly_rent", maxRent);
        if (minDeposit > 0) query = query.gte("deposit", minDeposit);
        if (maxDeposit < 50000) query = query.lte("deposit", maxDeposit);

        const { data: props, error: pErr } = await query;
        if (pErr || !props || props.length < 2 || !bld) {
          setInitError(pErr?.message ?? "매물이 부족합니다 (최소 2개 필요)");
          return;
        }

        const typed = props as Property[];
        const { stats, commuteById } = await computeStatsWithCommute(typed, bld as Building);

        const nav = new InteractiveNavigator(typed, stats, commuteById, initialRanking.length > 0 ? initialRanking : undefined);
        navRef.current = nav;
        const s = nav.current();
        setStep(s);

        logCompare("v2 navigator init", `매물 ${typed.length}개`);
      } catch (e) {
        logCompareError("init", e);
        setInitError(`초기화 실패: ${formatCompareError(e)}`);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [buildingId, minRent, maxRent, minDeposit, maxDeposit]);

  // ── Micro 단계에서 매물 pair enrich (경로, 가로등, 편의시설) ──
  const enrichMicroPair = useCallback(async (pA: Property, pB: Property, bld: Building) => {
    setEnrichLoading(true);
    setEnrichState({});
    try {
      const [transitA, transitB] = await withTimeout(
        Promise.all([calcTransitForDisplay(pA, bld), calcTransitForDisplay(pB, bld)]),
        ENRICH_TRANSIT_TIMEOUT_MS,
        "경로 계산",
      ).catch(() => [undefined, undefined]);

      let densityA: number | undefined;
      let densityB: number | undefined;
      let lightsA: StreetLight[] = [];
      let lightsB: StreetLight[] = [];
      try {
        const allLights = await withTimeout(loadStreetLights(), ENRICH_LIGHTS_TIMEOUT_MS, "가로등");
        if (allLights.length > 0 && transitA) {
          const routeA = [...(transitA.propertyToGateRoute ?? []), ...(transitA.gateToBuildingRoute ?? [])];
          if (routeA.length >= 2) lightsA = filterLightsAlongRoute(allLights, routeA, 30);
          densityA = calcStreetLightDensity(lightsA.length, transitA.walkDistanceM);
        }
        if (allLights.length > 0 && transitB) {
          const routeB = [...(transitB.propertyToGateRoute ?? []), ...(transitB.gateToBuildingRoute ?? [])];
          if (routeB.length >= 2) lightsB = filterLightsAlongRoute(allLights, routeB, 30);
          densityB = calcStreetLightDensity(lightsB.length, transitB.walkDistanceM);
        }
      } catch { /* 가로등 선택사항 */ }

      // 편의시설 최근접 거리
      let nearestAmenitiesA: NearestAmenity[] | undefined;
      let nearestAmenitiesB: NearestAmenity[] | undefined;
      if (amenityTypesParam) {
        try {
          const types = amenityTypesParam.split(",").filter(Boolean);
          const amenities = await loadAmenitiesByTypes(types);
          if (amenities.length > 0) {
            const nearestMap = calcNearestAmenities([pA, pB], amenities);
            nearestAmenitiesA = nearestMap.get(pA.id);
            nearestAmenitiesB = nearestMap.get(pB.id);
          }
        } catch { /* 편의시설 선택사항 */ }
      }

      // 경사도 색상 폴리라인 (실패 시 빈 배열)
      let slopePolylinesA: KakaoMapPolyline[] | undefined;
      let slopePolylinesB: KakaoMapPolyline[] | undefined;
      try {
        const buildFullRoute = (t: TransitResult) => [
          ...t.propertyToGateRoute,
          ...t.gateToBuildingRoute,
        ];
        const [slA, slB] = await Promise.all([
          transitA ? (async () => {
            const route = buildFullRoute(transitA);
            if (route.length < 2) return undefined;
            const sampled = samplePoints(route);
            const elevs = await fetchRouteElevations(sampled);
            return calcSlopePolylines(sampled, elevs, 5);
          })() : Promise.resolve(undefined),
          transitB ? (async () => {
            const route = buildFullRoute(transitB);
            if (route.length < 2) return undefined;
            const sampled = samplePoints(route);
            const elevs = await fetchRouteElevations(sampled);
            return calcSlopePolylines(sampled, elevs, 5);
          })() : Promise.resolve(undefined),
        ]);
        slopePolylinesA = slA ?? undefined;
        slopePolylinesB = slB ?? undefined;
      } catch { /* 경사도 선택사항 — 실패해도 단색 경로로 fallback */ }

      setEnrichState({
        transitA: transitA ?? undefined,
        transitB: transitB ?? undefined,
        lightsA,
        lightsB,
        densityA,
        densityB,
        nearestAmenitiesA,
        nearestAmenitiesB,
        slopePolylinesA,
        slopePolylinesB,
      });
    } finally {
      setEnrichLoading(false);
    }
  }, [amenityTypesParam]);

  // ── Micro 스텝 변경 시 enrich 실행 ──
  useEffect(() => {
    if (step?.type === "micro" && building) {
      void enrichMicroPair(step.propertyA, step.propertyB, building);
    }
  }, [step, building, enrichMicroPair]);

  // ── 답변 처리 ──
  const handleAnswer = useCallback((winner: "a" | "b") => {
    const nav = navRef.current;
    if (!nav) return;

    nav.answer(winner);
    const next = nav.current();
    setStep(next);

    if (next.type === "done") {
      router.push(resultsUrl(next.topPropertyIds, next.categoryLabel));
    }
  }, [router, resultsUrl]);

  // ── 로딩 ──
  if (loading) {
    return (
      <main className="flex h-dvh items-center justify-center">
        <p className="animate-pulse text-sm text-gray-400">매물 불러오는 중…</p>
      </main>
    );
  }

  if (initError) {
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-4 px-6">
        <p className="font-semibold text-red-600">초기화 오류</p>
        <p className="max-w-md text-center text-sm text-gray-600">{initError}</p>
        <Button variant="outline" onClick={() => router.back()}>돌아가기</Button>
      </main>
    );
  }

  if (!step) {
    return (
      <main className="flex h-dvh items-center justify-center">
        <p className="animate-pulse text-sm text-gray-400">준비 중…</p>
      </main>
    );
  }

  // ── Macro 단계 ──
  if (step.type === "macro") {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={`macro-${step.round}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          <MacroCompareView step={step} onAnswer={handleAnswer} />
        </motion.div>
      </AnimatePresence>
    );
  }

  // ── Micro 단계 ──
  if (step.type === "micro") {
    if (enrichLoading && !enrichState.transitA) {
      return (
        <main className="flex h-dvh items-center justify-center">
          <p className="animate-pulse text-sm text-gray-400">매물 경로 계산 중…</p>
        </main>
      );
    }
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={`micro-${step.round}`}
          className="h-dvh"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <MicroCompareView
            step={step}
            enrichState={enrichState}
            building={building}
            onAnswer={handleAnswer}
          />
        </motion.div>
      </AnimatePresence>
    );
  }

  // Done (router.push 중)
  return (
    <main className="flex h-dvh items-center justify-center">
      <p className="animate-pulse text-sm text-gray-400">결과 페이지로 이동 중…</p>
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
