import type { Property } from "@/types";
import { directionSouthNorthOneHot } from "./direction";

export type FeatureVector = number[];

export const FEATURE_DIM = 13;

export interface FeatureStats {
  monthlyRent: { min: number; max: number };
  deposit: { min: number; max: number };
  maintenanceFee: { min: number; max: number };
  exclusiveArea: { min: number; max: number };
  rooms: { min: number; max: number };
  noiseLevel: { min: number; max: number };
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
  };
}

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return (value - min) / (max - min);
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
): FeatureVector {
  const [south, north] = directionSouthNorthOneHot(property.direction);
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
  ];
}

export const FEATURE_NAMES = [
  "월세", "보증금", "관리비", "크기", "방 개수",
  "남향", "북향",
  "주차", "CCTV", "엘리베이터", "년식", "기타옵션",
  "소음",
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
