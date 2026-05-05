import type { Property, Building } from "@/types";
import { directionSouthNorthOneHot } from "./direction";
import { calcCommuteForStats } from "./transit-calculator";

export type FeatureVector = number[];

export const FEATURE_DIM = 20;

/**
 * 학습용 통학 특징. 도보·버스 총시간은 DB 기준(computeStatsWithCommute).
 * 비교 화면 지도/경로는 `calcTransitForDisplay`(ODsay API)만 사용.
 */
export interface CommuteFeatures {
  walkMin: number;
  /** 매물→정문 + 정문→건물 DB 버스 총분. null = 미백필 → φ 0.5 */
  busTotalMin: number | null;
}

export interface FeatureStats {
  monthlyRent: { min: number; max: number };
  deposit: { min: number; max: number };
  maintenanceFee: { min: number; max: number };
  exclusiveArea: { min: number; max: number };
  rooms: { min: number; max: number };
  noiseLevel: { min: number; max: number };
  /** DB 도보만(매물→문+문→건물) — 짧을수록 φ 높게 정규화 */
  commuteWalkMin: { min: number; max: number };
  /** DB 버스 총분 — 짧을수록 φ 높게 정규화 */
  commuteBusTotalMin: { min: number; max: number };
}

export function computeStats(properties: Property[]): FeatureStats {
  const vals = (fn: (p: Property) => number) => properties.map(fn);
  const minMax = (arr: number[]) => ({
    min: Math.min(...arr),
    max: Math.max(...arr),
  });

  const noiseLevels = properties
    .map((p) => p.noise_level)
    .filter((n): n is number => n != null && n > 0);

  return {
    monthlyRent: minMax(vals((p) => p.monthly_rent)),
    deposit: minMax(vals((p) => p.deposit)),
    maintenanceFee: minMax(vals((p) => p.maintenance_fee)),
    exclusiveArea: minMax(vals((p) => p.exclusive_area)),
    rooms: minMax(vals((p) => p.rooms)),
    noiseLevel: noiseLevels.length > 0
      ? minMax(noiseLevels)
      : { min: 0, max: 100 },
    commuteWalkMin: { min: 5, max: 45 },
    commuteBusTotalMin: { min: 0, max: 90 },
  };
}

/**
 * 필터된 매물 + 선택 건물에 대해 DB 도보·DB 버스 총시간으로 commute 맵을 만든다.
 * ODsay 호출 없음.
 */
export async function computeStatsWithCommute(
  properties: Property[],
  building: Building,
): Promise<{ stats: FeatureStats; commuteById: Map<string, CommuteFeatures> }> {
  const base = computeStats(properties);
  const commuteById = new Map<string, CommuteFeatures>();
  const transits = await Promise.all(
    properties.map((p) => calcCommuteForStats(p, building)),
  );
  const walks: number[] = [];
  const busTotals: number[] = [];
  for (let i = 0; i < properties.length; i++) {
    const t = transits[i];
    commuteById.set(properties[i].id, {
      walkMin: t.walkMin,
      busTotalMin: t.busTotalMin,
    });
    if (Number.isFinite(t.walkMin) && t.walkMin > 0) walks.push(t.walkMin);
    if (t.busTotalMin != null && Number.isFinite(t.busTotalMin)) {
      busTotals.push(t.busTotalMin);
    }
  }

  let commuteWalkMin = base.commuteWalkMin;
  if (walks.length > 0) {
    let min = Math.min(...walks);
    let max = Math.max(...walks);
    if (min === max) {
      min = Math.max(0, min - 1);
      max = max + 1;
    }
    commuteWalkMin = { min, max };
  }

  let commuteBusTotalMin = base.commuteBusTotalMin;
  if (busTotals.length > 0) {
    let min = Math.min(...busTotals);
    let max = Math.max(...busTotals);
    if (min === max) {
      min = Math.max(0, min - 1);
      max = max + 1;
    }
    commuteBusTotalMin = { min, max };
  }

  return {
    stats: { ...base, commuteWalkMin, commuteBusTotalMin },
    commuteById,
  };
}

/**
 * 학습용으로는 항상 `fromMap`(DB commute)만 사용한다.
 * 표시용 transit(ODsay)은 UI/지도에만 쓰이고, 선호 업데이트에는 반영하지 않는다.
 */
export function mergeCommuteFeatures(
  _transit: { walkMin: number; busAvailable?: boolean | null } | undefined | null,
  fromMap: CommuteFeatures | undefined,
): CommuteFeatures {
  if (fromMap != null) return fromMap;
  return {
    walkMin: 0,
    busTotalMin: null,
  };
}

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return (value - min) / (max - min);
}

function commuteWalkFeatureValue(walkMin: number | null | undefined, stats: FeatureStats): number {
  if (walkMin == null || !Number.isFinite(walkMin) || walkMin <= 0) {
    return 0.5;
  }
  const { min, max } = stats.commuteWalkMin;
  if (max <= min) return 0.5;
  if (walkMin <= min) return 1;
  if (walkMin >= max) return 0;
  return (max - walkMin) / (max - min);
}

/** 짧은 버스 총시간일수록 φ↑. null = 미백필 → 0.5 */
function commuteBusTotalFeatureValue(busTotalMin: number | null | undefined, stats: FeatureStats): number {
  if (busTotalMin == null || !Number.isFinite(busTotalMin)) return 0.5;
  const { min, max } = stats.commuteBusTotalMin;
  if (max <= min) return 0.5;
  if (busTotalMin <= min) return 1;
  if (busTotalMin >= max) return 0;
  return (max - busTotalMin) / (max - min);
}

function yearScore(p: Property): number {
  if (p.within_4y) return 1.0;
  if (p.within_10y) return 0.75;
  if (p.within_15y) return 0.5;
  if (p.within_25y) return 0.25;
  return 0;
}

function optionsScore(p: Property): number {
  let count = 0;
  if (p.has_closet) count++;
  if (p.has_builtin_closet) count++;
  return count / 2;
}

/** 완만할수록 ↑. null → 0.5 (미백필 중립). 고정 범위 [0, 20%] */
function slopeFeatureValue(slope: number | null | undefined): number {
  if (slope == null || !Number.isFinite(slope)) return 0.5;
  const clamped = Math.min(Math.max(slope, 0), 20);
  return 1 - clamped / 20;
}

export function toFeatureVector(
  property: Property,
  stats: FeatureStats,
  commute?: CommuteFeatures | null,
): FeatureVector {
  const [south, north] = directionSouthNorthOneHot(property.direction);
  const walkF = commuteWalkFeatureValue(commute?.walkMin, stats);
  const busF = commuteBusTotalFeatureValue(commute?.busTotalMin, stats);
  return [
    normalize(property.monthly_rent, stats.monthlyRent.min, stats.monthlyRent.max),
    normalize(property.deposit, stats.deposit.min, stats.deposit.max),
    normalize(property.maintenance_fee, stats.maintenanceFee.min, stats.maintenanceFee.max),
    normalize(property.exclusive_area, stats.exclusiveArea.min, stats.exclusiveArea.max),
    normalize(property.rooms, stats.rooms.min, stats.rooms.max),
    south,
    north,
    property.parking ? 1 : 0,
    property.has_cctv ? 1 : 0,
    property.has_elevator ? 1 : 0,
    yearScore(property),
    optionsScore(property),
    normalize(property.noise_level ?? 50, stats.noiseLevel.min, stats.noiseLevel.max),
    walkF,
    busF,
    // 안전 보안 dim (idx 15-18)
    property.has_entrance_security ? 1 : 0,
    property.has_intercom ? 1 : 0,
    property.has_security_guard ? 1 : 0,
    property.has_card_key ? 1 : 0,
    // 거리 경사도 dim (idx 19) — 완만할수록 ↑
    slopeFeatureValue(property.walk_slope_avg),
  ];
}

export const FEATURE_NAMES = [
  "월세", "보증금", "관리비", "크기", "방 개수",
  "남향", "북향",
  "주차", "CCTV", "엘리베이터", "년식", "기타옵션",
  "소음",
  "통학(도보)",
  "통학(버스 총시간)",
  "방범창", "인터폰", "경비원", "카드키",
  "경사도",
];

export function getMeanWeightLabels(
  weights: FeatureVector,
): Array<{ name: string; value: number }> {
  const labels = FEATURE_NAMES.map((name, i) => ({
    name,
    value: weights[i] ?? 0,
  }));
  labels.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return labels;
}
