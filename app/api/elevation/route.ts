import { NextResponse } from "next/server";

/**
 * 고도 API 프록시 (CORS 우회용)
 * POST body: { locations: Array<{lat: number, lng: number}> }
 * 응답: { elevations: number[] }   — 입력 순서와 동일
 *
 * opentopodata.org (SRTM 90m) 를 1차로 사용.
 * open-elevation.com 은 불안정하여 제거.
 * Rate limit: 1 req/s, 최대 100 포인트/요청
 */
export async function POST(request: Request) {
  try {
    const { locations } = (await request.json()) as {
      locations: Array<{ lat: number; lng: number }>;
    };

    if (!Array.isArray(locations) || locations.length === 0) {
      return NextResponse.json({ error: "locations required" }, { status: 400 });
    }

    // opentopodata.org: GET 요청, 좌표를 "|" 로 구분
    const locStr = locations.map(({ lat, lng }) => `${lat},${lng}`).join("|");
    const url = `https://api.opentopodata.org/v1/srtm90m?locations=${locStr}`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
    }

    const data = (await res.json()) as {
      status: string;
      results: Array<{ elevation: number | null }>;
    };

    if (data.status !== "OK" || !Array.isArray(data.results)) {
      return NextResponse.json({ error: "opentopodata error" }, { status: 502 });
    }

    const elevations = data.results.map((r) => r.elevation ?? 0);
    return NextResponse.json({ elevations });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
