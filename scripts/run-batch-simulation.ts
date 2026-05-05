import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { fetchRealData } from "../lib/simulation/fetch-real-data";
import { runSimulation, type SimulationConfig, type SimulationResult } from "../lib/simulation/run-simulation";

dotenv.config({ path: path.resolve(__dirname, "..", ".env.local") });

const RUNS = parseInt(process.argv[2] ?? "50", 10);
const COSINE_TARGET = parseFloat(process.argv[3] ?? "0.9");
const ABSOLUTE_MAX = parseInt(process.argv[4] ?? "250", 10);
const BUILDING_ID = process.argv[5] ?? undefined;

interface RunSummary {
  run: number;
  cosineReachedRound: number | null;
  cosineMaxValue: number;
  cosineMaxRound: number;
  concentrationAtReach: number | null;
  topKStabilityAtReach: number | null;
  evrAtReach: number | null;
  convergenceRound: number | null;
  convergenceReason: string | null;
}

function getMetricsAtRound(result: SimulationResult, round: number | null) {
  if (round == null || round < 1 || round > result.series.length) {
    return { concentration: null, topKStability: null, evr: null };
  }
  const entry = result.series[round - 1];
  return {
    concentration: entry.concentration,
    topKStability: entry.topKStability,
    evr: entry.evr,
  };
}

async function main() {
  console.log(`=== 배치 시뮬레이션 (${RUNS}회 반복) ===`);
  console.log(`  코사인 목표: ${COSINE_TARGET}`);
  console.log(`  최대 라운드/회: ${ABSOLUTE_MAX}`);
  if (BUILDING_ID) console.log(`  건물 ID: ${BUILDING_ID}`);
  console.log();

  console.log("Supabase에서 실제 매물/건물 불러오는 중...");
  const { properties, building, stats, commuteById } = await fetchRealData(BUILDING_ID);
  console.log(`  매물 ${properties.length}개 로드 완료`);
  console.log(`  기준 건물: ${building.name} (${building.id})`);
  console.log();

  const summaries: RunSummary[] = [];
  const t0 = Date.now();

  for (let i = 1; i <= RUNS; i++) {
    const config: SimulationConfig = {
      candidateCount: properties.length,
      minRounds: 5,
      absoluteMaxRounds: ABSOLUTE_MAX,
      hiddenMatchCosine: COSINE_TARGET,
      silent: true,
    };

    const result = runSimulation(config, properties, stats, commuteById);
    const atReach = getMetricsAtRound(result, result.meta.cosineReachedRound);

    summaries.push({
      run: i,
      cosineReachedRound: result.meta.cosineReachedRound,
      cosineMaxValue: result.meta.cosineMaxValue,
      cosineMaxRound: result.meta.cosineMaxRound,
      concentrationAtReach: atReach.concentration,
      topKStabilityAtReach: atReach.topKStability,
      evrAtReach: atReach.evr,
      convergenceRound: result.meta.convergenceRound,
      convergenceReason: result.meta.convergenceReason,
    });

    const tag = result.meta.cosineReachedRound != null
      ? `cos≥${COSINE_TARGET} @${result.meta.cosineReachedRound}회`
      : `미도달 (max=${result.meta.cosineMaxValue.toFixed(4)} @${result.meta.cosineMaxRound}회)`;
    process.stdout.write(`  [${String(i).padStart(3)}/${RUNS}] ${tag}\n`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const reached = summaries.filter((s) => s.cosineReachedRound != null);
  const notReached = summaries.filter((s) => s.cosineReachedRound == null);

  console.log();
  console.log("══════════════════════════════════════════");
  console.log(`  총 ${RUNS}회 실행 완료 (${elapsed}초)`);
  console.log("══════════════════════════════════════════");
  console.log();

  console.log(`▶ 코사인 유사도 ≥ ${COSINE_TARGET} 도달: ${reached.length}/${RUNS}회 (${((reached.length / RUNS) * 100).toFixed(1)}%)`);
  console.log(`  미도달: ${notReached.length}/${RUNS}회`);
  console.log();

  if (reached.length > 0) {
    const rounds = reached.map((s) => s.cosineReachedRound!);
    const avgRound = rounds.reduce((a, b) => a + b, 0) / rounds.length;
    const minRound = Math.min(...rounds);
    const maxRound = Math.max(...rounds);
    const medianRound = rounds.sort((a, b) => a - b)[Math.floor(rounds.length / 2)];

    const avgConc = reached.reduce((a, s) => a + s.concentrationAtReach!, 0) / reached.length;
    const avgTopK = reached.reduce((a, s) => a + s.topKStabilityAtReach!, 0) / reached.length;
    const avgEvr = reached.reduce((a, s) => a + s.evrAtReach!, 0) / reached.length;

    console.log(`▶ cos ≥ ${COSINE_TARGET} 도달 라운드 통계 (${reached.length}회 기준)`);
    console.log(`  평균: ${avgRound.toFixed(1)}회`);
    console.log(`  중앙값: ${medianRound}회`);
    console.log(`  최소: ${minRound}회 / 최대: ${maxRound}회`);
    console.log();
    console.log(`▶ cos ≥ ${COSINE_TARGET} 도달 시점의 파라미터 평균`);
    console.log(`  사후분포 집중도 (concentration): ${avgConc.toFixed(4)}`);
    console.log(`  Top-K 안정도:                    ${avgTopK.toFixed(4)}`);
    console.log(`  EVR:                             ${avgEvr.toFixed(6)}`);
  }

  if (notReached.length > 0) {
    const maxCos = notReached.map((s) => s.cosineMaxValue);
    const avgMaxCos = maxCos.reduce((a, b) => a + b, 0) / maxCos.length;
    console.log();
    console.log(`▶ 미도달 ${notReached.length}회의 코사인 최대값 평균: ${avgMaxCos.toFixed(4)}`);
  }

  const allMaxCos = summaries.map((s) => s.cosineMaxValue);
  const overallAvgMaxCos = allMaxCos.reduce((a, b) => a + b, 0) / allMaxCos.length;
  const allMaxRounds = summaries.map((s) => s.cosineMaxRound);
  const overallAvgMaxRound = allMaxRounds.reduce((a, b) => a + b, 0) / allMaxRounds.length;

  console.log();
  console.log(`▶ 전체 ${RUNS}회 코사인 최대값 평균: ${overallAvgMaxCos.toFixed(4)} (평균 ${overallAvgMaxRound.toFixed(1)}회차)`);

  const outDir = path.resolve(__dirname, "..", "out", "simulation");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "batch-result.json");
  fs.writeFileSync(jsonPath, JSON.stringify(summaries, null, 2), "utf-8");
  console.log(`\n  JSON → ${jsonPath}`);
  console.log("\n완료!");
}

main().catch((e) => {
  console.error("배치 시뮬레이션 실패:", e);
  process.exit(1);
});
