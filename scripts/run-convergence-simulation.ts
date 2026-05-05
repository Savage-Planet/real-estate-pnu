import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { fetchRealData } from "../lib/simulation/fetch-real-data";
import { runSimulation, type SimulationConfig } from "../lib/simulation/run-simulation";
import { renderChartSvg } from "../lib/simulation/render-chart-svg";

dotenv.config({ path: path.resolve(__dirname, "..", ".env.local") });

const COSINE_TARGET = parseFloat(process.argv[2] ?? "0.9");
const ABSOLUTE_MAX = parseInt(process.argv[3] ?? "500", 10);
const BUILDING_ID = process.argv[4] ?? undefined;

async function main() {
  console.log("=== 수렴 시뮬레이션 시작 (실제 매물) ===");
  console.log(`  코사인 목표: ${COSINE_TARGET}`);
  console.log(`  최대 라운드: ${ABSOLUTE_MAX}`);
  if (BUILDING_ID) console.log(`  건물 ID: ${BUILDING_ID}`);
  console.log();

  console.log("Supabase에서 실제 매물/건물 불러오는 중...");
  const { properties, building, stats, commuteById } = await fetchRealData(BUILDING_ID);
  console.log(`  매물 ${properties.length}개 로드 완료`);
  console.log(`  기준 건물: ${building.name} (${building.id})`);
  console.log();

  const config: SimulationConfig = {
    candidateCount: properties.length,
    minRounds: 5,
    absoluteMaxRounds: ABSOLUTE_MAX,
    hiddenMatchCosine: COSINE_TARGET,
  };

  const t0 = Date.now();
  const result = runSimulation(config, properties, stats, commuteById);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log();
  console.log("=== 결과 요약 ===");
  console.log(`  매물 수: ${properties.length}`);
  console.log(`  총 라운드: ${result.meta.totalRounds}`);
  console.log(`  코사인 유사도 ≥ ${COSINE_TARGET} 도달: ${result.meta.cosineReachedRound != null ? `${result.meta.cosineReachedRound}회` : "미도달"}`);
  console.log(`  코사인 최대값: ${result.meta.cosineMaxValue.toFixed(4)} (${result.meta.cosineMaxRound}회차)`);
  console.log(`  수렴 판정: ${result.meta.convergenceRound != null ? `${result.meta.convergenceRound}회 (${result.meta.convergenceReason})` : "미수렴"}`);
  console.log(`  실행 시간: ${elapsed}초`);

  if (result.series.length > 0) {
    const last = result.series[result.series.length - 1];
    console.log(`  최종 집중도: ${last.concentration.toFixed(4)}`);
    console.log(`  최종 Top-K 안정도: ${last.topKStability.toFixed(2)}`);
    console.log(`  최종 코사인 유사도: ${last.cosineToHidden.toFixed(4)}`);
  }

  const outDir = path.resolve(__dirname, "..", "out", "simulation");
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, "last-run.json");
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");
  console.log(`\n  JSON → ${jsonPath}`);

  const svgContent = renderChartSvg(result);
  const svgPath = path.join(outDir, "last-run-chart.svg");
  fs.writeFileSync(svgPath, svgContent, "utf-8");
  console.log(`  SVG  → ${svgPath}`);

  console.log("\n완료!");
}

main().catch((e) => {
  console.error("시뮬레이션 실패:", e);
  process.exit(1);
});
