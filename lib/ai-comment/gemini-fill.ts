/**
 * Calls the Gemini API to fill pamphlet text slots.
 * Only interpretive text is requested — numbers come from analyzeWeights().
 */

import type { WeightAnalytics } from "./analyze-weights";
import { buildFillPrompt } from "./pamphlet-slots";
import type { PamphletSlots } from "./pamphlet-slots";

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"] as const;
const MAX_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callWithRetry(
  model: string,
  prompt: string,
  apiKey: string,
): Promise<{ ok: boolean; text: string; status: number }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let status = 502;
  let text = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2048,
          },
        }),
      });
    } catch (e) {
      text = String(e);
      continue;
    }

    status = res.status;

    if (res.ok) {
      const data = await res.json();
      text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      return { ok: true, text, status };
    }

    text = await res.text();

    if (status === 404) break;
    if ((status === 429 || status === 503) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after") ?? 0);
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 1200 * (attempt + 1));
    } else {
      break;
    }
  }

  return { ok: false, text, status };
}

/** Replace literal (unescaped) newlines inside JSON string values with \n */
function sanitizeJsonLiteralNewlines(s: string): string {
  // Replace literal newlines that appear inside a JSON string (between " ... ")
  // with the escaped form \n. Uses a state machine approach.
  let result = "";
  let inString = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && inString) {
      result += ch + (s[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
    } else if (inString && (ch === "\n" || ch === "\r")) {
      result += "\\n";
    } else {
      result += ch;
    }
    i++;
  }
  return result;
}

function parseSlots(raw: string): PamphletSlots | null {
  // Strip markdown code fences (anywhere in the string, not just start)
  let text = raw
    .replace(/^[\s\S]*?```(?:json)?\s*/i, "")
    .replace(/\s*```[\s\S]*$/, "")
    .trim();

  // If no fences were stripped, use the original text
  if (!text) text = raw.trim();

  // Try full parse first
  try {
    return JSON.parse(text) as PamphletSlots;
  } catch { /* fall through */ }

  // Sanitize literal newlines inside JSON strings and retry
  try {
    return JSON.parse(sanitizeJsonLiteralNewlines(text)) as PamphletSlots;
  } catch { /* fall through */ }

  // Extract first {...} block
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]) as PamphletSlots;
    } catch { /* fall through */ }
    try {
      return JSON.parse(sanitizeJsonLiteralNewlines(m[0])) as PamphletSlots;
    } catch { /* fall through */ }
  }

  return null;
}

function fallbackSlots(analytics: WeightAnalytics): PamphletSlots {
  const topName = analytics.topFeatures[0]?.name ?? "알 수 없음";
  const bottomName = analytics.bottomFeatures[0]?.name ?? "알 수 없음";
  return {
    personaLabel: `${analytics.dominantBias} 유형`,
    biasExplanation: `이 사용자는 ${analytics.dominantBias} 성향을 보입니다. ${analytics.biasEvidence}`,
    hiddenPrefText:
      analytics.bigDeltas.length > 0
        ? `${analytics.bigDeltas[0].name}에 대한 선호가 처음 예상보다 ${analytics.bigDeltas[0].delta > 0 ? "높게" : "낮게"} 나타났습니다.`
        : null,
    missedAspectText: `${bottomName}은(는) 장기 거주 시 중요한 요소가 될 수 있습니다.`,
    top1Reason: analytics.topProperty
      ? `가중치가 높은 ${topName} 측면에서 우수한 매물이 1위를 차지했습니다.`
      : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export interface FillResult {
  slots: PamphletSlots;
  /** true if Gemini responded successfully, false if fallback was used */
  fromGemini: boolean;
  error?: string;
}

/**
 * Fills pamphlet text slots using Gemini.
 *
 * @param analytics  Output of analyzeWeights()
 * @param apiKey     GEMINI_API_KEY. Reads process.env.GEMINI_API_KEY if omitted.
 */
export async function fillPamphletSlots(
  analytics: WeightAnalytics,
  apiKey?: string,
): Promise<FillResult> {
  const key = apiKey ?? process.env.GEMINI_API_KEY ?? "";
  if (!key) {
    return {
      slots: fallbackSlots(analytics),
      fromGemini: false,
      error: "GEMINI_API_KEY not set — using fallback text",
    };
  }

  const prompt = buildFillPrompt(analytics);

  const errors: string[] = [];

  for (const model of GEMINI_MODELS) {
    const result = await callWithRetry(model, prompt, key);

    if (result.ok) {
      const parsed = parseSlots(result.text);
      if (parsed) {
        return { slots: parsed, fromGemini: true };
      }
      errors.push(`JSON parse failed (model: ${model}). raw: ${result.text.slice(0, 120)}`);
      continue;
    }

    errors.push(`HTTP ${result.status} (model: ${model}): ${result.text.slice(0, 300)}`);
    if (result.status === 404) continue;
    break;
  }

  const lastError = errors.join(" | ");

  return {
    slots: fallbackSlots(analytics),
    fromGemini: false,
    error: `Gemini call failed — ${lastError}`,
  };
}
