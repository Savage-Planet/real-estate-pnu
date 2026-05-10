import { NextResponse } from "next/server";
import https from "https";

/**
 * ODsay 버스 경로 서버 프록시
 * fetch() 는 Node.js 보안 정책상 Referer/Origin 헤더를 무시할 수 있으므로
 * Node.js 내장 https.request 를 사용해 헤더를 확실히 전달한다.
 *
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

  // ODsay에 등록된 URI로 Referer 고정.
  // 등록된 슬롯: real-estate-pnu-ngyh.vercel.app
  const ODSAY_REFERER = "https://real-estate-pnu-ngyh.vercel.app/compare";
  const ODSAY_ORIGIN  = "https://real-estate-pnu-ngyh.vercel.app";

  const odsayPath =
    `/v1/api/searchPubTransPathT?SX=${sx}&SY=${sy}&EX=${ex}&EY=${ey}&apiKey=${encodeURIComponent(key)}`;

  try {
    const json = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.odsay.com",
          path: odsayPath,
          method: "GET",
          headers: {
            "Referer": ODSAY_REFERER,
            "Origin":  ODSAY_ORIGIN,
            "User-Agent": "Mozilla/5.0 (compatible; real-estate-pnu/1.0)",
          },
          timeout: 12_000,
        },
        (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          res.on("end", () => {
            try { resolve(JSON.parse(body)); }
            catch { reject(new Error(`JSON parse error: ${body.slice(0, 100)}`)); }
          });
        },
      );
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      req.on("error", reject);
      req.end();
    });

    if (json.error) {
      const errMsg = `odsay_error:${JSON.stringify(json.error)}`;
      console.error("[bus-route proxy]", errMsg, "ref:", ODSAY_REFERER);
      return NextResponse.json({ ok: false, reason: errMsg, ref: ODSAY_REFERER, v: 6 });
    }

    const paths = (json as any)?.result?.path;
    if (!Array.isArray(paths) || paths.length === 0) {
      return NextResponse.json({ ok: false, reason: "no_path", v: 5 });
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
    const endLat   = Number(ey);
    const endLng   = Number(ex);

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

    return NextResponse.json({ ok: true, busMin, totalMin, path: pathPoints, v: 5 });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: String(e), v: 5 });
  }
}
