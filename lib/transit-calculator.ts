import { calcWalkRoute, type WalkRouteResult, type LatLngPoint } from "./gate-distance";
import { searchBusRoute, type OdsayRoute } from "./odsay";
import type { Property, Building } from "@/types";

export type { LatLngPoint };

/** DB 도보(매물→문+문→건물)가 이 분 이상일 때만 버스 API 호출·경로 표시 */
export const DB_WALK_MIN_FOR_BUS_API = 18;

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
 * 초기 통계·commute 맵용. DB 도보만 계산 — ODsay 호출 없음(버스 이진은 null → φ 0.5).
 * 버스 API는 `calcTransitForDisplay`(페어 표시)에서만 호출.
 */
export async function calcCommuteForStats(
  property: Property,
  building: Building,
): Promise<{ walkMin: number; busAvailable: null }> {
  const result: WalkRouteResult | null = await calcWalkRoute(property, building.id);
  if (!result) return { walkMin: 0, busAvailable: null };
  return { walkMin: result.totalWalkMin, busAvailable: null };
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
      const busRoute: OdsayRoute | null = await searchBusRoute(
        property.lng, property.lat,
        building.lng, building.lat,
      );
      if (busRoute) {
        busMin = busRoute.busTime;
        busPath = busRoute.path;
        busAvailable = true;
      }
    } catch {
      /* ODsay 실패 시 무시 */
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
