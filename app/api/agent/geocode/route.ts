import { NextResponse } from "next/server";

const KAKAO_REST_KEY = process.env.KAKAO_REST_API_KEY ?? "";

export async function POST(request: Request) {
  if (!KAKAO_REST_KEY) {
    return NextResponse.json({ error: "KAKAO_REST_API_KEY not configured" }, { status: 500 });
  }

  const { address } = (await request.json()) as { address?: string };
  if (!address?.trim()) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  const url = new URL("https://dapi.kakao.com/v2/local/search/address.json");
  url.searchParams.set("query", address.trim());
  url.searchParams.set("size", "1");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` },
  });

  if (!res.ok) {
    return NextResponse.json({ error: `Kakao API ${res.status}` }, { status: 502 });
  }

  const data = (await res.json()) as {
    documents: Array<{ address: { x: string; y: string } | null; road_address: { x: string; y: string } | null }>;
  };

  const doc = data.documents?.[0];
  if (!doc) {
    return NextResponse.json({ error: "주소를 찾을 수 없습니다" }, { status: 404 });
  }

  const coords = doc.road_address ?? doc.address;
  if (!coords) {
    return NextResponse.json({ error: "좌표 변환 실패" }, { status: 404 });
  }

  return NextResponse.json({
    lat: parseFloat(coords.y),
    lng: parseFloat(coords.x),
  });
}
