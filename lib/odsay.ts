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

/** Python 백필·DB 저장과 동일한 형태 */
export interface OdsayTransitBackfillPayload {
  total_time_min: number;
  transit_count: number;
  bus_time_min: number;
  walk_time_min: number;
  summary: string;
  path_type: number;
}

const cache = new Map<string, { data: OdsayRoute; ts: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const RETRY_DELAYS_MS = [300, 800];

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
    let json: any = null;
    for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
      const res = await fetch(url.toString(), {
        method: "GET",
        cache: "no-store",
      });
      if (res.ok) {
        json = await res.json();
        break;
      }
      if (i < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
      }
    }
    if (!json) return null;

    const paths = json?.result?.path;
    if (!Array.isArray(paths) || paths.length === 0) return null;

    const best = paths[0];
    const info = best.info;
    const subPaths = (best.subPath ?? []) as Array<Record<string, unknown>>;

    const route: OdsayRoute = {
      totalTime: info.totalTime ?? 0,
      busTime:
        typeof info.busTransitTime === "number"
          ? info.busTransitTime
          : Math.max(0, Math.round((info.totalTime ?? 0) - (info.totalWalk ?? 0) / 60)),
      walkTime: Math.round((info.totalWalk ?? 0) / 60),
      path: extractPath(subPaths, startLat, startLng, endLat, endLng),
    };

    cache.set(key, { data: route, ts: Date.now() });
    return route;
  } catch {
    return null;
  }
}

/**
 * ODsay searchPubTransPathT 전체 파싱 (백필·API 프록시용).
 * 브라우저와 동일하게 NEXT_PUBLIC_ODSAY_KEY 사용.
 */
export async function fetchOdsayTransitBackfill(
  startLng: number,
  startLat: number,
  endLng: number,
  endLat: number,
): Promise<
  | { ok: true; data: OdsayTransitBackfillPayload }
  | { ok: false; reason: string }
> {
  if (!ODSAY_KEY) {
    return { ok: false, reason: "missing_NEXT_PUBLIC_ODSAY_KEY" };
  }

  const url = new URL(`${BASE_URL}/searchPubTransPathT`);
  url.searchParams.set("SX", String(startLng));
  url.searchParams.set("SY", String(startLat));
  url.searchParams.set("EX", String(endLng));
  url.searchParams.set("EY", String(endLat));
  url.searchParams.set("apiKey", ODSAY_KEY);

  try {
    let json: any = null;
    for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
      const res = await fetch(url.toString(), {
        method: "GET",
        cache: "no-store",
      });
      if (res.ok) {
        json = await res.json();
        break;
      }
      if (i < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
      }
    }
    if (!json) {
      return { ok: false, reason: "odsay_http_failed" };
    }

    if (json.error) {
      return { ok: false, reason: `odsay_error:${JSON.stringify(json.error)}` };
    }
    if (!json.result) {
      return { ok: false, reason: "odsay_no_result" };
    }

    const paths = json.result.path as unknown[];
    if (!Array.isArray(paths) || paths.length === 0) {
      return { ok: false, reason: "no_path" };
    }

    const best = paths[0] as Record<string, unknown>;
    const info = (best.info ?? {}) as Record<string, unknown>;
    const totalTime = Number(info.totalTime ?? 0);
    const transitCount = Number(info.transitCount ?? 0);
    const totalWalk = Number(info.totalWalk ?? 0);
    const busTime =
      typeof info.busTransitTime === "number"
        ? info.busTransitTime
        : Math.max(0, totalTime - totalWalk / 60);
    const pathType = Number(best.pathType ?? 0);
    const subPaths = (best.subPath ?? []) as Array<Record<string, unknown>>;

    const routeParts: string[] = [];
    for (const sp of subPaths) {
      const trafficType = Number(sp.trafficType ?? 0);
      if (trafficType === 1) {
        const lane = (sp.lane as Array<Record<string, unknown>> | undefined) ?? [];
        const name = (lane[0]?.name as string) ?? "지하철";
        routeParts.push(`🚇${name}`);
      } else if (trafficType === 2) {
        const lane = (sp.lane as Array<Record<string, unknown>> | undefined) ?? [];
        const name = (lane[0]?.busNo as string) ?? "버스";
        routeParts.push(`🚌${name}`);
      } else if (trafficType === 3) {
        const sectionTime = Number(sp.sectionTime ?? 0);
        if (sectionTime > 0) routeParts.push(`🚶${sectionTime}분`);
      }
    }
    const summary = routeParts.length > 0 ? routeParts.join(" → ") : "경로 없음";

    return {
      ok: true,
      data: {
        total_time_min: totalTime,
        transit_count: transitCount,
        bus_time_min: busTime,
        walk_time_min: totalWalk,
        summary,
        path_type: pathType,
      },
    };
  } catch (e) {
    return { ok: false, reason: `request_error:${String(e)}` };
  }
}
