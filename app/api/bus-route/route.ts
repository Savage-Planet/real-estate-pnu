import { NextResponse } from "next/server";

/**
 * ODsay 버스 경로 서버 프록시
 * GET /api/bus-route?sx=lng&sy=lat&ex=lng&ey=lat
 */
export async function GET(request: Request) {
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

  // ODsay에 등록된 도메인으로 Referer 고정 (이전 odsay-test에서 검증됨)
  const ODSAY_REFERER = "https://real-estate-pnu-ngyh.vercel.app/compare";
  const ODSAY_ORIGIN  = "https://real-estate-pnu-ngyh.vercel.app";

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
        "Referer": ODSAY_REFERER,
        "Origin": ODSAY_ORIGIN,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[bus-route proxy] ODsay HTTP error", res.status, body.slice(0, 200));
      return NextResponse.json({ ok: false, reason: `odsay_http_${res.status}`, v: 7 });
    }

    const json = await res.json() as Record<string, unknown>;

    if (json.error) {
      const errMsg = `odsay_error:${JSON.stringify(json.error)}`;
      console.error("[bus-route proxy]", errMsg);
      return NextResponse.json({ ok: false, reason: errMsg, ref: ODSAY_REFERER, v: 7 });
    }

    const paths = (json as any)?.result?.path;
    if (!Array.isArray(paths) || paths.length === 0) {
      return NextResponse.json({ ok: false, reason: "no_path", v: 7 });
    }

    const best = paths[0];
    const info = best.info ?? {};
    const subPaths: Array<Record<string, unknown>> = best.subPath ?? [];

    const totalMin: number = Number(info.totalTime ?? 0);
    const busMin: number =
      typeof info.busTransitTime === "number"
        ? info.busTransitTime
        : Math.max(0, totalMin - Math.round((Number(info.totalWalk ?? 0)) / 60));

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
            if (!isNaN(lat) && !isNaN(lng)) pathPoints.push({ lat, lng });
          }
        }
      }
    }
    pathPoints.push({ lat: endLat, lng: endLng });

    return NextResponse.json({ ok: true, busMin, totalMin, path: pathPoints, v: 7 });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: String(e), v: 7 });
  }
}
