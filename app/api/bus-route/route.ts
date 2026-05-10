import { NextResponse } from "next/server";

/**
 * ODsay 버스 경로 서버 프록시
 * 브라우저에서 ODsay를 직접 호출하면 Vercel 프로덕션 환경의 CORS 제한으로 실패할 수 있음.
 * 이 라우트를 통해 서버에서 호출하여 경로 데이터를 반환한다.
 *
 * GET /api/bus-route?sx=lng&sy=lat&ex=lng&ey=lat
 * 응답: { ok: true, busMin, totalMin, path: [{lat,lng}...] }
 *       | { ok: false, reason }
 */
export async function GET(request: Request) {
  // ODsay에 등록된 URI로 Referer를 고정한다.
  // 사용자가 어떤 도메인(real-estate-pnu.vercel.app 등)에서 접속해도
  // ODsay 인증은 등록된 도메인(real-estate-pnu-ngyh.vercel.app)으로 통과한다.
  const ODSAY_REGISTERED_REFERER = "https://real-estate-pnu-ngyh.vercel.app/compare";
  const ODSAY_REGISTERED_ORIGIN  = "https://real-estate-pnu-ngyh.vercel.app";

  const { searchParams } = new URL(request.url);
  const sx = searchParams.get("sx");
  const sy = searchParams.get("sy");
  const ex = searchParams.get("ex");
  const ey = searchParams.get("ey");

  if (!sx || !sy || !ex || !ey) {
    return NextResponse.json({ ok: false, reason: "missing params" }, { status: 400 });
  }

  const key = process.env.NEXT_PUBLIC_ODSAY_KEY ?? "";
  if (!key) {
    return NextResponse.json({ ok: false, reason: "no_odsay_key" });
  }

  const url = new URL("https://api.odsay.com/v1/api/searchPubTransPathT");
  url.searchParams.set("SX", sx);
  url.searchParams.set("SY", sy);
  url.searchParams.set("EX", ex);
  url.searchParams.set("EY", ey);
  url.searchParams.set("apiKey", key);

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(12_000),
      headers: {
        "Referer": ODSAY_REGISTERED_REFERER,
        "Origin":  ODSAY_REGISTERED_ORIGIN,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[bus-route proxy] ODsay HTTP error", res.status, body.slice(0, 200));
      return NextResponse.json({ ok: false, reason: `odsay_http_${res.status}` });
    }

    const json = await res.json() as Record<string, unknown>;

    if (json.error) {
      const errMsg = `odsay_error:${JSON.stringify(json.error)}`;
      console.error("[bus-route proxy]", errMsg, "referer_used:", ODSAY_REGISTERED_REFERER);
      return NextResponse.json({ ok: false, reason: errMsg, referer_used: ODSAY_REGISTERED_REFERER, v: 4 });
    }

    const paths = (json as any)?.result?.path;
    if (!Array.isArray(paths) || paths.length === 0) {
      return NextResponse.json({ ok: false, reason: "no_path" });
    }

    const best = paths[0];
    const info = best.info ?? {};
    const subPaths: Array<Record<string, unknown>> = best.subPath ?? [];

    const totalMin: number = Number(info.totalTime ?? 0);
    const busMin: number =
      typeof info.busTransitTime === "number"
        ? info.busTransitTime
        : Math.max(0, totalMin - Math.round((Number(info.totalWalk ?? 0)) / 60));

    // 경로 포인트: 정류장 lat/lng 순서대로
    const startLat = Number(sy);
    const startLng = Number(sx);
    const endLat = Number(ey);
    const endLng = Number(ex);

    const pathPoints: Array<{ lat: number; lng: number }> = [{ lat: startLat, lng: startLng }];
    for (const sub of subPaths) {
      const trafficType = Number(sub.trafficType ?? 0);
      if (trafficType === 1 || trafficType === 2) {
        const stations = (sub as any).passStopList?.stations as Array<Record<string, unknown>> | undefined;
        if (stations) {
          for (const st of stations) {
            const lat = Number(st.y);
            const lng = Number(st.x);
            if (!isNaN(lat) && !isNaN(lng)) {
              pathPoints.push({ lat, lng });
            }
          }
        }
      }
    }
    pathPoints.push({ lat: endLat, lng: endLng });

    return NextResponse.json({ ok: true, busMin, totalMin, path: pathPoints });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: String(e) });
  }
}
