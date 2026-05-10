import { NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-1.5-flash"] as const;
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

interface WeightChange {
  name: string;
  initial: number;
  final: number;
  delta: number;
}

interface ExplainRequest {
  buildingName: string;
  topProperties: PropertySummary[];
  weightChanges: WeightChange[];
  totalComparisons: number;
}

interface GeminiCallResult {
  res: Response | null;
  errText: string;
}

async function callGeminiWithRetry(
  model: string,
  promptText: string,
): Promise<GeminiCallResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  let res: Response | null = null;
  let errText = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
        },
      }),
    });

    if (res.ok) break;

    errText = await res.text();
    // 429/503 are usually temporary pressure; retry same model first.
    if ((res.status !== 429 && res.status !== 503) || attempt >= MAX_RETRIES) break;
    const retryAfter = Number(res.headers.get("retry-after") ?? 0);
    const delayMs = retryAfter > 0 ? retryAfter * 1000 : 1200 * (attempt + 1);
    await sleep(delayMs);
  }

  return { res, errText };
}

const SYSTEM_PROMPT = `당신은 부산대 학생을 위한 부동산 추천 AI 분석가입니다.

역할:
- 비교 선택 과정에서 학습된 선호도 가중치(final 값)를 분석해 이 사용자가 어떤 성향의 사람인지 구체적으로 설명합니다.
- 상위 매물 데이터를 근거로, 왜 1위 매물이 선택되었는지 설명합니다.
- 반드시 제공된 숫자 데이터만 근거로 사용하세요. 추측하지 마세요.
- 한국어로, 친근하고 구체적인 문장으로 작성하세요.

가중치 해석 기준:
- final 값이 양수(+)이고 클수록 → 해당 항목을 '선호'
- final 값이 음수(-)이거나 작을수록 → 해당 항목을 '기피'
- |delta|가 클수록 → 초기 생각과 달리 실제 선택에서 드러난 숨겨진 선호
- 가중치 이름 예시: 월세, 보증금, 관리비, 도보시간, 방 개수, 년식, 남향, 경비원, 소음, 경사도 등

출력 형식 (반드시 이 JSON 형태로만 응답):
{
  "summary": "이 사용자를 한 문장으로 표현 (예: '가격보다 안전을 중시하는 야행성 학생') — 30자 이내",
  "personalityProfile": [
    "가중치 기반 성향 설명 1 (예: '월세 부담을 가장 중요하게 여기며, 월 30만원 이하 매물을 강하게 선호합니다')",
    "가중치 기반 성향 설명 2 (예: '경비원·CCTV 등 보안 시설에 높은 가중치를 부여했습니다')",
    "가중치 기반 성향 설명 3 (예: '통학 도보 시간보다 가격을 우선시하는 경향이 있습니다')"
  ],
  "hiddenPreference": "초기 설정과 달리 실제 선택에서 드러난 숨겨진 선호 1~2문장 (delta가 큰 항목 기반, 없으면 null)",
  "whyTop1": ["1위 선택 이유 1", "1위 선택 이유 2"],
  "top1VsTop2": ["1위 vs 2위 핵심 차이 1", "1위 vs 2위 핵심 차이 2"],
  "caveat": "주의사항 한 문장 (데이터 한계 등, 없으면 null)"
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
    const promptText = `${SYSTEM_PROMPT}\n\n데이터:\n${userContent}`;
    let res: Response | null = null;
    let lastErrText = "";
    let lastStatus = 502;

    for (const model of GEMINI_MODELS) {
      const result = await callGeminiWithRetry(model, promptText);
      res = result.res;
      lastErrText = result.errText;
      lastStatus = res?.status ?? 502;
      if (res?.ok) break;

      // If model is unavailable/not found, continue to fallback model.
      if (lastStatus === 404) {
        continue;
      }
      // Other failures are likely project/quotas issues and won't improve with fallback.
      break;
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
      if (res.status === 503) {
        return NextResponse.json(
          { error: "Gemini API 503: 현재 모델 요청이 많습니다. 잠시 후 다시 시도해 주세요." },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { error: `Gemini API ${res.status}` },
        { status: 502 },
      );
    }

    const geminiRes = await res.json();
    let textContent =
      geminiRes?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // 코드 펜스 및 앞뒤 공백 제거
    textContent = textContent
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/,  "")
      .trim();

    // JSON 파싱 시도 (3단계)
    let parsed: Record<string, unknown> | null = null;

    // 1) 전체 텍스트 파싱
    try { parsed = JSON.parse(textContent); } catch { /* ignore */ }

    // 2) 첫 번째 {...} 블록 추출 후 파싱
    if (!parsed) {
      const m = textContent.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { /* ignore */ } }
    }

    // 3) 키별 정규식 추출 (최후 수단)
    if (!parsed) {
      const extract = (key: string): string | undefined => {
        const r = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "s");
        return textContent.match(r)?.[1];
      };
      const extractArr = (key: string): string[] => {
        const r = new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]+)\\]`, "s");
        const inner = textContent.match(r)?.[1] ?? "";
        return inner.match(/"([^"]*)"/g)?.map((s: string) => s.replace(/"/g, "")) ?? [];
      };
      parsed = {
        summary:            extract("summary"),
        personalityProfile: extractArr("personalityProfile"),
        hiddenPreference:   extract("hiddenPreference"),
        whyTop1:            extractArr("whyTop1"),
        top1VsTop2:         extractArr("top1VsTop2"),
        caveat:             extract("caveat"),
      };
    }

    // summary가 JSON 텍스트처럼 보이면 비워서 오염 방지
    if (typeof parsed.summary === "string" && parsed.summary.trimStart().startsWith("{")) {
      parsed.summary = undefined;
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
