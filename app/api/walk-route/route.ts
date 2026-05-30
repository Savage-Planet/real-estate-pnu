/**
 * GET /api/walk-route — Tmap 보행 경로 프록시 (+ 선택적 building_gate_routes 캐시)
 * params: sx, sy(출발 lng/lat), ex, ey(도착 lng/lat)
 * optional: building_id, gate_id → 결과를 building_gate_routes 에 캐시
 */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/admin-auth";

const TMAP_KEY = (process.env.NEXT_PUBLIC_TMAP_KEY ?? "").trim();

async function calcWalkRoute(
  startLat: number, startLng: number,
  endLat: number, endLng: number,
): Promise<{ walkMin: number; walkM: number; route: [number, number][] } | null> {
  if (!TMAP_KEY) return null;
  try {
    const res = await fetch("https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1&format=json", {
      method: "POST",
      headers: { "Content-Type": "application/json", appKey: TMAP_KEY },
      body: JSON.stringify({
        startX: String(startLng), startY: String(startLat),
        endX: String(endLng), endY: String(endLat),
        reqCoordType: "WGS84GEO", resCoordType: "WGS84GEO",
        startName: "출발지", endName: "도착지",
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      features: Array<{
        geometry: { type: string; coordinates: number[] | number[][] };
        properties: { totalDistance?: number; totalTime?: number };
      }>;
    };
    const summary = data.features?.[0]?.properties;
    const walkM = summary?.totalDistance ?? 0;
    const walkMin = Math.round((summary?.totalTime ?? 0) / 60 * 10) / 10;

    const route: [number, number][] = [];
    for (const f of data.features ?? []) {
      if (f.geometry.type === "LineString") {
        for (const c of f.geometry.coordinates as number[][]) {
          if (Array.isArray(c) && c.length >= 2) route.push([c[1], c[0]]);
        }
      } else if (f.geometry.type === "Point") {
        const c = f.geometry.coordinates as number[];
        if (c.length >= 2) route.push([c[1], c[0]]);
      }
    }
    if (route.length < 2) return null;
    return { walkMin, walkM, route };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sx = Number(searchParams.get("sx"));
  const sy = Number(searchParams.get("sy"));
  const ex = Number(searchParams.get("ex"));
  const ey = Number(searchParams.get("ey"));
  const buildingId = searchParams.get("building_id");
  const gateId = searchParams.get("gate_id");

  if ([sx, sy, ex, ey].some((v) => Number.isNaN(v))) {
    return NextResponse.json({ ok: false, reason: "missing params" }, { status: 400 });
  }
  if (!TMAP_KEY) {
    return NextResponse.json({ ok: false, reason: "no_tmap_key" });
  }

  const result = await calcWalkRoute(sy, sx, ey, ex);
  if (!result) {
    return NextResponse.json({ ok: false, reason: "no_route" });
  }

  // building_gate_routes 캐시 (다음 조회부터는 DB에서 바로 사용)
  if (buildingId && gateId && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const db = getSupabaseAdmin();
      await db.from("building_gate_routes").upsert(
        {
          building_id: buildingId,
          gate_id: gateId,
          walk_time_min: result.walkMin,
          walk_distance_m: result.walkM,
          walk_route: result.route,
        },
        { onConflict: "building_id,gate_id" },
      );
    } catch {
      // 캐시 실패는 무시 (경로는 그대로 반환)
    }
  }

  return NextResponse.json({ ok: true, ...result });
}
