const ODSAY_KEY = process.env.NEXT_PUBLIC_ODSAY_KEY ?? "";
const BASE_URL = "https://api.odsay.com/v1/api";

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface OdsayRoute {
  totalTime: number;
  busTime: number;
  walkTime: number;
  path: LatLngPoint[];
}

const cache = new Map<string, { data: OdsayRoute; ts: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function cacheKey(sx: number, sy: number, ex: number, ey: number): string {
  return `${sx.toFixed(5)},${sy.toFixed(5)}-${ex.toFixed(5)},${ey.toFixed(5)}`;
}

function extractPath(
  subPaths: Array<Record<string, unknown>>,
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
): LatLngPoint[] {
  const points: LatLngPoint[] = [{ lat: startLat, lng: startLng }];

  for (const sub of subPaths) {
    const trafficType = sub.trafficType as number;
    if (trafficType === 2 || trafficType === 1) {
      const stations = (sub.passStopList as Record<string, unknown>)
        ?.stations as Array<Record<string, unknown>> | undefined;
      if (stations) {
        for (const st of stations) {
          const y = Number(st.y);
          const x = Number(st.x);
          if (!isNaN(y) && !isNaN(x)) {
            points.push({ lat: y, lng: x });
          }
        }
      }
    }
  }

  points.push({ lat: endLat, lng: endLng });
  return points;
}

export async function searchBusRoute(
  startLng: number,
  startLat: number,
  endLng: number,
  endLat: number,
): Promise<OdsayRoute | null> {
  const key = cacheKey(startLng, startLat, endLng, endLat);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  if (!ODSAY_KEY) return null;

  const url = new URL(`${BASE_URL}/searchPubTransPathT`);
  url.searchParams.set("SX", String(startLng));
  url.searchParams.set("SY", String(startLat));
  url.searchParams.set("EX", String(endLng));
  url.searchParams.set("EY", String(endLat));
  url.searchParams.set("apiKey", ODSAY_KEY);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const json = await res.json();

    const paths = json?.result?.path;
    if (!Array.isArray(paths) || paths.length === 0) return null;

    const best = paths[0];
    const info = best.info;
    const subPaths = (best.subPath ?? []) as Array<Record<string, unknown>>;

    const route: OdsayRoute = {
      totalTime: info.totalTime ?? 0,
      busTime: info.busTransitCount > 0 ? Math.round(info.totalTime - (info.totalWalk ?? 0) / 60) : 0,
      walkTime: Math.round((info.totalWalk ?? 0) / 60),
      path: extractPath(subPaths, startLat, startLng, endLat, endLng),
    };

    cache.set(key, { data: route, ts: Date.now() });
    return route;
  } catch {
    return null;
  }
}
