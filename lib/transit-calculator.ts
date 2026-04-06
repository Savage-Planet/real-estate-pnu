import { calcWalkRoute, type WalkRouteResult, type LatLngPoint } from "./gate-distance";
import { searchBusRoute, type OdsayRoute } from "./odsay";
import type { Property, Building } from "@/types";

export type { LatLngPoint };

const BUS_THRESHOLD_MIN = 20;

export interface TransitResult {
  walkMin: number;
  walkDistanceM: number;
  nearestGate: string;
  propertyToGateRoute: LatLngPoint[];
  gateToBuildingRoute: LatLngPoint[];
  busMin: number;
  busPath: LatLngPoint[];
}

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

  if (result.totalWalkMin >= BUS_THRESHOLD_MIN) {
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
