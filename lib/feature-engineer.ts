import type { Property, Building } from "@/types";
import { directionSouthNorthOneHot } from "./direction";
import { calcTransitTime } from "./transit-calculator";

export type FeatureVector = number[];

export const FEATURE_DIM = 14;

export interface FeatureStats {
  monthlyRent: { min: number; max: number };
  deposit: { min: number; max: number };
  maintenanceFee: { min: number; max: number };
  exclusiveArea: { min: number; max: number };
  rooms: { min: number; max: number };
  noiseLevel: { min: number; max: number };
  /** 통학 총시간(도보+버스) 분 — 짧을수록 φ가 높아지도록 정규화에 사용 */
  commuteTotalMin: { min: number; max: number };
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
    commuteTotalMin: { min: 5, max: 45 },
  };
}

/**
 * 필터된 매물 전체에 대해 통학 분을 구해 min/max와 id→분 맵을 만든다.
 * 도보는 DB(매물→문+문→건물), 버스는 `calcTransitTime` 규칙(DB 도보 25분 이상일 때만 ODsay).
 */
export async function computeStatsWithCommute(
  properties: Property[],
  building: Building,
): Promise<{ stats: FeatureStats; commuteById: Map<string, number> }> {
  const base = computeStats(properties);
  const commuteById = new Map<string, number>();
  const transits = await Promise.all(
    properties.map((p) => calcTransitTime(p, building)),
  );
  const totals: number[] = [];
  for (let i = 0; i < properties.length; i++) {
    const t = transits[i];
    const total = t.walkMin + t.busMin;
    commuteById.set(properties[i].id, total);
    totals.push(total);
  }
  const positives = totals.filter((x) => Number.isFinite(x) && x > 0);
  if (positives.length === 0) {
    return {
      stats: { ...base, commuteTotalMin: { min: 5, max: 45 } },
      commuteById,
    };
  }
  let min = Math.min(...positives);
  let max = Math.max(...positives);
  if (min === max) {
    min = Math.max(0, min - 1);
    max = max + 1;
  }
  return {
    stats: { ...base, commuteTotalMin: { min, max } },
    commuteById,
  };
}

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return (value - min) / (max - min);
}

/** 통학이 짧을수록 1에 가깝게 (학습 시 긍정 가중과 맞춤). 미지정·실패 시 0.5. */
function commuteFeatureValue(
  commuteTotalMin: number | null | undefined,
  stats: FeatureStats,
): number {
  if (commuteTotalMin == null || !Number.isFinite(commuteTotalMin) || commuteTotalMin <= 0) {
    return 0.5;
  }
  const { min, max } = stats.commuteTotalMin;
  if (max <= min) return 0.5;
  if (commuteTotalMin <= min) return 1;
  if (commuteTotalMin >= max) return 0;
  return (max - commuteTotalMin) / (max - min);
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
  commuteTotalMin?: number | null,
): FeatureVector {
  const [south, north] = directionSouthNorthOneHot(property.direction);
  const commute = commuteFeatureValue(commuteTotalMin, stats);
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
    commute,
  ];
}

export const FEATURE_NAMES = [
  "월세", "보증금", "관리비", "크기", "방 개수",
  "남향", "북향",
  "주차", "CCTV", "엘리베이터", "년식", "기타옵션",
  "소음",
  "통학(도보·버스)",
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
