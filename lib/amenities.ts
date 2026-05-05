/**
 * lib/amenities.ts
 * ================
 * 주변 편의시설(amenities) 로딩 · 거리 계산 · 점수화
 */

import { supabase } from "@/lib/supabase";
import { haversine } from "@/lib/geo";
import type { Amenity, Property } from "@/types";

// ──────────────────────────────────────────────────────────
// 편의시설 타입 정의
// ──────────────────────────────────────────────────────────

export interface AmenityTypeDef {
  type: string;
  label: string;
  icon: string;
}

export const AMENITY_TYPES: AmenityTypeDef[] = [
  { type: "convenience_store", label: "편의점",    icon: "🏪" },
  { type: "gym",               label: "헬스장",    icon: "💪" },
  { type: "olive_young",       label: "올리브영",  icon: "💊" },
  { type: "coin_laundry",      label: "코인세탁",  icon: "🫧" },
  { type: "hospital",          label: "병원",      icon: "🏥" },
  { type: "pharmacy",          label: "약국",      icon: "💉" },
  { type: "bank",              label: "은행",      icon: "🏦" },
];

export function getAmenityDef(type: string): AmenityTypeDef | undefined {
  return AMENITY_TYPES.find((t) => t.type === type);
}

// ──────────────────────────────────────────────────────────
// Supabase 조회
// ──────────────────────────────────────────────────────────

/**
 * 선택된 타입의 amenity만 DB에서 가져옴.
 * 타입 목록이 비어 있으면 빈 배열 반환.
 */
export async function loadAmenitiesByTypes(types: string[]): Promise<Amenity[]> {
  if (types.length === 0) return [];
  const { data, error } = await supabase
    .from("amenities")
    .select("*")
    .in("type", types);
  if (error || !data) return [];
  return data as Amenity[];
}

// ──────────────────────────────────────────────────────────
// 최근접 편의시설 계산
// ──────────────────────────────────────────────────────────

export interface NearestAmenity {
  type: string;
  label: string;
  icon: string;
  name: string;
  distM: number;
  lat: number;
  lng: number;
}

/**
 * 각 매물(property)에 대해, 선택된 각 타입별 최근접 amenity를 계산.
 * 반환: Map< propertyId, NearestAmenity[] >  (타입 1개당 최대 1개)
 */
export function calcNearestAmenities(
  properties: Property[],
  amenities: Amenity[],
): Map<string, NearestAmenity[]> {
  const result = new Map<string, NearestAmenity[]>();
  if (amenities.length === 0) return result;

  // 타입별로 amenity 그룹핑
  const byType = new Map<string, Amenity[]>();
  for (const a of amenities) {
    if (!byType.has(a.type)) byType.set(a.type, []);
    byType.get(a.type)!.push(a);
  }

  for (const p of properties) {
    const nearest: NearestAmenity[] = [];
    for (const [type, list] of byType.entries()) {
      let minDist = Infinity;
      let best: Amenity | null = null;
      for (const a of list) {
        const d = haversine(p.lat, p.lng, a.lat, a.lng);
        if (d < minDist) {
          minDist = d;
          best = a;
        }
      }
      if (best) {
        const def = getAmenityDef(type);
        nearest.push({
          type,
          label: def?.label ?? type,
          icon:  def?.icon  ?? "📍",
          name:  best.name,
          distM: Math.round(minDist),
          lat:   best.lat,
          lng:   best.lng,
        });
      }
    }
    // 거리 순 정렬
    nearest.sort((a, b) => a.distM - b.distM);
    result.set(p.id, nearest);
  }
  return result;
}

// ──────────────────────────────────────────────────────────
// 점수 계산 (0~1 → 높을수록 편의시설 가까움)
// ──────────────────────────────────────────────────────────

const MAX_DIST_M = 1_200; // 이 거리 이상이면 점수 0

/**
 * 선택된 편의시설 타입별 최근접 거리를 평균내어 0~1 점수 반환.
 * 가중치는 가장 가까운 타입일수록 높게 (선형 decay).
 */
export function calcAmenityProximityScore(nearest: NearestAmenity[]): number {
  if (nearest.length === 0) return 0;
  const scores = nearest.map((n) => Math.max(0, 1 - n.distM / MAX_DIST_M));
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}
