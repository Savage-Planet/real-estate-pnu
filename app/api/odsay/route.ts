import { NextResponse } from "next/server";
import { fetchOdsayTransitBackfill } from "@/lib/odsay";

/**
 * 로컬 백필 스크립트가 ODsay를 호출할 때 사용하는 프록시.
 * Next 서버에서 `NEXT_PUBLIC_ODSAY_KEY`로 호출하므로 브라우저와 동일한 키 경로를 탄다.
 *
 * POST JSON: { "sx": number, "sy": number, "ex": number, "ey": number }
 * 선택 헤더: X-Backfill-Secret (BACKFILL_SECRET 설정 시 필수)
 */
export async function POST(request: Request) {
  const expected = process.env.BACKFILL_SECRET;
  if (expected) {
    const fromHeader =
      request.headers.get("x-backfill-secret") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      "";
    if (fromHeader !== expected) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let body: { sx?: number; sy?: number; ex?: number; ey?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { sx, sy, ex, ey } = body;
  if (
    typeof sx !== "number" ||
    typeof sy !== "number" ||
    typeof ex !== "number" ||
    typeof ey !== "number"
  ) {
    return NextResponse.json(
      { error: "sx, sy, ex, ey (numbers) required" },
      { status: 400 },
    );
  }

  const r = await fetchOdsayTransitBackfill(sx, sy, ex, ey);
  if (!r.ok) {
    return NextResponse.json({ ok: false, reason: r.reason });
  }
  return NextResponse.json({ ok: true, data: r.data });
}
