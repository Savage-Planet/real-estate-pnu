/**
 * run-hierarchical-simulation.ts
 * ================================
 * 계층적 추천 모델 v1 CLI 실험 스크립트
 *
 * 실행:
 *   npm run sim:hierarchical
 *   npm run sim:hierarchical -- --building <id> --verbose
 *   npm run sim:hierarchical -- --no-cache (K-Means 재계산)
 *
 * 출력 파일 (out/simulation/hierarchical/):
 *   cluster-result.json  - K-Means 클러스터 빌드 결과 (재사용 가능)
 *   last-run.json        - 최신 실험 전체 결과
 *   personas-report.json - 3 페르소나 검증 리포트
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import type { FeatureVector } from "@/lib/feature-engineer";
import { normalizeToUnitBall } from "@/lib/reward-model";
import { fetchRealData } from "@/lib/simulation/fetch-real-data";
import { buildClusters, type ClusterBuildOutput } from "@/lib/hierarchical/cluster-builder";
import {
  runHierarchical,
  isTopInTopPercentile,
  isCorrectClusterSelected,
  type ConvergenceReport,
} from "@/lib/hierarchical/hierarchical-convergence";

// ──────────────────────────────────────────────────────────
// CLI 인수 파싱
// ──────────────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const BUILDING_ID = getArg("building");
const VERBOSE = hasFlag("verbose");
const NO_CACHE = hasFlag("no-cache");

// ──────────────────────────────────────────────────────────
// 출력 디렉터리
// ──────────────────────────────────────────────────────────

const OUT_DIR = path.join(process.cwd(), "out", "simulation", "hierarchical");
fs.mkdirSync(OUT_DIR, { recursive: true });

const CLUSTER_CACHE = path.join(OUT_DIR, "cluster-result.json");
const LAST_RUN_FILE = path.join(OUT_DIR, "last-run.json");
const PERSONAS_FILE = path.join(OUT_DIR, "personas-report.json");

// ──────────────────────────────────────────────────────────
// 3 페르소나 정의
// ──────────────────────────────────────────────────────────

/**
 * dim 인덱스:
 *  0: 월세, 1: 보증금, 2: 관리비, 3: 크기, 4: 방개수
 *  5: 남향, 6: 북향, 7: 주차, 8: CCTV, 9: 엘리베이터
 * 10: 년식, 11: 기타옵션, 12: 소음, 13: 통학도보, 14: 통학버스
 */
interface Persona {
  name: string;
  desc: string;
  hidden: FeatureVector;
  /** 올바른 군집 판단에 사용할 feature 인덱스 */
  clusterCheckIdx: number;
  /** 해당 feature가 클수록 선호 */
  clusterHigherIsBetter: boolean;
  /** Top-1 검증용 feature 인덱스 */
  top1CheckIdx: number;
  top1HigherIsBetter: boolean;
}

const PERSONAS: Persona[] = [
  {
    name: "A (가격 우선)",
    desc: "월세·보증금·관리비 낮은 매물 선호",
    hidden: normalizeToUnitBall([
      -0.9, -0.7, -0.6,  // 월세↓ 보증금↓ 관리비↓
       0.0,  0.0,
       0.0,  0.0,
       0.0,  0.0,  0.0,
       0.0,  0.0,
       0.0,
       0.0,  0.0,
    ] as FeatureVector),
    clusterCheckIdx: 0,      // 월세 (낮을수록 좋음 → feature 높을수록 좋음: false)
    clusterHigherIsBetter: false,
    top1CheckIdx: 0,
    top1HigherIsBetter: false,
  },
  {
    name: "B (거리 우선)",
    desc: "도보·버스 통학시간 짧은 매물 선호",
    hidden: normalizeToUnitBall([
       0.0,  0.0,  0.0,
       0.0,  0.0,
       0.0,  0.0,
       0.0,  0.0,  0.0,
       0.0,  0.0,
       0.0,
       0.9,  0.6,           // 통학도보↑(짧을수록 feature↑) 통학버스↑
    ] as FeatureVector),
    clusterCheckIdx: 13,     // 통학도보 feature (높을수록 가까움)
    clusterHigherIsBetter: true,
    top1CheckIdx: 13,
    top1HigherIsBetter: true,
  },
  {
    name: "C (소음 우선)",
    desc: "소음 수준 낮은 매물 선호",
    hidden: normalizeToUnitBall([
       0.0,  0.0,  0.0,
       0.0,  0.0,
       0.0,  0.0,
       0.0,  0.0,  0.0,
       0.0,  0.0,
      -0.9,                  // 소음↓ (feature 낮을수록 실제 소음 낮음)
       0.0,  0.0,
    ] as FeatureVector),
    clusterCheckIdx: 12,     // 소음 feature (낮을수록 좋음)
    clusterHigherIsBetter: false,
    top1CheckIdx: 12,
    top1HigherIsBetter: false,
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
  sep("계층적 추천 모델 v1 시뮬레이션");

  // 1. 실제 데이터 로드
  process.stdout.write("데이터 로딩 중 (Supabase)...\n");
  const t0 = Date.now();
  const { properties, building, stats, commuteById } = await fetchRealData(BUILDING_ID);
  process.stdout.write(`  → 매물 ${properties.length}개 로드 완료 (${((Date.now() - t0) / 1000).toFixed(1)}초)\n`);
  process.stdout.write(`  → 건물: ${building.name ?? building.id}\n`);

  // 매물 맵 생성
  const propertyMap = new Map(properties.map((p) => [p.id, p]));

  // 2. K-Means 클러스터 빌드 (캐시 재사용 가능)
  let clusterOutput: ClusterBuildOutput;

  if (!NO_CACHE && fs.existsSync(CLUSTER_CACHE)) {
    process.stdout.write("\nK-Means 결과 캐시 로드...\n");
    clusterOutput = JSON.parse(fs.readFileSync(CLUSTER_CACHE, "utf-8")) as ClusterBuildOutput;
    process.stdout.write(`  → K=${clusterOutput.k}, silhouette=${clusterOutput.silhouetteScore.toFixed(4)}, `);
    process.stdout.write(`군집 ${clusterOutput.clusters.map((c) => `"${c.label}"(${c.size})`).join(" / ")}\n`);
  } else {
    sep("K-Means 클러스터 빌드");
    const t1 = Date.now();
    clusterOutput = buildClusters(properties, stats, commuteById, { verbose: true });
    process.stdout.write(`\nK-Means 완료 (${((Date.now() - t1) / 1000).toFixed(1)}초)\n`);
    process.stdout.write(`최적 K=${clusterOutput.k}, silhouette=${clusterOutput.silhouetteScore.toFixed(4)}\n`);
    process.stdout.write("군집 요약:\n");
    for (const c of clusterOutput.clusters) {
      process.stdout.write(`  [${c.clusterId}] "${c.label}" — ${c.size}개 매물, 대표: ${c.representativePropertyId.slice(0, 8)}\n`);
    }
    fs.writeFileSync(CLUSTER_CACHE, JSON.stringify(clusterOutput, null, 2));
    process.stdout.write(`\n저장: ${CLUSTER_CACHE}\n`);
  }

  // 3. 페르소나 검증
  sep("페르소나 3개 검증");
  const personaResults: object[] = [];
  const allRunData: object[] = [];

  for (const persona of PERSONAS) {
    sep(`페르소나 ${persona.name} | ${persona.desc}`);

    const navConfig = { verbose: VERBOSE || true, topK: 3, escapeThreshold: 0.6 };

    const t2 = Date.now();
    const result = runHierarchical(
      clusterOutput,
      propertyMap,
      stats,
      commuteById,
      persona.hidden,
      navConfig,
    );
    const elapsed = ((Date.now() - t2) / 1000).toFixed(2);

    const { report, phase1 } = result;

    // 검증 1: Phase 1에서 올바른 군집 선택 여부
    const correctCluster = isCorrectClusterSelected(
      phase1.winnerClusterId,
      clusterOutput,
      persona.clusterCheckIdx,
      persona.clusterHigherIsBetter,
    );

    // 검증 2: Top-1 매물이 상위 30% 이내인지
    const top1Id = report.topRecommendations[0]?.propertyId;
    const top1InPercentile = top1Id
      ? isTopInTopPercentile(top1Id, propertyMap, stats, commuteById, persona.top1CheckIdx, persona.top1HigherIsBetter)
      : false;

    const winnerCluster = clusterOutput.clusters[phase1.winnerClusterId];

    process.stdout.write("\n── 결과 요약 ──\n");
    process.stdout.write(`  Phase 1 선택 군집: "${winnerCluster.label}" (${correctCluster ? "✓ 올바름" : "✗ 불일치"})\n`);
    process.stdout.write(`  Phase 1 비교 횟수: ${report.phase1Comparisons}\n`);
    process.stdout.write(`  Phase 2 비교 횟수: ${report.phase2Comparisons}\n`);
    process.stdout.write(`  총 비교 횟수:      ${report.totalComparisons}\n`);
    process.stdout.write(`  이탈 횟수:         ${report.escapeCount}\n`);
    process.stdout.write(`  수렴 성공:         ${report.success ? "✓" : "✗"}${report.forceTerminated ? " (강제종료)" : ""}\n`);
    process.stdout.write(`  코사인 유사도:     ${report.cosineToHidden?.toFixed(4) ?? "N/A"}\n`);
    process.stdout.write(`  Top-1 매물:        ${top1Id?.slice(0, 8) ?? "-"} (상위30%: ${top1InPercentile ? "✓" : "✗"})\n`);
    process.stdout.write(`  Top-3 추천: ${report.topRecommendations.map((r) => `${r.propertyId.slice(0, 8)}(${r.score.toFixed(3)})`).join(", ")}\n`);
    process.stdout.write(`  실행 시간:         ${elapsed}초\n`);

    const personaReport = {
      persona: persona.name,
      desc: persona.desc,
      correctClusterSelected: correctCluster,
      winnerClusterId: phase1.winnerClusterId,
      winnerClusterLabel: winnerCluster.label,
      phase1Comparisons: report.phase1Comparisons,
      phase2Comparisons: report.phase2Comparisons,
      totalComparisons: report.totalComparisons,
      escapeCount: report.escapeCount,
      converged: report.success,
      forceTerminated: report.forceTerminated,
      cosineToHidden: report.cosineToHidden,
      top1PropertyId: top1Id ?? null,
      top1InTopPercentile: top1InPercentile,
      topRecommendations: report.topRecommendations,
      elapsedSec: parseFloat(elapsed),
    };
    personaResults.push(personaReport);
    allRunData.push({ persona: persona.name, result, clusterOutput });
  }

  // 4. 전체 요약
  sep("전체 페르소나 검증 요약");
  process.stdout.write(
    `${"페르소나".padEnd(18)} ${"군집선택".padEnd(8)} ${"Top30%".padEnd(8)} ${"총비교".padEnd(8)} ${"이탈".padEnd(6)} ${"수렴".padEnd(6)} ${"코사인".padEnd(8)}\n`,
  );
  process.stdout.write("─".repeat(70) + "\n");
  for (const r of personaResults as any[]) {
    process.stdout.write(
      `${r.persona.padEnd(18)} ${(r.correctClusterSelected ? "✓" : "✗").padEnd(8)} ${(r.top1InTopPercentile ? "✓" : "✗").padEnd(8)} ${String(r.totalComparisons).padEnd(8)} ${String(r.escapeCount).padEnd(6)} ${(r.converged ? "✓" : "✗").padEnd(6)} ${(r.cosineToHidden?.toFixed(4) ?? "-").padEnd(8)}\n`,
    );
  }

  // 5. 파일 저장
  fs.writeFileSync(PERSONAS_FILE, JSON.stringify(personaResults, null, 2));
  fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(
    {
      runAt: new Date().toISOString(),
      buildingId: building.id,
      buildingName: building.name,
      propertyCount: properties.length,
      clusterOutput: { k: clusterOutput.k, silhouetteScore: clusterOutput.silhouetteScore, clusters: clusterOutput.clusters.map((c) => ({ clusterId: c.clusterId, label: c.label, size: c.size, representativePropertyId: c.representativePropertyId })) },
      personas: personaResults,
    },
    null, 2,
  ));

  sep();
  process.stdout.write(`결과 저장:\n  ${PERSONAS_FILE}\n  ${LAST_RUN_FILE}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
