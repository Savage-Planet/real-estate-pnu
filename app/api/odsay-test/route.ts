import { NextResponse } from "next/server";

/**
 * ODsay API 키 및 도메인 인증 진단용 엔드포인트
 * GET /api/odsay-test
 * - referer 파라미터 없이 호출 (키 자체 유효성)
 * - referer 파라미터 있으면 해당 Referer 헤더 포함 호출
 */
export async function GET(request: Request) {
  const key = process.env.NEXT_PUBLIC_ODSAY_KEY ?? "";
  const { searchParams } = new URL(request.url);
  const customReferer = searchParams.get("referer");

  // 부산대학교(PNU) → 부산역 좌표 (고정 테스트)
  const testUrl = new URL("https://api.odsay.com/v1/api/searchPubTransPathT");
  testUrl.searchParams.set("SX", "129.0832");
  testUrl.searchParams.set("SY", "35.2324");
  testUrl.searchParams.set("EX", "129.0403");
  testUrl.searchParams.set("EY", "35.1145");
  testUrl.searchParams.set("apiKey", key);

  const results: Record<string, unknown> = {
    key_exists: !!key,
    key_prefix: key ? key.slice(0, 6) + "***" : "(empty)",
    incoming_referer_header: request.headers.get("referer"),
    incoming_origin_header: request.headers.get("origin"),
  };

  // 시도 1: Referer 헤더 없이 (서버에서 순수 호출)
  try {
    const r1 = await fetch(testUrl.toString(), { signal: AbortSignal.timeout(8000) });
    const j1 = await r1.json();
    results["no_referer"] = { status: r1.status, body: j1 };
  } catch (e) {
    results["no_referer"] = { error: String(e) };
  }

  // 시도 2: 등록된 도메인으로 Referer 설정
  const refererToTest = customReferer ?? "https://real-estate-pnu-ngyh.vercel.app/compare";
  try {
    const r2 = await fetch(testUrl.toString(), {
      signal: AbortSignal.timeout(8000),
      headers: {
        "Referer": refererToTest,
        "Origin": "https://real-estate-pnu-ngyh.vercel.app",
      },
    });
    const j2 = await r2.json();
    results["with_referer"] = { referer_sent: refererToTest, status: r2.status, body: j2 };
  } catch (e) {
    results["with_referer"] = { error: String(e) };
  }

  // 시도 3: 브라우저가 보낸 Referer 그대로
  const browserReferer = request.headers.get("referer");
  if (browserReferer && browserReferer !== refererToTest) {
    try {
      const r3 = await fetch(testUrl.toString(), {
        signal: AbortSignal.timeout(8000),
        headers: { "Referer": browserReferer },
      });
      const j3 = await r3.json();
      results["browser_referer"] = { referer_sent: browserReferer, status: r3.status, body: j3 };
    } catch (e) {
      results["browser_referer"] = { error: String(e) };
    }
  }

  return NextResponse.json(results, {
    headers: { "Cache-Control": "no-store" },
  });
}
