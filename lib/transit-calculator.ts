import { calcWalkRoute, type WalkRouteResult, type LatLngPoint } from "./gate-distance";
import { busTotalMinutesFromDb } from "./commute-db";
import type { Property, Building } from "@/types";

/** 서버 프록시를 통해 버스 경로 조회 (CORS 우회) */
async function fetchBusRouteViaProxy(
  startLng: number, startLat: number,
  endLng: number, endLat: number,
): Promise<{ busMin: number; busPath: LatLngPoint[]; reason?: string }> {
  try {
    const url = `/api/bus-route?sx=${startLng}&sy=${startLat}&ex=${endLng}&ey=${endLat}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return { busMin: 0, busPath: [], reason: `proxy_http_${res.status}` };
    }
    const data = await res.json() as { ok: boolean; reason?: string; busMin?: number; path?: LatLngPoint[]; referer_used?: string; v?: number };
    if (!data.ok) {
      const reason = `${data.reason ?? "unknown"}|ref:${data.referer_used ?? "?"}|v:${data.v ?? 0}`;
      console.warn("[bus-route] proxy returned error:", reason);
      return { busMin: 0, busPath: [], reason };
    }
    if (!data.path || data.path.length < 2) {
      return { busMin: 0, busPath: [], reason: "no_path" };
    }
    return { busMin: data.busMin ?? 0, busPath: data.path };
  } catch (e) {
    console.warn("[bus-route] proxy fetch failed:", e);
    return { busMin: 0, busPath: [], reason: `fetch_err:${String(e).slice(0, 60)}` };
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
  /** 디버깅용: ODsay 호출 실패 이유 (성공 시 undefined) */
  busReason?: string;
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

  // DB에 저장된 버스 시간을 fallback으로 먼저 세팅
  // → ODsay 실패해도 카드에 버스 시간 + 버스 버튼은 항상 표시
  const dbBusMin = busTotalMinutesFromDb(property, building);
  let busMin = dbBusMin ?? 0;
  let busPath: LatLngPoint[] = [];
  let busAvailable: boolean | null = busMin > 0 ? false : null;
  let busReason: string | undefined;

  // ODsay로 실제 경로 조회 시도 (지도 선 표시용)
  if (result.totalWalkMin >= DB_WALK_MIN_FOR_BUS_API) {
    const busResult = await fetchBusRouteViaProxy(
      property.lng, property.lat,
      building.lng, building.lat,
    );
    if (busResult.busPath.length >= 2) {
      busMin = busResult.busMin > 0 ? busResult.busMin : busMin;
      busPath = busResult.busPath;
      busAvailable = true;
    } else {
      busReason = busResult.reason;
    }
  } else {
    busReason = `walk_too_short(${result.totalWalkMin}min)`;
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
    busReason,
  };
}
