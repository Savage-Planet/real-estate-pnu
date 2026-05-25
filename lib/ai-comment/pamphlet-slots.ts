/**
 * Pamphlet slot types and the Gemini prompt builder.
 *
 * Gemini's ONLY job is to write short, human-friendly interpretive text
 * for each slot. All numbers are pre-computed by analyzeWeights() and
 * passed to Gemini as context — Gemini must NOT invent numbers.
 */

import type { WeightAnalytics } from "./analyze-weights";

// ─── Output shape ────────────────────────────────────────────────────────────

export interface PamphletSlots {
  /** 8자 이내 한 단어 페르소나 레이블. 예: "실속형 탐색가" */
  personaLabel: string;
  /** 편향 유형 이름 + 2문장 설명 */
  biasExplanation: string;
  /**
   * 초기 선호 vs 실제 선택 변화 1문장.
   * bigDeltas 데이터 없으면 null 반환 가능.
   */
  hiddenPrefText: string | null;
  /** 낮게 평가한 속성 중 놓쳤을 수 있는 관점 1문장 */
  missedAspectText: string;
  /**
   * 1위 매물이 선택된 이유 1~2문장.
   * topProperty 없으면 null 반환 가능.
   */
  top1Reason: string | null;
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

/**
 * Builds the structured prompt sent to Gemini.
 * Numbers are embedded inline — Gemini must reference them, not invent new ones.
 */
export function buildFillPrompt(analytics: WeightAnalytics): string {
  const {
    topFeatures,
    bottomFeatures,
    bigDeltas,
    dominantBias,
    biasEvidence,
    topProperty,
    groupShares,
  } = analytics;

  const topList = topFeatures
    .map((f) => `  ${f.rank}. ${f.name}: ${f.weight.toFixed(3)}`)
    .join("\n");

  const bottomList = bottomFeatures
    .map((f) => `  - ${f.name}: ${f.weight.toFixed(3)}`)
    .join("\n");

  const deltaSection =
    bigDeltas.length > 0
      ? bigDeltas
          .map(
            (d) =>
              `  - ${d.name}: 초기 ${d.initial.toFixed(3)} → 최종 ${d.final.toFixed(3)} (변화량: ${d.delta > 0 ? "+" : ""}${d.delta.toFixed(3)})`,
          )
          .join("\n")
      : "  (초기 가중치 정보 없음)";

  const groupPct = (g: keyof typeof groupShares) =>
    `${Math.round(groupShares[g] * 100)}%`;

  const propSection = topProperty
    ? `1위 매물: ${topProperty.rank1Summary} (점수: ${topProperty.rank1Score}점)` +
      (topProperty.rank2Summary
        ? `\n2위 매물: ${topProperty.rank2Summary} (점수: ${topProperty.rank2Score}점)`
        : "")
    : "(매물 정보 없음)";

  return `당신은 부산대 학생 주거 선택 편향 분석 전문가입니다.
아래 분석 데이터를 바탕으로, 팸플릿의 각 슬롯에 들어갈 짧은 해석 문장을 작성하세요.

규칙:
- 제공된 수치를 직접 언급하세요 (만들어내지 마세요)
- 친근하고 자연스러운 한국어로 작성하세요
- 각 슬롯의 길이 제한을 반드시 지키세요
- 반드시 JSON 형식으로만 응답하세요

━━ 분석 데이터 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[상위 선호 항목 (가중치 높을수록 중요)]
${topList}

[낮게 평가한 항목]
${bottomList}

[그룹별 가중치 비중]
  가격(월세+보증금+관리비): ${groupPct("price")}
  안전(CCTV+방범창+경비원+카드키): ${groupPct("safety")}
  통학(도보+버스): ${groupPct("commute")}
  환경(소음+경사도+벌레지수+가로등): ${groupPct("env")}

[감지된 편향 유형]: ${dominantBias}
[편향 근거]: ${biasEvidence}

[초기→최종 가중치 변화 (숨겨진 선호)]
${deltaSection}

[매물 정보]
${propSection}

━━ 작성 슬롯 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "personaLabel": "<이 사용자를 표현하는 8자 이내 레이블. 예: '실속형 탐색가', '안전 최우선형'>",
  "biasExplanation": "<감지된 편향(${dominantBias})을 설명하는 2문장. 첫 문장: 편향 정의. 둘째 문장: 이 데이터에서 구체적으로 어떻게 나타났는지. 50자 이내로 작성>",
  "hiddenPrefText": ${bigDeltas.length > 0 ? '"<변화량이 가장 큰 항목을 중심으로 초기 예상과 달리 실제 선택에서 드러난 선호를 1문장으로. 없으면 null>"' : "null"},
  "missedAspectText": "<낮게 평가한 항목 중 놓쳤을 수 있는 관점을 1문장으로. 예: 소음(현재 가중치: -0.3)은 장기 거주 시 삶의 질에 크게 영향을 미칠 수 있습니다>",
  "top1Reason": ${topProperty ? '"<1위 매물이 선택된 이유를 1~2문장으로. 위 가중치와 연결지어 설명>"' : "null"}
}

반드시 위 JSON 형식 그대로만 응답하세요. 다른 텍스트 없이 JSON만 출력하세요.`;
}
