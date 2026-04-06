import type { Property, Building } from "@/types";
import { directionSouthNorthOneHot } from "./direction";
import { calcCommuteForStats } from "./transit-calculator";

export type FeatureVector = number[];

export const FEATURE_DIM = 15;

/** DB 도보(분) + 버스 이진. busAvailable: null = 미조회(φ 0.5) — 풀 통계는 DB만, 페어 표시 후 merge 시 API 결과 반영 */
export interface CommuteFeatures {
  walkMin: number;
  busAvailable: boolean | null;
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
  };
}

/**
 * 필터된 매물 전체에 대해 DB 도보 분만 구한다. 버스 이진은 ODsay 없이 null(φ 0.5).
 * 실제 버스 가능 여부는 페어 표시 시에만 API로 알 수 있고, `mergeCommuteFeatures`로 학습에 반영.
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
  for (let i = 0; i < properties.length; i++) {
    const t = transits[i];
    commuteById.set(properties[i].id, {
      walkMin: t.walkMin,
      busAvailable: t.busAvailable,
    });
    if (Number.isFinite(t.walkMin) && t.walkMin > 0) walks.push(t.walkMin);
  }
  if (walks.length === 0) {
    return {
      stats: { ...base, commuteWalkMin: { min: 5, max: 45 } },
      commuteById,
    };
  }
  let min = Math.min(...walks);
  let max = Math.max(...walks);
  if (min === max) {
    min = Math.max(0, min - 1);
    max = max + 1;
  }
  return {
    stats: { ...base, commuteWalkMin: { min, max } },
    commuteById,
  };
}

/** 표시용 transit(ODsay 포함)이 있으면 우선, 없으면 맵(도보 DB만). */
export function mergeCommuteFeatures(
  transit: { walkMin: number; busAvailable: boolean | null } | undefined | null,
  fromMap: CommuteFeatures | undefined,
): CommuteFeatures {
  if (transit != null) {
    return { walkMin: transit.walkMin, busAvailable: transit.busAvailable };
  }
  return fromMap ?? { walkMin: 0, busAvailable: null };
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

/** null = API 미조회(도보 짧음) → 0.5, true → 1, false → 0 */
function commuteBusBinaryFeature(busAvailable: boolean | null | undefined): number {
  if (busAvailable === null || busAvailable === undefined) return 0.5;
  return busAvailable ? 1 : 0;
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
  if (p.has_entrance_security) count++;
  return count / 3;
}

export function toFeatureVector(
  property: Property,
  stats: FeatureStats,
  commute?: CommuteFeatures | null,
): FeatureVector {
  const [south, north] = directionSouthNorthOneHot(property.direction);
  const walkF = commuteWalkFeatureValue(commute?.walkMin, stats);
  const busF = commuteBusBinaryFeature(commute?.busAvailable);
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
  ];
}

export const FEATURE_NAMES = [
  "월세", "보증금", "관리비", "크기", "방 개수",
  "남향", "북향",
  "주차", "CCTV", "엘리베이터", "년식", "기타옵션",
  "소음",
  "통학(도보)",
  "버스 가능",
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
