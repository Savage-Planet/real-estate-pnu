import { supabase } from "./supabase";
import type { Property, BuildingGateRoute } from "@/types";

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface WalkRouteResult {
  totalWalkMin: number;
  totalWalkDistanceM: number;
  nearestGate: string;
  propertyToGateRoute: LatLngPoint[];
  gateToBuildingRoute: LatLngPoint[];
}

function parseRoutePoints(route: Array<[number, number]> | null): LatLngPoint[] {
  if (!route || !Array.isArray(route)) return [];
  return route.map(([lat, lng]) => ({ lat, lng }));
}

const bgrCache = new Map<string, BuildingGateRoute | null>();

async function fetchBuildingGateRoute(
  buildingId: string,
  gateId: string,
): Promise<BuildingGateRoute | null> {
  const key = `${buildingId}:${gateId}`;
  if (bgrCache.has(key)) return bgrCache.get(key)!;

  const { data, error } = await supabase
    .from("building_gate_routes")
    .select("*")
    .eq("building_id", buildingId)
    .eq("gate_id", gateId)
    .single();

  let result = error || !data ? null : (data as BuildingGateRoute);

  // DB에 정문→건물 경로가 없으면 Tmap으로 즉석 계산하여 보완
  if (!result) {
    result = await backfillBuildingGateRoute(buildingId, gateId);
  }

  bgrCache.set(key, result);
  return result;
}

/** building_gate_routes 가 비었을 때 Tmap(/api/walk-route)으로 보행 경로를 계산 */
async function backfillBuildingGateRoute(
  buildingId: string,
  gateId: string,
): Promise<BuildingGateRoute | null> {
  try {
    // 건물·정문 좌표 조회
    const [{ data: b }, { data: g }] = await Promise.all([
      supabase.from("buildings").select("lat,lng").eq("id", buildingId).single(),
      supabase.from("gates").select("lat,lng").eq("id", gateId).single(),
    ]);
    const building = b as { lat: number; lng: number } | null;
    const gate = g as { lat: number; lng: number } | null;
    if (!building || !gate) return null;

    // 정문(출발) → 건물(도착) 보행 경로
    const url = `/api/walk-route?sx=${gate.lng}&sy=${gate.lat}&ex=${building.lng}&ey=${building.lat}&building_id=${encodeURIComponent(buildingId)}&gate_id=${encodeURIComponent(gateId)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const data = await res.json() as {
      ok: boolean;
      walkMin?: number;
      walkM?: number;
      route?: Array<[number, number]>;
    };
    if (!data.ok || !data.route || data.route.length < 2) return null;

    return {
      id: -1,
      building_id: buildingId,
      gate_id: gateId,
      walk_time_min: data.walkMin ?? 0,
      walk_distance_m: data.walkM ?? 0,
      walk_route: data.route,
    };
  } catch {
    return null;
  }
}

/**
 * 사용자가 고른 건물 기준, DB만 사용해 도보 시간·거리를 합산한다.
 * 매물 → 정문(`properties.walk_to_*`) + 정문 → 건물(`building_gate_routes`).
 */
export async function calcWalkRoute(
  property: Property,
  buildingId: string,
): Promise<WalkRouteResult | null> {
  const gateId = property.nearest_gate;
  if (!gateId || property.walk_to_gate_min == null) return null;

  const bgr = await fetchBuildingGateRoute(buildingId, gateId);
  if (!bgr) return null;

  return {
    totalWalkMin: Math.round((property.walk_to_gate_min + bgr.walk_time_min) * 10) / 10,
    totalWalkDistanceM: (property.walk_to_gate_m ?? 0) + bgr.walk_distance_m,
    nearestGate: gateId,
    propertyToGateRoute: parseRoutePoints(property.walk_to_gate_route),
    gateToBuildingRoute: parseRoutePoints(bgr.walk_route),
  };
}

/** 학습·표시 공통: DB만으로 매물→문+문→건물 도보 분. 실패 시 null. */
export async function getDbWalkMinutesToBuilding(
  property: Property,
  buildingId: string,
): Promise<number | null> {
  const r = await calcWalkRoute(property, buildingId);
  return r != null ? r.totalWalkMin : null;
}
