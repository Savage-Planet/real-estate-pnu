import type { Property } from "@/types";
import type { CommuteFeatures, FeatureStats } from "../feature-engineer";
import { computeStats } from "../feature-engineer";

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randBool(p = 0.5): boolean {
  return Math.random() < p;
}

function pickDirection(): string {
  const dirs = ["남", "남동", "동", "남서", "서", "북", "북동", "북서"];
  return dirs[Math.floor(Math.random() * dirs.length)];
}

function yearFlags(): Pick<Property, "within_4y" | "within_10y" | "within_15y" | "within_25y"> {
  const age = Math.random();
  if (age < 0.15) return { within_4y: true, within_10y: true, within_15y: true, within_25y: true };
  if (age < 0.35) return { within_4y: false, within_10y: true, within_15y: true, within_25y: true };
  if (age < 0.55) return { within_4y: false, within_10y: false, within_15y: true, within_25y: true };
  if (age < 0.80) return { within_4y: false, within_10y: false, within_15y: false, within_25y: true };
  return { within_4y: false, within_10y: false, within_15y: false, within_25y: false };
}

export function generateSyntheticProperties(count: number): {
  properties: Property[];
  stats: FeatureStats;
  commuteById: Map<string, CommuteFeatures>;
} {
  const BUSAN_LAT = 35.234;
  const BUSAN_LNG = 129.08;

  const properties: Property[] = [];
  const commuteById = new Map<string, CommuteFeatures>();

  for (let i = 0; i < count; i++) {
    const id = `syn-${String(i).padStart(4, "0")}`;
    const lat = BUSAN_LAT + (Math.random() - 0.5) * 0.02;
    const lng = BUSAN_LNG + (Math.random() - 0.5) * 0.02;
    const area = rand(15, 80);

    const p: Property = {
      id,
      address: `합성 매물 ${i + 1}`,
      lat,
      lng,
      trade_type: randBool(0.6) ? "월세" : "전세",
      property_type: "원룸",
      rooms: Math.ceil(rand(1, 4)),
      parking: randBool(0.4) ? 1 : 0,
      direction: pickDirection(),
      monthly_rent: Math.round(rand(20, 80)),
      deposit: Math.round(rand(100, 5000)),
      supply_area: area * 1.2,
      exclusive_area: area,
      area_ratio: 83,
      maintenance_fee: Math.round(rand(10000, 100000)),
      has_elevator: randBool(0.5),
      ...yearFlags(),
      has_closet: randBool(0.6),
      has_builtin_closet: randBool(0.3),
      has_entrance_security: randBool(0.4),
      has_cctv: randBool(0.5),
      noise_level: Math.round(rand(20, 80)),
      nearest_gate: "gate-main",
      straight_dist_to_gate: rand(200, 3000),
      walk_to_gate_min: rand(3, 40),
      walk_to_gate_m: rand(200, 3500),
      walk_to_gate_route: null,
      bus_to_gate_min: randBool(0.7) ? rand(5, 30) : null,
    };

    properties.push(p);

    const walkMin = rand(5, 45);
    const busTotalMin = randBool(0.7) ? rand(5, 60) : null;
    commuteById.set(id, { walkMin, busTotalMin });
  }

  const stats = computeStats(properties);
  stats.commuteWalkMin = { min: 5, max: 45 };
  stats.commuteBusTotalMin = { min: 0, max: 90 };

  return { properties, stats, commuteById };
}
