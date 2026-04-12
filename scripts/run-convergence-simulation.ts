import * as fs from "fs";
import * as path from "path";
import { generateSyntheticProperties } from "../lib/simulation/synthetic-properties";
import { runSimulation, type SimulationConfig } from "../lib/simulation/run-simulation";
import { renderChartSvg } from "../lib/simulation/render-chart-svg";

const CANDIDATE_COUNT = parseInt(process.argv[2] ?? "60", 10);
const COSINE_TARGET = parseFloat(process.argv[3] ?? "0.9");
const ABSOLUTE_MAX = parseInt(process.argv[4] ?? "500", 10);

const config: SimulationConfig = {
  candidateCount: CANDIDATE_COUNT,
  minRounds: 5,
  absoluteMaxRounds: ABSOLUTE_MAX,
  hiddenMatchCosine: COSINE_TARGET,
};

console.log("=== 수렴 시뮬레이션 시작 ===");
console.log(`  매물 수: ${CANDIDATE_COUNT}`);
console.log(`  코사인 목표: ${COSINE_TARGET}`);
console.log(`  최대 라운드: ${ABSOLUTE_MAX}`);
console.log();

const { properties, stats, commuteById } = generateSyntheticProperties(CANDIDATE_COUNT);
console.log(`합성 매물 ${properties.length}개 생성 완료`);
console.log();

const t0 = Date.now();
const result = runSimulation(config, properties, stats, commuteById);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log();
console.log("=== 결과 요약 ===");
console.log(`  총 라운드: ${result.meta.totalRounds}`);
console.log(`  코사인 유사도 ≥ ${COSINE_TARGET} 도달: ${result.meta.cosineReachedRound != null ? `${result.meta.cosineReachedRound}회` : "미도달"}`);
console.log(`  수렴 판정: ${result.meta.convergenceRound != null ? `${result.meta.convergenceRound}회 (${result.meta.convergenceReason})` : "미수렴"}`);
console.log(`  실행 시간: ${elapsed}초`);

if (result.series.length > 0) {
  const last = result.series[result.series.length - 1];
  console.log(`  최종 EVR: ${last.evr.toFixed(6)}`);
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
