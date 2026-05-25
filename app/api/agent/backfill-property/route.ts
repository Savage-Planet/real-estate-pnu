/**
 * POST /api/agent/backfill-property
 * 매물 등록 후 자동 호출: 도보시간, 버스시간, 소음지수를 계산하여 agent_properties 업데이트.
 *
 * Body: { propertyId: string }
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchOdsayTransitBackfill } from "@/lib/odsay";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const TMAP_KEY = process.env.NEXT_PUBLIC_TMAP_KEY ?? "";
const ODSAY_PROXY_SECRET = process.env.ODSAY_PROXY_SECRET ?? "";

// 부산대 정문 좌표
const PNU_GATE = { lat: 35.2316, lng: 129.0840 };

// 캠퍼스 내 gate 좌표 목록 (gates 테이블에서 동적으로 로드)
interface Gate { id: string; name: string; lat: number; lng: number }

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function fetchGates(): Promise<Gate[]> {
  const { data } = await supabaseAdmin.from("gates").select("id,name,lat,lng");
  return (data ?? []) as Gate[];
}

function findNearestGate(lat: number, lng: number, gates: Gate[]): Gate | null {
  if (!gates.length) return null;
  return gates.reduce((best, g) => {
    const d = haversineM(lat, lng, g.lat, g.lng);
    const bd = haversineM(lat, lng, best.lat, best.lng);
    return d < bd ? g : best;
  });
}

/** Tmap 도보 경로 API */
async function calcWalkRoute(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
): Promise<{ totalMinutes: number; totalMeters: number; route: [number, number][] } | null> {
  if (!TMAP_KEY) return null;
  try {
    const res = await fetch("https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1&format=json", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        appKey: TMAP_KEY,
      },
      body: JSON.stringify({
        startX: String(startLng),
        startY: String(startLat),
        endX: String(endLng),
        endY: String(endLat),
        reqCoordType: "WGS84GEO",
        resCoordType: "WGS84GEO",
        startName: "출발지",
        endName: "도착지",
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      features: Array<{
        geometry: { type: string; coordinates: number[] | number[][] };
        properties: { totalDistance?: number; totalTime?: number };
      }>;
    };

    const summary = data.features?.[0]?.properties;
    const totalMeters = summary?.totalDistance ?? 0;
    const totalSeconds = summary?.totalTime ?? 0;
    const totalMinutes = Math.round((totalSeconds / 60) * 10) / 10;

    // 경로 좌표 추출
    const route: [number, number][] = [];
    for (const f of data.features ?? []) {
      if (f.geometry.type === "LineString") {
        const coords = f.geometry.coordinates as number[][];
        for (const c of coords) {
          if (Array.isArray(c) && c.length >= 2) {
            route.push([c[1], c[0]]); // [lat, lng]
          }
        }
      } else if (f.geometry.type === "Point") {
        const c = f.geometry.coordinates as number[];
        if (c.length >= 2) route.push([c[1], c[0]]);
      }
    }

    return { totalMinutes, totalMeters, route };
  } catch {
    return null;
  }
}

/** Overpass API로 반경 내 도로 밀도 기반 소음 지수 추정 (0~100) */
async function estimateNoise(lat: number, lng: number): Promise<number> {
  const radius = 100;
  const query = `
    [out:json][timeout:10];
    (
      way(around:${radius},${lat},${lng})[highway~"^(motorway|trunk|primary|secondary|tertiary|residential)$"];
    );
    out count;
  `;
  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return 50;
    const data = await res.json() as { elements: Array<{ tags?: { highway?: string } }> };

    const roadWeights: Record<string, number> = {
      motorway: 25, trunk: 20, primary: 15, secondary: 12,
      tertiary: 8, residential: 4,
    };

    let weightedSum = 0;
    for (const el of data.elements ?? []) {
      const hw = el.tags?.highway ?? "";
      weightedSum += roadWeights[hw] ?? 2;
    }

    // 0~100 정규화 (100점 = 매우 시끄러움)
    return Math.min(100, Math.round(weightedSum));
  } catch {
    return 50; // 기본값
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const { propertyId } = (await request.json()) as { propertyId?: string };
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }

  // 매물 조회
  const { data: prop, error: propErr } = await supabaseAdmin
    .from("agent_properties")
    .select("id, lat, lng")
    .eq("id", propertyId)
    .single();

  if (propErr || !prop) {
    return NextResponse.json({ error: "property not found" }, { status: 404 });
  }

  const { lat, lng } = prop as { id: string; lat: number; lng: number };

  // 병렬 계산
  const gates = await fetchGates();
  const nearestGate = findNearestGate(lat, lng, gates);
  const gateLat = nearestGate?.lat ?? PNU_GATE.lat;
  const gateLng = nearestGate?.lng ?? PNU_GATE.lng;

  const [walkResult, busResult, noiseLevel] = await Promise.all([
    calcWalkRoute(lat, lng, gateLat, gateLng),
    fetchOdsayTransitBackfill(lng, lat, gateLng, gateLat),
    estimateNoise(lat, lng),
  ]);

  // 업데이트 payload
  const update: Record<string, unknown> = {
    nearest_gate: nearestGate?.id ?? null,
    noise_level: noiseLevel,
  };

  if (walkResult) {
    update.walk_to_gate_min = walkResult.totalMinutes;
    update.walk_to_gate_m = walkResult.totalMeters;
    update.walk_to_gate_route = walkResult.route;
  }

  if (busResult.ok) {
    update.bus_to_gate_min = busResult.data.total_time_min;
    update.bus_to_gate_transfers = busResult.data.transit_count;
  }

  const { error: updateErr } = await supabaseAdmin
    .from("agent_properties")
    .update(update)
    .eq("id", propertyId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, update });
}
