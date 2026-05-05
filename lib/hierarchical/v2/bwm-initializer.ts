/**
 * bwm-initializer.ts
 * ==================
 * Best-Worst Method (BWM) 기반 카테고리 내 가중치 초기화
 *
 * 참고 논문:
 *   Rezaei (2015) "Best-worst multi-criteria decision-making method"
 *   Omega, 53, 49-57.
 *   https://doi.org/10.1016/j.omega.2014.11.009
 *
 * 알고리즘:
 *   1. 사용자가 "가장 중요한(Best)" 기준과 "가장 덜 중요한(Worst)" 기준을 지목
 *   2. Best vs 나머지 비교 벡터 a_Bj (1-9 척도)
 *   3. 나머지 vs Worst 비교 벡터 a_jW (1-9 척도)
 *   4. 선형 최적화로 w* 산출
 *
 * 시뮬레이션 모드:
 *   실제 서비스에서는 사용자가 2개 질문 세트에 답변.
 *   시뮬레이션에서는 hiddenSub 벡터에서 비율을 자동 도출.
 *
 * 수렴 기대치:
 *   BWM prior 도입 시 micro-learner MCMC가 이미 올바른 방향에서
 *   시작하므로 비교 횟수가 ~30-40% 감소 예상.
 */

// ──────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────

export interface BwmInput {
  /** "가장 중요한" 기준의 인덱스 */
  bestIdx: number;
  /** "가장 덜 중요한" 기준의 인덱스 */
  worstIdx: number;
  /**
   * Best vs Others 비교 벡터 (길이 = 기준 수)
   * a_Bj: Best가 기준 j보다 a_Bj배 중요 (1-9 정수)
   * a_BB = 1 (자기 자신)
   */
  bestToOthers: number[];
  /**
   * Others vs Worst 비교 벡터 (길이 = 기준 수)
   * a_jW: 기준 j가 Worst보다 a_jW배 중요 (1-9 정수)
   * a_WW = 1 (자기 자신)
   */
  othersToWorst: number[];
}

export interface BwmResult {
  /** 정규화된 가중치 벡터 (합 = 1, 모두 ≥ 0) */
  weights: number[];
  /** 일관성 비율 (낮을수록 일관적, ≤ 0.1 권장) */
  consistencyRatio: number;
}

// ──────────────────────────────────────────────────────────
// BWM 비교 척도 테이블 (Rezaei 2015, Table 1)
// ──────────────────────────────────────────────────────────

/** 기준 수 n에 대한 최대 일관성 지수 ξ* (Rezaei 2015) */
const CONSISTENCY_INDEX: Record<number, number> = {
  2: 0.00,
  3: 0.16,
  4: 0.44,
  5: 1.00,
  6: 1.63,
  7: 2.18,
  8: 2.67,
  9: 3.04,
  10: 3.34,
};

function getConsistencyIndex(n: number): number {
  return CONSISTENCY_INDEX[n] ?? 3.34 + (n - 10) * 0.3;
}

// ──────────────────────────────────────────────────────────
// 시뮬레이션용: hiddenSub → BwmInput 도출
// ──────────────────────────────────────────────────────────

/**
 * 숨겨진 서브 가중치 벡터로부터 BWM 입력을 시뮬레이션한다.
 *
 * 실제 서비스에서는 이 함수 없이 사용자가 직접 best/worst를 고르고
 * 중요도 비율(1-9)을 답변한다.
 *
 * @param subWeights "높을수록 선호" 기준의 서브 가중치 (extractSubVector 결과)
 */
export function deriveBwmFromHidden(subWeights: number[]): BwmInput {
  const n = subWeights.length;
  if (n < 2) {
    return { bestIdx: 0, worstIdx: 0, bestToOthers: [1], othersToWorst: [1] };
  }

  // 절댓값 기준으로 best/worst 선택 (부호 이미 처리됨 — extractSubVector가 invert 적용)
  const abs = subWeights.map(Math.abs);
  const bestIdx = abs.indexOf(Math.max(...abs));
  const worstIdx = abs.indexOf(Math.min(...abs));

  const wBest = abs[bestIdx];
  const wWorst = Math.max(abs[worstIdx], 1e-6); // divide-by-zero 방지

  // a_Bj = wBest / wj, 1-9 척도로 반올림 후 clamp
  const bestToOthers = abs.map((w) => {
    const ratio = wBest / Math.max(w, 1e-6);
    return Math.min(9, Math.max(1, Math.round(ratio)));
  });

  // a_jW = wj / wWorst, 1-9 척도로 반올림 후 clamp
  const othersToWorst = abs.map((w) => {
    const ratio = w / wWorst;
    return Math.min(9, Math.max(1, Math.round(ratio)));
  });

  // 정의상 a_BB = 1, a_WW = 1
  bestToOthers[bestIdx] = 1;
  othersToWorst[worstIdx] = 1;

  return { bestIdx, worstIdx, bestToOthers, othersToWorst };
}

// ──────────────────────────────────────────────────────────
// BWM 선형 최적화 풀이 (Rezaei 2015 §3.2 linearized form)
// ──────────────────────────────────────────────────────────

/**
 * BWM 입력으로 가중치를 산출한다.
 *
 * Linearized BWM (Liang et al., 2020 "Consistency issues in the best worst method"):
 *   min ξ
 *   s.t.
 *     w_B - a_Bj * w_j ≤ ξ  for all j
 *     a_Bj * w_j - w_B ≤ ξ  for all j
 *     w_j - a_jW * w_W ≤ ξ  for all j
 *     a_jW * w_W - w_j ≤ ξ  for all j
 *     Σ w_j = 1, w_j ≥ 0
 *
 * 여기서는 iterative weighted least squares로 근사 풀이.
 * 실제 LP 라이브러리 없이도 수렴하는 간단한 구현.
 */
export function solveBwmWeights(input: BwmInput): BwmResult {
  const { bestIdx, worstIdx, bestToOthers, othersToWorst } = input;
  const n = bestToOthers.length;

  // 초기 가중치: 균등 분포
  let w = Array(n).fill(1 / n);

  // Iterative refinement (Salo & Hämäläinen 1992 방식으로 수렴)
  const MAX_ITER = 300;
  const TOL = 1e-7;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const wOld = [...w];

    // 각 기준의 새 가중치: Best 행과 Worst 열의 의미 일관 평균
    const newW = Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      // Best → j: w_B / a_Bj
      const fromBest = w[bestIdx] / bestToOthers[j];
      // j → Worst: a_jW * w_W
      const fromWorst = othersToWorst[j] * w[worstIdx];
      // 두 추정치의 기하평균
      newW[j] = Math.sqrt(fromBest * fromWorst);
    }

    // 정규화
    const sum = newW.reduce((s, v) => s + v, 0);
    w = newW.map((v) => v / sum);

    // 수렴 체크
    const delta = w.reduce((s, v, i) => s + Math.abs(v - wOld[i]), 0);
    if (delta < TOL) break;
  }

  // 일관성 비율 계산
  const wBest = w[bestIdx];
  const wWorst = w[worstIdx];
  let xiStar = 0;
  for (let j = 0; j < n; j++) {
    const e1 = Math.abs(wBest / Math.max(w[j], 1e-9) - bestToOthers[j]);
    const e2 = Math.abs(w[j] / Math.max(wWorst, 1e-9) - othersToWorst[j]);
    xiStar = Math.max(xiStar, e1, e2);
  }
  const ci = getConsistencyIndex(n);
  const cr = ci > 0 ? xiStar / ci : 0;

  return { weights: w, consistencyRatio: cr };
}

// ──────────────────────────────────────────────────────────
// 통합 API
// ──────────────────────────────────────────────────────────

/**
 * hiddenSub 벡터로부터 BWM 가중치를 직접 산출한다 (시뮬레이션 전용).
 *
 * 반환값은 "높을수록 선호" 기준의 정규화된 가중치 벡터.
 * micro-learner의 priorMean 초기화에 사용.
 */
export function bwmInitFromHidden(subWeights: number[]): number[] {
  const input = deriveBwmFromHidden(subWeights);
  const { weights } = solveBwmWeights(input);
  return weights;
}
