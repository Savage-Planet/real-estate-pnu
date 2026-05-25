/**
 * variant-configs.ts
 * ===================
 * 12개 모델 변형(variant) 파라미터 정의
 *
 * Branch 1: Flat Bayesian (F1~F4)   — 단일 레벨 MCMC
 * Branch 2: Simple Hierarchy (H1~H4) — 계층 구조 도입
 * Branch 3: Active Query Hierarchy (A1~A4) — 능동 쿼리 + 도메인 제약
 *
 * 논문 근거:
 *   Chu & Ghahramani (2005) — Flat Bayesian preference learning
 *   Brochu et al. (2007) — Active preference learning with EVR
 *   Rezaei (2015) — Best-Worst Method
 *   Fürnkranz & Hüllermeier (2010) — Preference Learning overview
 *   Duchi et al. (2008) — Simplex projection
 *   Oh, Lee, Ok (2019/2024) — AMPLe comparison-based active preference learning
 *   Sadigh et al. (2017) — Active reward function learning
 *   Liang et al. (2020) — BWM consistency
 */

export interface VariantConfig {
  /** 식별자: "F1"~"A4" */
  id: string;
  /** 슬라이드/차트 표시용 레이블 */
  label: string;
  /** 브랜치 분류 */
  branch: "flat" | "hierarchy" | "active";

  // ── Flat 모델 옵션 (useHierarchical=false 일 때) ───────────────
  /** false → 기존 run-simulation.ts 사용 */
  useHierarchical: boolean;
  /** "random" | "evr" | "sadigh" */
  queryMode: "random" | "evr" | "sadigh";
  /** 사용자 슬라이더 기반 prior 사용 여부 */
  usePrior: boolean;
  /** Flat 레벨 BWM prior 초기화 사용 여부 */
  useBwm: boolean;

  // ── 계층 모델 옵션 (useHierarchical=true 일 때) ───────────────
  /** 심플렉스 투영 적용 여부 (매크로 학습) */
  useSimplexMacro: boolean;
  /**
   * AMPLe γ 감쇠 지수 (1.0 = 표준 Bayesian, 0.7 = AMPLe 권장)
   * Oh et al. (2019/2024) "Comparison-Based Active Preference Learning"
   */
  gamma: number;
  /**
   * 가상 아이템 유형
   * "none"    → 실제 매물 비교만
   * "simple"  → HIGH/LOW 단순 아키타입 (H4)
   * "tradeoff"→ Sadigh (2017) C(4,2) trade-off 쌍 (A1+)
   */
  virtualItemMode: "none" | "simple" | "tradeoff";
  /**
   * micro 사전 초기화 방식
   * "uniform" → 균등 (기본)
   * "bwm"     → Rezaei (2015) BWM 가중치 (A2+)
   */
  microPriorMode: "uniform" | "bwm";
  /**
   * micro 쌍 선택 방식
   * "random"    → 랜덤
   * "ambiguity" → |P(A≻B)-0.5| 최소 (Sadigh 2017, A3+)
   */
  microQueryMode: "random" | "ambiguity";
  /**
   * 실제 매물 쌍 선택 시 지리적 보너스 + 출현 패널티 적용 여부
   * InteractiveNavigator의 geoBonus + countPenalty (A4)
   */
  useGeoBonus: boolean;
}

// ──────────────────────────────────────────────────────────
// 12개 변형 정의
// ──────────────────────────────────────────────────────────

export const VARIANT_CONFIGS: VariantConfig[] = [
  // ── Branch 1: Flat Bayesian ────────────────────────────────────
  {
    id: "F1",
    label: "F1: Flat+Random",
    branch: "flat",
    useHierarchical: false,
    queryMode: "random",
    usePrior: false,
    useBwm: false,
    useSimplexMacro: false,
    gamma: 1.0,
    virtualItemMode: "none",
    microPriorMode: "uniform",
    microQueryMode: "random",
    useGeoBonus: false,
  },
  {
    id: "F2",
    label: "F2: Flat+EVR",
    branch: "flat",
    useHierarchical: false,
    queryMode: "evr",
    usePrior: false,
    useBwm: false,
    useSimplexMacro: false,
    gamma: 1.0,
    virtualItemMode: "none",
    microPriorMode: "uniform",
    microQueryMode: "random",
    useGeoBonus: false,
  },
  {
    id: "F3",
    label: "F3: Flat+EVR+Prior",
    branch: "flat",
    useHierarchical: false,
    queryMode: "evr",
    usePrior: true,
    useBwm: false,
    useSimplexMacro: false,
    gamma: 1.0,
    virtualItemMode: "none",
    microPriorMode: "uniform",
    microQueryMode: "random",
    useGeoBonus: false,
  },
  {
    id: "F4",
    label: "F4: Flat+EVR+BWM",
    branch: "flat",
    useHierarchical: false,
    queryMode: "evr",
    usePrior: true,
    useBwm: true,
    useSimplexMacro: false,
    gamma: 1.0,
    virtualItemMode: "none",
    microPriorMode: "uniform",
    microQueryMode: "random",
    useGeoBonus: false,
  },

  // ── Branch 2: Simple Hierarchy ─────────────────────────────────
  {
    id: "H1",
    label: "H1: Hier+Uniform",
    branch: "hierarchy",
    useHierarchical: true,
    queryMode: "random",
    usePrior: false,
    useBwm: false,
    useSimplexMacro: false,
    gamma: 1.0,
    virtualItemMode: "none",
    microPriorMode: "uniform",
    microQueryMode: "random",
    useGeoBonus: false,
  },
  {
    id: "H2",
    label: "H2: Hier+Simplex",
    branch: "hierarchy",
    useHierarchical: true,
    queryMode: "random",
    usePrior: false,
    useBwm: false,
    useSimplexMacro: true,
    gamma: 1.0,
    virtualItemMode: "none",
    microPriorMode: "uniform",
    microQueryMode: "random",
    useGeoBonus: false,
  },
  {
    id: "H3",
    label: "H3: Hier+Simplex+AMPLe",
    branch: "hierarchy",
    useHierarchical: true,
    queryMode: "random",
    usePrior: false,
    useBwm: false,
    useSimplexMacro: true,
    gamma: 0.7,
    virtualItemMode: "none",
    microPriorMode: "uniform",
    microQueryMode: "random",
    useGeoBonus: false,
  },
  {
    id: "H4",
    label: "H4: Hier+Simplex+AMPLe+SimpleVirtual",
    branch: "hierarchy",
    useHierarchical: true,
    queryMode: "random",
    usePrior: false,
    useBwm: false,
    useSimplexMacro: true,
    gamma: 0.7,
    virtualItemMode: "simple",
    microPriorMode: "uniform",
    microQueryMode: "random",
    useGeoBonus: false,
  },

  // ── Branch 3: Active Query Hierarchy (H4 기반 누적 개선) ─────────
  // H4 = Hier + Simplex + AMPLe(γ=0.7) + simple virtual
  // A1 = H4 + Ambiguity micro query  (판단 어려운 쌍 우선 선택)
  // A2 = H4 + BWM micro prior        (세부 항목 초기값 개선)
  // A3 = H4 + BWM + Ambiguity        (A1 + A2 조합, 최종 모델)
  {
    id: "A1",
    label: "A1: H4+Ambiguity",
    branch: "active",
    useHierarchical: true,
    queryMode: "random",
    usePrior: false,
    useBwm: false,
    useSimplexMacro: true,
    gamma: 0.7,
    virtualItemMode: "simple",
    microPriorMode: "uniform",
    microQueryMode: "ambiguity",
    useGeoBonus: false,
  },
  {
    id: "A2",
    label: "A2: H4+BWM_Micro",
    branch: "active",
    useHierarchical: true,
    queryMode: "random",
    usePrior: false,
    useBwm: false,
    useSimplexMacro: true,
    gamma: 0.7,
    virtualItemMode: "simple",
    microPriorMode: "bwm",
    microQueryMode: "random",
    useGeoBonus: false,
  },
  {
    id: "A3",
    label: "A3: H4+BWM+Ambiguity",
    branch: "active",
    useHierarchical: true,
    queryMode: "random",
    usePrior: false,
    useBwm: false,
    useSimplexMacro: true,
    gamma: 0.7,
    virtualItemMode: "simple",
    microPriorMode: "bwm",
    microQueryMode: "ambiguity",
    useGeoBonus: false,
  },
  {
    id: "A4",
    label: "A4: +GeoBonus",
    branch: "active",
    useHierarchical: true,
    queryMode: "random",
    usePrior: false,
    useBwm: false,
    useSimplexMacro: true,
    gamma: 0.7,
    virtualItemMode: "simple",
    microPriorMode: "bwm",
    microQueryMode: "ambiguity",
    useGeoBonus: true,
  },
];

/** ID로 variant 찾기 */
export function getVariantById(id: string): VariantConfig {
  const v = VARIANT_CONFIGS.find((c) => c.id === id);
  if (!v) throw new Error(`Unknown variant id: ${id}`);
  return v;
}
