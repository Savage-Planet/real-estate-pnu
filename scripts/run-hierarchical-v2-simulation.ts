/**
 * run-hierarchical-v2-simulation.ts
 * ===================================
 * 계층적 추천 모델 v2 CLI 실험 스크립트
 *
 * v2 핵심 특징:
 *   - Level 1: AMPLe (Oh et al., 2025) — 4D 카테고리 가중치 학습
 *   - 가상 아이템: Sadigh et al. (2017) — 정보량 최대 쌍 합성
 *   - Level 2: 카테고리 내 서브 차원 MCMC
 *   - GAI 구조: U(p) = Σ w_i · u_i(p)
 *
 * 실행:
 *   npm run sim:hierarchical-v2
 *   npm run sim:hierarchical-v2 -- --verbose
 *   npm run sim:hierarchical-v2 -- --compare  (v1 결과와 나란히 비교)
 *
 * 출력:
 *   out/simulation/hierarchical/v2-last-run.json
 *   out/simulation/hierarchical/v2-personas-report.json
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import type { FeatureVector } from "@/lib/feature-engineer";
import { normalizeToUnitBall } from "@/lib/reward-model";
import { fetchRealData } from "@/lib/simulation/fetch-real-data";
import { runNavigatorV2 } from "@/lib/hierarchical/v2/navigator-v2";
import { CATEGORY_NAMES, GROUP_KEYS } from "@/lib/hierarchical/v2/feature-groups";

// ──────────────────────────────────────────────────────────
// CLI 인수
// ──────────────────────────────────────────────────────────

function hasFlag(name: string) { return process.argv.includes(`--${name}`); }
function getArg(name: string) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const VERBOSE = hasFlag("verbose");
const COMPARE_V1 = hasFlag("compare");
const BUILDING_ID = getArg("building");

// ──────────────────────────────────────────────────────────
// 출력 디렉터리
// ──────────────────────────────────────────────────────────

const OUT_DIR = path.join(process.cwd(), "out", "simulation", "hierarchical");
fs.mkdirSync(OUT_DIR, { recursive: true });

const V2_LAST_RUN = path.join(OUT_DIR, "v2-last-run.json");
const V2_PERSONAS = path.join(OUT_DIR, "v2-personas-report.json");
const V1_PERSONAS = path.join(OUT_DIR, "personas-report.json");

// ──────────────────────────────────────────────────────────
// 3 페르소나 정의
// ──────────────────────────────────────────────────────────

interface Persona {
  name: string;
  desc: string;
  hidden: FeatureVector;
  /** 올바른 Level 1 카테고리 (0=거리, 1=가격, 2=안전, 3=편의) */
  expectedCatIdx: number;
}

const PERSONAS: Persona[] = [
  {
    name: "A (가격 우선)",
    desc: "월세·보증금·관리비 낮은 매물 선호",
    hidden: normalizeToUnitBall([
      -0.9, -0.7, -0.6,
       0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,
       0.0,  0.0,  0.0,  0.0,  0.0,  // dim 15-19
    ] as FeatureVector),
    expectedCatIdx: 1,  // 가격
  },
  {
    name: "B (거리 우선)",
    desc: "도보·버스 통학시간 짧고 경사 완만한 매물 선호",
    hidden: normalizeToUnitBall([
      0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
      0.9, 0.6,
      0.0, 0.0, 0.0, 0.0, 0.5,  // dim 15-19 (경사도 idx19)
    ] as FeatureVector),
    expectedCatIdx: 0,  // 거리
  },
  {
    name: "C (안전 우선)",
    desc: "소음 낮고 인터폰·방범창 있는 매물 선호",
    hidden: normalizeToUnitBall([
      0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
      -0.9,
      0.0, 0.0,
      0.7, 0.7, 0.0, 0.0, 0.0,  // dim 15-19 (방범창 idx15, 인터폰 idx16)
    ] as FeatureVector),
    expectedCatIdx: 2,  // 안전
  },
];

// ──────────────────────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────────────────────

function sep(title?: string) {
  const line = "─".repeat(60);
  if (title) process.stdout.write(`\n${line}\n  ${title}\n${line}\n`);
  else process.stdout.write(`${line}\n`);
}

// ──────────────────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────────────────

async function main() {
  sep("계층적 추천 모델 v2 시뮬레이션");
  process.stdout.write("  기반 논문: AMPLe (POSTECH, ACL 2025) + Sadigh et al. (RSS 2017) + GAI\n");

  // 1. 데이터 로드
  process.stdout.write("\n데이터 로딩 중 (Supabase)...\n");
  const t0 = Date.now();
  const { properties, building, stats, commuteById } = await fetchRealData(BUILDING_ID);
  process.stdout.write(`  → 매물 ${properties.length}개 (${((Date.now() - t0) / 1000).toFixed(1)}초)\n`);
  process.stdout.write(`  → 건물: ${building.name ?? building.id}\n`);

  // 2. 페르소나 검증
  sep("3개 페르소나 검증");
  const personaResults: object[] = [];

  for (const persona of PERSONAS) {
    sep(`페르소나 ${persona.name} | ${persona.desc}`);

    const t1 = Date.now();
    const { report } = runNavigatorV2(
      properties,
      stats,
      commuteById,
      persona.hidden,
      { verbose: VERBOSE || true, topK: 3 },
    );
    const elapsed = ((Date.now() - t1) / 1000).toFixed(2);

    // 검증: Level 1에서 올바른 카테고리를 최우선으로 선택했는지
    const topCatIdx = report.macroWeights.indexOf(Math.max(...report.macroWeights));
    const correctCategory = topCatIdx === persona.expectedCatIdx;

    process.stdout.write("\n── v2 결과 요약 ──\n");
    process.stdout.write(
      `  Level 1 최우선 카테고리: "${report.finalGroupLabel}" (w=${report.macroWeights[topCatIdx].toFixed(3)})\n`,
    );
    process.stdout.write(`    카테고리 가중치: [${CATEGORY_NAMES.map((n, i) => `${n}=${report.macroWeights[i].toFixed(3)}`).join(", ")}]\n`);
    process.stdout.write(`    카테고리 선택 정확도: ${correctCategory ? "✓ 올바름" : "✗ 불일치"} (예상: ${CATEGORY_NAMES[persona.expectedCatIdx]})\n`);
    process.stdout.write(`  Level 1 비교 횟수:     ${report.level1Comparisons}회\n`);
    process.stdout.write(`  Level 2 비교 횟수:     ${report.level2Comparisons}회\n`);
    process.stdout.write(`  총 비교 횟수:          ${report.totalComparisons}회\n`);
    process.stdout.write(`  이탈 횟수:             ${report.escapeCount}회\n`);
    process.stdout.write(`  수렴 성공:             ${report.success ? "✓" : "✗"}${report.forceTerminated ? " (강제종료)" : ""}\n`);
    process.stdout.write(`  Macro 집중도:          ${report.macroConcentration.toFixed(4)}\n`);
    process.stdout.write(`  코사인 유사도(서브):   ${report.cosineToHiddenSub?.toFixed(4) ?? "N/A"}\n`);
    process.stdout.write(`  Top-3 추천: ${report.topRecommendations.map((r) => `${r.propertyId.slice(0, 8)}(${r.score.toFixed(3)})`).join(", ")}\n`);
    process.stdout.write(`  실행 시간:             ${elapsed}초\n`);

    personaResults.push({
      persona: persona.name,
      desc: persona.desc,
      expectedCatIdx: persona.expectedCatIdx,
      expectedCatLabel: CATEGORY_NAMES[persona.expectedCatIdx],
      selectedCatIdx: topCatIdx,
      selectedCatLabel: CATEGORY_NAMES[topCatIdx],
      correctCategorySelected: correctCategory,
      macroWeights: report.macroWeights,
      level1Comparisons: report.level1Comparisons,
      level2Comparisons: report.level2Comparisons,
      totalComparisons: report.totalComparisons,
      escapeCount: report.escapeCount,
      converged: report.success,
      forceTerminated: report.forceTerminated,
      macroConcentration: report.macroConcentration,
      cosineToHiddenSub: report.cosineToHiddenSub,
      topRecommendations: report.topRecommendations,
      elapsedSec: parseFloat(elapsed),
    });
  }

  // 3. 전체 요약
  sep("v2 전체 페르소나 검증 요약");
  process.stdout.write(
    `${"페르소나".padEnd(18)} ${"카테고리선택".padEnd(12)} ${"L1비교".padEnd(8)} ${"L2비교".padEnd(8)} ${"총비교".padEnd(8)} ${"이탈".padEnd(6)} ${"수렴".padEnd(6)} ${"코사인(서브)".padEnd(12)}\n`,
  );
  process.stdout.write("─".repeat(82) + "\n");
  for (const r of personaResults as any[]) {
    process.stdout.write(
      `${r.persona.padEnd(18)} ${(r.correctCategorySelected ? `✓ ${r.selectedCatLabel}` : `✗ ${r.selectedCatLabel}`).padEnd(12)} ${String(r.level1Comparisons).padEnd(8)} ${String(r.level2Comparisons).padEnd(8)} ${String(r.totalComparisons).padEnd(8)} ${String(r.escapeCount).padEnd(6)} ${(r.converged ? "✓" : "✗").padEnd(6)} ${(r.cosineToHiddenSub?.toFixed(4) ?? "-").padEnd(12)}\n`,
    );
  }

  // 4. v1 비교
  if (COMPARE_V1 && fs.existsSync(V1_PERSONAS)) {
    sep("v1 vs v2 비교");
    const v1 = JSON.parse(fs.readFileSync(V1_PERSONAS, "utf-8")) as any[];
    process.stdout.write(
      `${"페르소나".padEnd(18)} ${"v1 총비교".padEnd(10)} ${"v2 총비교".padEnd(10)} ${"v1 코사인".padEnd(12)} ${"v2 코사인(서브)".padEnd(16)} ${"개선".padEnd(8)}\n`,
    );
    process.stdout.write("─".repeat(75) + "\n");
    for (let i = 0; i < PERSONAS.length; i++) {
      const v1r = v1[i];
      const v2r = (personaResults as any[])[i];
      if (!v1r || !v2r) continue;
      const improvement = v1r.totalComparisons - v2r.totalComparisons;
      process.stdout.write(
        `${v2r.persona.padEnd(18)} ${String(v1r.totalComparisons).padEnd(10)} ${String(v2r.totalComparisons).padEnd(10)} ${(v1r.cosineToHidden?.toFixed(4) ?? "-").padEnd(12)} ${(v2r.cosineToHiddenSub?.toFixed(4) ?? "-").padEnd(16)} ${(improvement > 0 ? `↓${improvement}회` : `↑${-improvement}회`).padEnd(8)}\n`,
      );
    }
  }

  // 5. 저장
  fs.writeFileSync(V2_PERSONAS, JSON.stringify(personaResults, null, 2));
  fs.writeFileSync(V2_LAST_RUN, JSON.stringify({
    runAt: new Date().toISOString(),
    buildingId: building.id,
    buildingName: building.name,
    propertyCount: properties.length,
    model: "hierarchical-v2",
    papers: [
      "AMPLe (Oh, Lee, Ok; POSTECH, ACL 2025)",
      "Sadigh et al. (RSS 2017) — Active Preference-Based Learning",
      "GAI Utility Decomposition (Springer 2025)",
    ],
    personas: personaResults,
  }, null, 2));

  sep();
  process.stdout.write(`결과 저장:\n  ${V2_PERSONAS}\n  ${V2_LAST_RUN}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
