import { calcWalkRoute, type WalkRouteResult, type LatLngPoint } from "./gate-distance";
import { busTotalMinutesFromDb } from "./commute-db";
import type { Property, Building } from "@/types";

/** 서버 프록시를 통해 버스 경로 조회 (CORS 우회) */
async function fetchBusRouteViaProxy(
  startLng: number, startLat: number,
  endLng: number, endLat: number,
): Promise<{ busMin: number; busPath: LatLngPoint[] } | null> {
  try {
    const url = `/api/bus-route?sx=${startLng}&sy=${startLat}&ex=${endLng}&ey=${endLat}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean; busMin?: number; path?: LatLngPoint[] };
    if (!data.ok || !data.path || data.path.length < 2) return null;
    return { busMin: data.busMin ?? 0, busPath: data.path };
  } catch {
    return null;
  }
}

export type { LatLngPoint };

/** DB 도보(매물→문+문→건물)가 이 분 이상일 때만 버스 API 호출·경로 표시 */
export const DB_WALK_MIN_FOR_BUS_API = 5;

export interface TransitResult {
  walkMin: number;
  walkDistanceM: number;
  nearestGate: string;
  propertyToGateRoute: LatLngPoint[];
  gateToBuildingRoute: LatLngPoint[];
  busMin: number;
  busPath: LatLngPoint[];
  /** DB 도보가 임계 이상일 때만 ODsay 조회. null = 조회 안 함(도보 짧음), true/false = 경로 유무 */
  busAvailable: boolean | null;
}

/**
 * 초기 통계·commute 맵용. DB 도보 + DB 버스 총분 (properties.bus_to_gate_min + buildings.bus_from_gate_min).
 * ODsay 호출 없음. 버스 미백필 → busTotalMin null → φ 0.5.
 * 지도 표시 버스는 `calcTransitForDisplay`에서만 API.
 */
export async function calcCommuteForStats(
  property: Property,
  building: Building,
): Promise<{ walkMin: number; busTotalMin: number | null }> {
  const result: WalkRouteResult | null = await calcWalkRoute(property, building.id);
  const walkMin = result?.totalWalkMin ?? 0;
  const busTotalMin = busTotalMinutesFromDb(property, building);
  return { walkMin, busTotalMin };
}

/**
 * 비교 화면·지도 표시용. DB 도보가 `DB_WALK_MIN_FOR_BUS_API` 이상일 때만 ODsay로 경로·시간 표시.
 */
export async function calcTransitForDisplay(
  property: Property,
  building: Building,
): Promise<TransitResult> {
  const result: WalkRouteResult | null = await calcWalkRoute(property, building.id);

  if (!result) {
    return {
      walkMin: 0,
      walkDistanceM: 0,
      nearestGate: property.nearest_gate ?? "",
      propertyToGateRoute: [],
      gateToBuildingRoute: [],
      busMin: 0,
      busPath: [],
      busAvailable: null,
    };
  }

  let busMin = 0;
  let busPath: LatLngPoint[] = [];
  let busAvailable: boolean | null = null;

  if (result.totalWalkMin >= DB_WALK_MIN_FOR_BUS_API) {
    busAvailable = false;
    try {
      const busResult = await fetchBusRouteViaProxy(
        property.lng, property.lat,
        building.lng, building.lat,
      );
      if (busResult) {
        busMin = busResult.busMin;
        busPath = busResult.busPath;
        busAvailable = true;
      }
    } catch {
      /* 버스 경로 실패 시 무시 */
    }
  }

  return {
    walkMin: result.totalWalkMin,
    walkDistanceM: result.totalWalkDistanceM,
    nearestGate: result.nearestGate,
    propertyToGateRoute: result.propertyToGateRoute,
    gateToBuildingRoute: result.gateToBuildingRoute,
    busMin,
    busPath,
    busAvailable,
  };
}
