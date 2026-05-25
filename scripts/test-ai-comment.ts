/**
 * CLI experiment: feed weights → get pamphlet output.
 *
 * Usage:
 *   npx tsx scripts/test-ai-comment.ts --random
 *   npx tsx scripts/test-ai-comment.ts --random --repeat 5
 *   npx tsx scripts/test-ai-comment.ts --weights-file weights.json
 *   npx tsx scripts/test-ai-comment.ts --weights-file weights.json --initial-file initial.json
 *
 * Options:
 *   --random              Generate random 22-dim weights
 *   --repeat N            Run N times with different random weights (default 1)
 *   --weights-file PATH   JSON file with named weights map, e.g. {"월세":3,"CCTV":2}
 *   --initial-file PATH   JSON file with initial named weights (for delta analysis)
 *   --weights JSON        Inline JSON (ASCII feature names only, e.g. dim0, dim1...)
 *   --no-gemini           Skip Gemini call, show analytics only
 *
 * weights-file example (save as weights.json):
 *   {
 *     "월세": 3,
 *     "보증금": 1.5,
 *     "CCTV": 2,
 *     "통학(도보)": 1.2
 *   }
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Load .env.local from repo root
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

import {
  analyzeWeights,
  FEATURE_NAMES_KO,
  type WeightAnalytics,
} from "../lib/ai-comment/analyze-weights";
import { fillPamphletSlots } from "../lib/ai-comment/gemini-fill";
import type { PamphletSlots } from "../lib/ai-comment/pamphlet-slots";

const FEATURE_DIM = 22;

// ─── Utilities ────────────────────────────────────────────────────────────────

function randomWeights(): number[] {
  // Weights drawn from a mix: mostly small, a few large
  return Array.from({ length: FEATURE_DIM }, () => {
    const base = (Math.random() - 0.3) * 3; // biased positive
    return Math.round(base * 100) / 100;
  });
}

function namedToVector(named: Record<string, number>): number[] {
  const vec = new Array<number>(FEATURE_DIM).fill(0);
  for (const [name, val] of Object.entries(named)) {
    const idx = FEATURE_NAMES_KO.indexOf(name as (typeof FEATURE_NAMES_KO)[number]);
    if (idx >= 0) vec[idx] = val;
    else console.warn(`  [경고] 알 수 없는 특징명: "${name}" (무시됨)`);
  }
  return vec;
}

function bar(weight: number, maxAbs: number, width = 12): string {
  const filled = Math.round((Math.abs(weight) / (maxAbs || 1)) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  return weight < 0 ? `\x1b[31m${bar}\x1b[0m` : `\x1b[36m${bar}\x1b[0m`;
}

function printWeights(weights: number[]) {
  const maxAbs = Math.max(...weights.map(Math.abs), 0.01);
  const sorted = weights
    .map((w, i) => ({ name: FEATURE_NAMES_KO[i] ?? `dim${i}`, weight: w }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 12);

  for (const { name, weight } of sorted) {
    const label = name.padEnd(12, " ");
    const w = weight.toFixed(3).padStart(7);
    console.log(`  ${label} ${bar(weight, maxAbs)}  ${w}`);
  }
}

function printAnalytics(a: WeightAnalytics) {
  console.log("\x1b[33m편향 유형:\x1b[0m  " + a.dominantBias);
  console.log("\x1b[33m근거:\x1b[0m       " + a.biasEvidence);

  console.log("\n그룹 비중:");
  const g = a.groupShares;
  console.log(
    `  가격(월세+보증금+관리비):      ${pct(g.price)}`
  );
  console.log(
    `  안전(CCTV+방범창+경비원+카드): ${pct(g.safety)}`
  );
  console.log(
    `  통학(도보+버스):               ${pct(g.commute)}`
  );
  console.log(
    `  환경(소음+경사도+벌레+가로등): ${pct(g.env)}`
  );

  if (a.bigDeltas.length > 0) {
    console.log("\n초기→최종 변화 상위:");
    for (const d of a.bigDeltas) {
      const arrow = d.delta > 0 ? "\x1b[32m▲\x1b[0m" : "\x1b[31m▼\x1b[0m";
      console.log(
        `  ${arrow} ${d.name.padEnd(10)} ${d.initial.toFixed(3)} → ${d.final.toFixed(3)}  (Δ ${d.delta > 0 ? "+" : ""}${d.delta.toFixed(3)})`
      );
    }
  }
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function printPamphlet(slots: PamphletSlots, fromGemini: boolean) {
  const src = fromGemini ? "\x1b[32m[Gemini]\x1b[0m" : "\x1b[31m[Fallback]\x1b[0m";
  console.log(`\n${src} 팸플릿 결과:`);
  console.log("─".repeat(60));

  console.log(`\x1b[1m[A] 성향 레이블:\x1b[0m  ${slots.personaLabel}`);
  console.log(`\n\x1b[1m[B] 선택 편향:\x1b[0m`);
  console.log(`    ${slots.biasExplanation}`);

  if (slots.hiddenPrefText) {
    console.log(`\n\x1b[1m[C] 숨겨진 선호:\x1b[0m`);
    console.log(`    ${slots.hiddenPrefText}`);
  } else {
    console.log(`\n\x1b[1m[C] 숨겨진 선호:\x1b[0m  (초기 가중치 미제공으로 생략)`);
  }

  console.log(`\n\x1b[1m[D] 놓친 관점:\x1b[0m`);
  console.log(`    ${slots.missedAspectText}`);

  if (slots.top1Reason) {
    console.log(`\n\x1b[1m[E] 1위 매물 이유:\x1b[0m`);
    console.log(`    ${slots.top1Reason}`);
  }

  console.log("─".repeat(60));
}

// ─── Argument parsing ─────────────────────────────────────────────────────────

interface CliArgs {
  random: boolean;
  repeat: number;
  weights: number[] | null;
  initial: number[] | null;
  noGemini: boolean;
}

function loadJsonFile(filePath: string, label: string): Record<string, number> {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`${label} 파일을 찾을 수 없습니다: ${resolved}`);
    process.exit(1);
  }
  try {
    // Strip UTF-8 BOM if present (PowerShell Out-File adds it)
    let content = fs.readFileSync(resolved, "utf-8");
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    return JSON.parse(content) as Record<string, number>;
  } catch {
    console.error(`${label} 파일 파싱 실패. 유효한 JSON인지 확인하세요: ${resolved}`);
    process.exit(1);
  }
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };

  const random = argv.includes("--random");
  const repeat = parseInt(get("--repeat") ?? "1", 10);
  const noGemini = argv.includes("--no-gemini");

  let weights: number[] | null = null;

  // --weights-file takes priority (robust for Korean feature names)
  const wFile = get("--weights-file");
  if (wFile) {
    weights = namedToVector(loadJsonFile(wFile, "--weights-file"));
  } else {
    const wRaw = get("--weights");
    if (wRaw) {
      try {
        weights = namedToVector(JSON.parse(wRaw));
      } catch {
        console.error("--weights 파싱 실패. JSON 형식을 확인하세요.");
        console.error("한글 특징명은 --weights-file 옵션을 권장합니다.");
        process.exit(1);
      }
    }
  }

  let initial: number[] | null = null;
  const iFile = get("--initial-file");
  if (iFile) {
    initial = namedToVector(loadJsonFile(iFile, "--initial-file"));
  } else {
    const iRaw = get("--initial");
    if (iRaw) {
      try {
        initial = namedToVector(JSON.parse(iRaw));
      } catch {
        console.error("--initial 파싱 실패. JSON 형식을 확인하세요.");
        process.exit(1);
      }
    }
  }

  if (!random && !weights) {
    console.error("--random 또는 --weights-file 옵션 중 하나를 지정하세요.");
    console.error("예) npx tsx scripts/test-ai-comment.ts --random");
    console.error("예) npx tsx scripts/test-ai-comment.ts --weights-file weights.json");
    process.exit(1);
  }

  return { random, repeat, weights, initial, noGemini };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function runOnce(
  weights: number[],
  initial: number[] | null,
  noGemini: boolean,
  runIndex: number,
  totalRuns: number,
) {
  const header = totalRuns > 1 ? `\n${"═".repeat(60)}\n실험 ${runIndex + 1}/${totalRuns}\n${"═".repeat(60)}` : `\n${"═".repeat(60)}`;
  console.log(header);

  console.log("\n\x1b[1m=== 입력 가중치 (상위 12개) ===\x1b[0m");
  printWeights(weights);

  const analytics = analyzeWeights(
    weights,
    initial ?? undefined,
    null,
  );

  console.log("\n\x1b[1m=== 분석 결과 ===\x1b[0m");
  printAnalytics(analytics);

  if (noGemini) {
    console.log("\n[--no-gemini] Gemini 호출 생략");
    return;
  }

  console.log("\n\x1b[90m Gemini에 요청 중...\x1b[0m");
  const result = await fillPamphletSlots(analytics);

  if (result.error) {
    console.warn(`  [경고] ${result.error}`);
  }

  printPamphlet(result.slots, result.fromGemini);
}

async function main() {
  const args = parseArgs();
  const count = args.random ? Math.max(1, args.repeat) : 1;

  for (let i = 0; i < count; i++) {
    const weights = args.random ? randomWeights() : args.weights!;
    await runOnce(weights, args.initial, args.noGemini, i, count);
  }

  console.log("\n완료.\n");
}

main().catch((e) => {
  console.error("오류:", e);
  process.exit(1);
});
