import { NextResponse } from "next/server";

/**
 * Open Elevation API 프록시 (CORS 우회용)
 * POST body: { locations: Array<{lat: number, lng: number}> }
 * 응답: { elevations: number[] }   — 입력 순서와 동일
 *
 * Open Elevation (https://api.open-elevation.com) 은 SRTM 기반 무료 API.
 * 부산 지역 90m 격자 해상도로 도보 경로 경사도 시각화에 충분.
 */
export async function POST(request: Request) {
  try {
    const { locations } = (await request.json()) as {
      locations: Array<{ lat: number; lng: number }>;
    };

    if (!Array.isArray(locations) || locations.length === 0) {
      return NextResponse.json({ error: "locations required" }, { status: 400 });
    }

    // Open Elevation API 형식
    const body = {
      locations: locations.map(({ lat, lng }) => ({ latitude: lat, longitude: lng })),
    };

    const res = await fetch("https://api.open-elevation.com/api/v1/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
    }

    const data = (await res.json()) as {
      results: Array<{ latitude: number; longitude: number; elevation: number }>;
    };

    const elevations = data.results.map((r) => r.elevation);
    return NextResponse.json({ elevations });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
