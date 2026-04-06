import { calcWalkRoute, type WalkRouteResult, type LatLngPoint } from "./gate-distance";
import { searchBusRoute, type OdsayRoute } from "./odsay";
import type { Property, Building } from "@/types";

export type { LatLngPoint };

/** DB로만 계산한 도보(매물→문+문→건물)가 이 분 이상일 때만 ODsay 버스 API 호출 */
export const DB_WALK_MIN_FOR_BUS_API = 25;

export interface TransitResult {
  walkMin: number;
  walkDistanceM: number;
  nearestGate: string;
  propertyToGateRoute: LatLngPoint[];
  gateToBuildingRoute: LatLngPoint[];
  busMin: number;
  busPath: LatLngPoint[];
}

/** 도보+버스 합산 분 (학습 특징용). */
export function totalTransitMinutes(t: TransitResult | undefined | null): number | null {
  if (!t) return null;
  const m = t.walkMin + t.busMin;
  return Number.isFinite(m) && m > 0 ? m : null;
}

/**
 * 도보: 항상 DB(`calcWalkRoute`). 버스: DB 도보 분이 `DB_WALK_MIN_FOR_BUS_API` 이상인 경우만 API.
 * 지도·학습·순위 모두 동일 규칙.
 */
export async function calcTransitTime(
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
    };
  }

  let busMin = 0;
  let busPath: LatLngPoint[] = [];

  if (result.totalWalkMin >= DB_WALK_MIN_FOR_BUS_API) {
    try {
      const busRoute: OdsayRoute | null = await searchBusRoute(
        property.lng, property.lat,
        building.lng, building.lat,
      );
      if (busRoute) {
        busMin = busRoute.busTime;
        busPath = busRoute.path;
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
  };
}
