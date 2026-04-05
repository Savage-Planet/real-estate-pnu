import { supabase } from "./supabase";
import { haversine } from "./geo";
import type { StreetLight } from "@/types";

let lightsCache: StreetLight[] | null = null;

export async function loadStreetLights(): Promise<StreetLight[]> {
  if (lightsCache) return lightsCache;
  try {
    const { data, error } = await supabase.from("street_lights").select("id,lat,lng");
    if (error || !data) {
      lightsCache = [];
      return lightsCache;
    }
    lightsCache = data as StreetLight[];
  } catch {
    lightsCache = [];
  }
  return lightsCache;
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) return haversine(px, py, ax, ay);

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projLat = ax + t * dx;
  const projLng = ay + t * dy;
  return haversine(px, py, projLat, projLng);
}

export function filterLightsAlongRoute(
  lights: StreetLight[],
  routePoints: Array<{ lat: number; lng: number }>,
  bufferM: number = 30,
): StreetLight[] {
  if (routePoints.length < 2) return [];

  return lights.filter((light) => {
    for (let i = 0; i < routePoints.length - 1; i++) {
      const a = routePoints[i];
      const b = routePoints[i + 1];
      const dist = distanceToSegment(light.lat, light.lng, a.lat, a.lng, b.lat, b.lng);
      if (dist <= bufferM) return true;
    }
    return false;
  });
}

export function filterLightsAlongStraightLine(
  lights: StreetLight[],
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  bufferM: number = 30,
): StreetLight[] {
  return lights.filter((light) => {
    const dist = distanceToSegment(
      light.lat, light.lng,
      startLat, startLng,
      endLat, endLng,
    );
    return dist <= bufferM;
  });
}

export function calcStreetLightDensity(
  lightCount: number,
  distanceM: number,
): number {
  if (distanceM <= 0) return 0;
  return (lightCount / distanceM) * 100;
}
