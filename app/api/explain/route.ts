import { NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=`;
const MAX_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PropertySummary {
  rank: number;
  price: string;
  deposit: string;
  area: string;
  rooms: number;
  direction: string;
  year: string;
  walkMin: number | null;
  busMin: number | null;
  options: string[];
  address: string;
  score: number;
}

interface ExplainRequest {
  buildingName: string;
  topProperties: PropertySummary[];
  weightChanges: Array<{ name: string; initial: number; final: number; delta: number }>;
  totalComparisons: number;
}

const SYSTEM_PROMPT = `당신은 부산대 학생을 위한 부동산 추천 분석가입니다.

역할:
- 학습된 선호도 가중치와 상위 매물 데이터를 기반으로, 왜 이 매물이 높은 순위인지 설명합니다.
- 반드시 제공된 숫자 데이터만 근거로 사용하세요. 추측하지 마세요.
- 한국어로 답변하세요.

출력 형식 (반드시 이 JSON 형태로만 응답):
{
  "summary": "전체 추천 결과 한줄 요약 (30자 이내)",
  "whyTop1": ["1위 선택 이유 1", "1위 선택 이유 2", "1위 선택 이유 3"],
  "weightShift": ["가중치 변화 해석 1", "가중치 변화 해석 2"],
  "top1VsTop2": ["1위 vs 2위 핵심 차이 1", "1위 vs 2위 핵심 차이 2"],
  "caveat": "주의사항 한 문장"
}`;

export async function POST(request: Request) {
  if (!GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured" },
      { status: 500 },
    );
  }

  let body: ExplainRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { buildingName, topProperties, weightChanges, totalComparisons } = body;
  if (!topProperties || topProperties.length === 0) {
    return NextResponse.json({ error: "topProperties required" }, { status: 400 });
  }

  const userContent = JSON.stringify(
    {
      건물: buildingName,
      비교횟수: totalComparisons,
      상위매물: topProperties,
      가중치변화: weightChanges.slice(0, 8),
    },
    null,
    2,
  );

  try {
    let res: Response | null = null;
    let lastErrText = "";
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      res = await fetch(`${GEMINI_URL}${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: `${SYSTEM_PROMPT}\n\n데이터:\n${userContent}` }] },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1024,
            responseMimeType: "application/json",
          },
        }),
      });

      if (res.ok) break;

      lastErrText = await res.text();
      if (res.status !== 429 || attempt >= MAX_RETRIES) break;
      const retryAfter = Number(res.headers.get("retry-after") ?? 0);
      const delayMs = retryAfter > 0 ? retryAfter * 1000 : 1200 * (attempt + 1);
      await sleep(delayMs);
    }

    if (!res) {
      return NextResponse.json({ error: "Gemini request not sent" }, { status: 502 });
    }

    if (!res.ok) {
      console.error("Gemini API error:", res.status, lastErrText);
      if (res.status === 429) {
        return NextResponse.json(
          { error: "Gemini API 429: 잠시 후 다시 시도해 주세요." },
          { status: 429 },
        );
      }
      return NextResponse.json(
        { error: `Gemini API ${res.status}` },
        { status: 502 },
      );
    }

    const geminiRes = await res.json();
    const textContent =
      geminiRes?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(textContent);
    } catch {
      parsed = { summary: textContent.slice(0, 200), raw: true };
    }

    return NextResponse.json({ ok: true, explanation: parsed });
  } catch (e) {
    console.error("Gemini fetch error:", e);
    return NextResponse.json(
      { error: `request failed: ${String(e)}` },
      { status: 502 },
    );
  }
}
