/**
 * interactive-navigator.ts
 * =========================
 * 웹 UI용 단계별(interactive) v2 계층적 추천 네비게이터
 *
 * 시뮬레이션용 runNavigatorV2와 달리 한 번에 한 비교씩 진행하며,
 * React state와 함께 사용할 수 있도록 설계됨.
 *
 * Flow:
 *   Phase 1 (macro): 가상 아이템 비교 → 선호 카테고리 결정
 *   Phase 2 (micro): 실제 매물 비교 → Top-K 추천
 *   Done: 결과 반환
 */

import type { Property } from "@/types";
import type { FeatureStats, CommuteFeatures } from "@/lib/feature-engineer";
import { toFeatureVector } from "@/lib/feature-engineer";
import { normalizeToUnitBall } from "@/lib/reward-model";
import type { CategoryVector, GroupKey } from "./feature-groups";
import {
  FEATURE_GROUPS,
  GROUP_KEYS,
  CATEGORY_NAMES,
  toCategoryVector,
  extractSubVector,
} from "./feature-groups";
import type { MacroPosterior } from "./macro-learner";
import {
  createMacroPosterior,
  createMacroPosteriorWithPrior,
  updateMacroPosterior,
  getMacroMeanWeight,
  topCategoryIdx,
  secondCategoryIdx,
  macroPosteriorConcentration,
} from "./macro-learner";
import type { VirtualItem } from "./virtual-generator";
import { generateCategoryArchetypes } from "./virtual-generator";
import { haversine } from "@/lib/geo";
import type { MicroPosterior } from "./micro-learner";
import {
  createMicroPosterior,
  getMicroMeanWeight,
  updateMicroPosterior,
  microPosteriorConcentration,
  scorePropertySub,
} from "./micro-learner";

// ──────────────────────────────────────────────────────────
// 가상 아이템 UI 메타데이터
// ──────────────────────────────────────────────────────────

interface VirtualItemMeta {
  icon: string;
  title: string;
  desc: string;
  tags: string[];
}

const VIRTUAL_META: Record<string, VirtualItemMeta> = {
  archetype_single_0: {
    icon: "🚶",
    title: "거리 우선형",
    desc: "캠퍼스까지 도보 5분 거리",
    tags: ["통학 최단", "경사 완만"],
  },
  archetype_single_1: {
    icon: "💰",
    title: "가격 우선형",
    desc: "월세·관리비 최저가",
    tags: ["저렴한 월세", "낮은 관리비", "저보증금"],
  },
  archetype_single_2: {
    icon: "🔒",
    title: "안전 우선형",
    desc: "보안 시설 완비",
    tags: ["CCTV", "방범창", "인터폰"],
  },
  archetype_single_3: {
    icon: "✨",
    title: "편의 우선형",
    desc: "시설·공간 최상급",
    tags: ["신축", "넓은 방", "주차·엘리베이터"],
  },
  archetype_pair_0_1: {
    icon: "🎯",
    title: "거리+가격형",
    desc: "저렴하고 캠퍼스 근거리",
    tags: ["저렴한 월세", "통학 편리"],
  },
  archetype_pair_0_2: {
    icon: "🛡️",
    title: "거리+안전형",
    desc: "가깝고 안전한 매물",
    tags: ["통학 편리", "보안 양호"],
  },
  archetype_pair_0_3: {
    icon: "🌟",
    title: "거리+편의형",
    desc: "가깝고 시설 좋은 매물",
    tags: ["통학 편리", "좋은 시설"],
  },
  archetype_pair_1_2: {
    icon: "🏠",
    title: "가격+안전형",
    desc: "저렴하고 안전한 매물",
    tags: ["저렴한 월세", "보안 양호"],
  },
  archetype_pair_1_3: {
    icon: "💎",
    title: "가격+편의형",
    desc: "저렴하고 시설 좋은 매물",
    tags: ["저렴한 월세", "좋은 시설"],
  },
  archetype_pair_2_3: {
    icon: "🏰",
    title: "안전+편의형",
    desc: "안전하고 쾌적한 매물",
    tags: ["보안 양호", "좋은 시설"],
  },
};

function getVirtualMeta(id: string): VirtualItemMeta {
  return (
    VIRTUAL_META[id] ?? {
      icon: "🏡",
      title: id,
      desc: "",
      tags: [],
    }
  );
}

// ──────────────────────────────────────────────────────────
// 네비게이터 스텝 타입
// ──────────────────────────────────────────────────────────

export interface MacroStep {
  type: "macro";
  round: number;
  /** 거시적 진행률 0-1 */
  macroProgress: number;
  itemA: VirtualItemMeta & { id: string; categoryVector: CategoryVector };
  itemB: VirtualItemMeta & { id: string; categoryVector: CategoryVector };
}

export interface MicroStep {
  type: "micro";
  round: number;
  /** 카테고리명 */
  categoryLabel: string;
  categoryIcon: string;
  /** 미시적 진행률 0-1 */
  microProgress: number;
  propertyA: Property;
  propertyB: Property;
}

export interface DoneStep {
  type: "done";
  categoryLabel: string;
  topPropertyIds: string[];
}

export type NavigatorStep = MacroStep | MicroStep | DoneStep;

// ──────────────────────────────────────────────────────────
// 카테고리 아이콘
// ──────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, string> = {
  거리: "🚶",
  가격: "💰",
  안전: "🔒",
  편의성: "✨",
};

// ──────────────────────────────────────────────────────────
// InteractiveNavigator 클래스
// ──────────────────────────────────────────────────────────

/** 4C2 = 6쌍 고정 순회 */
const MACRO_FIXED_PAIRS: [number, number][] = [
  [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
];
const MAX_MACRO_ROUNDS = MACRO_FIXED_PAIRS.length; // 6
const MAX_MICRO_ROUNDS = 8;
const MICRO_CONCENTRATION_THRESHOLD = 0.88;
const TOP_K = 10;
/** 캠퍼스 정문 기준 micro pool 최대 반경 (m) */
const MICRO_MAX_DIST_M = 2000;
const PNU_GATE = { lat: 35.2316, lng: 129.0840 };

/** dot product */
function dot(a: number[], b: number[]): number {
  return a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0);
}

export class InteractiveNavigator {
  // ── 공유 데이터 ──
  private readonly properties: Property[];
  private readonly stats: FeatureStats;
  private readonly commuteById: Map<string, CommuteFeatures>;
  private readonly fvCache: Map<string, number[]> = new Map();
  private readonly subVecCache: Map<string, number[]> = new Map();

  // ── Macro 상태 ──
  private macroPosterior: MacroPosterior;
  private readonly virtualPool: VirtualItem[];
  private macroRound = 0;
  private currentMacroA: VirtualItem | null = null;
  private currentMacroB: VirtualItem | null = null;
  /** 4C2 고정 쌍 인덱스 커서 */
  private macroPairCursor = 0;

  // ── Micro 상태 ──
  private microPosterior: MicroPosterior | null = null;
  private selectedGroupKey: GroupKey | null = null;
  private secondGroupKey: GroupKey | null = null;
  private microRound = 0;
  private currentMicroA: Property | null = null;
  private currentMicroB: Property | null = null;
  private usedRealPairKeys = new Set<string>();
  /** 각 매물이 비교에 등장한 횟수 */
  private propertyAppearCount = new Map<string, number>();
  /** 같은 위치(lat/lng 소수점 4자리)로 묶인 대표 매물 ID 집합 */
  private locationRepIds = new Set<string>();

  // ── 진행 단계 ──
  private phase: "macro" | "micro" | "done" = "macro";
  private topPropertyIds: string[] = [];

  /**
   * @param properties 매물 목록
   * @param stats feature 통계
   * @param commuteById 통학 commute 맵
   * @param initialRanking 사용자 사전 서열 (카테고리 인덱스 순서, 앞쪽이 더 중요)
   *   예: [1, 0] → 가격 > 거리 > (나머지 균등)
   *   제공 시 Borda count로 macro prior 초기화 → Phase 1 수렴 가속
   */
  constructor(
    properties: Property[],
    stats: FeatureStats,
    commuteById: Map<string, CommuteFeatures>,
    initialRanking?: number[],
  ) {
    this.properties = properties;
    this.stats = stats;
    this.commuteById = commuteById;

    // Feature vector 캐시 미리 계산
    for (const p of properties) {
      const fv = toFeatureVector(p, stats, commuteById.get(p.id));
      this.fvCache.set(p.id, fv);
    }

    // 사용자 서열 제공 시 Borda prior로 초기화, 아니면 uniform
    this.macroPosterior =
      initialRanking && initialRanking.length > 0
        ? createMacroPosteriorWithPrior(initialRanking)
        : createMacroPosterior();

    this.virtualPool = generateCategoryArchetypes();
    this.pickNextMacroPair();
  }

  // ──────────────────────────────────────────────────────────
  // 현재 스텝 반환
  // ──────────────────────────────────────────────────────────

  current(): NavigatorStep {
    if (this.phase === "done") {
      return {
        type: "done",
        categoryLabel: CATEGORY_NAMES[
          GROUP_KEYS.indexOf(this.selectedGroupKey ?? "convenience")
        ] ?? "편의성",
        topPropertyIds: this.topPropertyIds,
      };
    }

    if (this.phase === "macro") {
      if (!this.currentMacroA || !this.currentMacroB) {
        // 가상 아이템 풀 소진 → micro로 강제 전환
        this.startMicro();
        return this.current();
      }
      return {
        type: "macro",
        round: this.macroRound,
        macroProgress: Math.min(this.macroRound / MAX_MACRO_ROUNDS, 1),
        itemA: { id: this.currentMacroA.id, ...getVirtualMeta(this.currentMacroA.id), categoryVector: this.currentMacroA.categoryVector },
        itemB: { id: this.currentMacroB.id, ...getVirtualMeta(this.currentMacroB.id), categoryVector: this.currentMacroB.categoryVector },
      };
    }

    // micro
    if (!this.currentMicroA || !this.currentMicroB) {
      this.finishMicro();
      return this.current();
    }
    const catLabel = CATEGORY_NAMES[GROUP_KEYS.indexOf(this.selectedGroupKey ?? "convenience")] ?? "편의성";
    return {
      type: "micro",
      round: this.microRound,
      categoryLabel: catLabel,
      categoryIcon: CATEGORY_ICONS[catLabel] ?? "🏡",
      microProgress: Math.min(this.microRound / MAX_MICRO_ROUNDS, 1),
      propertyA: this.currentMicroA,
      propertyB: this.currentMicroB,
    };
  }

  // ──────────────────────────────────────────────────────────
  // 답변 처리
  // ──────────────────────────────────────────────────────────

  answer(winner: "a" | "b"): void {
    if (this.phase === "done") return;

    if (this.phase === "macro") {
      this.handleMacroAnswer(winner);
    } else {
      this.handleMicroAnswer(winner);
    }
  }

  // ──────────────────────────────────────────────────────────
  // Macro 처리
  // ──────────────────────────────────────────────────────────

  private handleMacroAnswer(winner: "a" | "b"): void {
    if (!this.currentMacroA || !this.currentMacroB) return;

    const winnerItem = winner === "a" ? this.currentMacroA : this.currentMacroB;
    const loserItem = winner === "a" ? this.currentMacroB : this.currentMacroA;

    this.macroPosterior = updateMacroPosterior(
      this.macroPosterior,
      winnerItem.categoryVector,
      loserItem.categoryVector,
    );
    this.macroRound++;
    this.macroPairCursor++;

    if (this.macroPairCursor >= MACRO_FIXED_PAIRS.length) {
      this.startMicro();
    } else {
      this.pickNextMacroPair();
    }
  }

  /** 4C2 고정 순서로 단일 아키타입 쌍을 순회 */
  private pickNextMacroPair(): void {
    const pair = MACRO_FIXED_PAIRS[this.macroPairCursor];
    if (!pair) {
      this.currentMacroA = null;
      this.currentMacroB = null;
      return;
    }
    // virtualPool의 앞 4개가 archetype_single_0~3
    const singlePool = this.virtualPool.filter((v) => v.id.startsWith("archetype_single_"));
    const vA = singlePool[pair[0]];
    const vB = singlePool[pair[1]];
    if (!vA || !vB) {
      this.currentMacroA = null;
      this.currentMacroB = null;
      return;
    }
    this.currentMacroA = vA;
    this.currentMacroB = vB;
  }

  // ──────────────────────────────────────────────────────────
  // Macro → Micro 전환
  // ──────────────────────────────────────────────────────────

  private startMicro(): void {
    this.phase = "micro";
    const top1Idx = topCategoryIdx(this.macroPosterior);
    const top2Idx = secondCategoryIdx(this.macroPosterior);
    this.selectedGroupKey = GROUP_KEYS[top1Idx];
    this.secondGroupKey = GROUP_KEYS[top2Idx];

    // 위치 중복 제거: lat/lng 소수점 4자리로 그룹핑, 각 그룹에서 1개만 비교에 사용
    const locationMap = new Map<string, Property>();
    for (const p of this.properties) {
      const key = `${p.lat.toFixed(4)}_${p.lng.toFixed(4)}`;
      if (!locationMap.has(key)) {
        locationMap.set(key, p);
      }
    }
    // 캠퍼스 정문 2km 초과 매물 제외 (원거리 매물 비교 방지)
    this.locationRepIds = new Set(
      Array.from(locationMap.values())
        .filter((p) => haversine(p.lat, p.lng, PNU_GATE.lat, PNU_GATE.lng) <= MICRO_MAX_DIST_M)
        .map((p) => p.id),
    );

    // Sub-vector 캐시 초기화 (대표 매물만)
    this.subVecCache.clear();
    for (const p of this.properties) {
      if (!this.locationRepIds.has(p.id)) continue;
      const fv = this.fvCache.get(p.id);
      if (fv) {
        this.subVecCache.set(p.id, extractSubVector(fv, this.selectedGroupKey));
      }
    }

    this.microPosterior = createMicroPosterior(this.selectedGroupKey);
    this.propertyAppearCount.clear();
    this.pickNextMicroPair();
  }

  // ──────────────────────────────────────────────────────────
  // Micro 처리
  // ──────────────────────────────────────────────────────────

  private handleMicroAnswer(winner: "a" | "b"): void {
    if (!this.currentMicroA || !this.currentMicroB || !this.microPosterior) return;

    const winnerProp = winner === "a" ? this.currentMicroA : this.currentMicroB;
    const loserProp = winner === "a" ? this.currentMicroB : this.currentMicroA;
    const winnerSub = this.subVecCache.get(winnerProp.id)!;
    const loserSub = this.subVecCache.get(loserProp.id)!;

    this.microPosterior = updateMicroPosterior(this.microPosterior, winnerSub, loserSub);
    this.microRound++;

    const converged = microPosteriorConcentration(this.microPosterior) >= MICRO_CONCENTRATION_THRESHOLD;

    if (converged || this.microRound >= MAX_MICRO_ROUNDS) {
      this.finishMicro();
    } else {
      this.pickNextMicroPair();
    }
  }

  private pickNextMicroPair(): void {
    if (!this.microPosterior || !this.selectedGroupKey) return;

    const mean = getMicroMeanWeight(this.microPosterior);

    function sigmoid(x: number): number {
      if (x > 500) return 1;
      if (x < -500) return 0;
      return 1 / (1 + Math.exp(-x));
    }

    // 대표 매물 목록(위치 중복 제거된)
    const pool = this.properties.filter((p) => this.locationRepIds.has(p.id));

    let bestPair: [Property, Property] | null = null;
    let bestScore = -Infinity;

    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const pairKey = `${pool[i].id}__${pool[j].id}`;
        if (this.usedRealPairKeys.has(pairKey)) continue;

        const sA = this.subVecCache.get(pool[i].id);
        const sB = this.subVecCache.get(pool[j].id);
        if (!sA || !sB) continue;

        const delta = sA.map((v, k) => v - sB[k]);
        const logit = 2.5 * dot(mean, delta);
        const pAB = sigmoid(logit);
        // 불확실도가 높을수록(0.5에 가까울수록) 좋음, 자주 등장한 매물 페널티
        const ambiguity = 0.5 - Math.abs(pAB - 0.5);
        const countPenalty =
          ((this.propertyAppearCount.get(pool[i].id) ?? 0) +
            (this.propertyAppearCount.get(pool[j].id) ?? 0)) *
          0.05;
        const score = ambiguity - countPenalty;

        if (score > bestScore) {
          bestScore = score;
          bestPair = [pool[i], pool[j]];
        }
      }
    }

    if (!bestPair) {
      this.finishMicro();
      return;
    }

    this.usedRealPairKeys.add(`${bestPair[0].id}__${bestPair[1].id}`);
    this.propertyAppearCount.set(
      bestPair[0].id,
      (this.propertyAppearCount.get(bestPair[0].id) ?? 0) + 1,
    );
    this.propertyAppearCount.set(
      bestPair[1].id,
      (this.propertyAppearCount.get(bestPair[1].id) ?? 0) + 1,
    );
    this.currentMicroA = bestPair[0];
    this.currentMicroB = bestPair[1];
  }

  private finishMicro(): void {
    this.phase = "done";
    if (!this.microPosterior) {
      this.topPropertyIds = this.properties.slice(0, TOP_K).map((p) => p.id);
      return;
    }

    const scored = this.properties.map((p) => ({
      id: p.id,
      score: scorePropertySub(this.microPosterior!, this.fvCache.get(p.id)!),
    }));
    scored.sort((a, b) => b.score - a.score);
    this.topPropertyIds = scored.slice(0, TOP_K).map((s) => s.id);
  }

  // ──────────────────────────────────────────────────────────
  // 공개 유틸 (React 상태 관리용)
  // ──────────────────────────────────────────────────────────

  get phase_(): "macro" | "micro" | "done" {
    return this.phase;
  }

  get macroConcentration(): number {
    return macroPosteriorConcentration(this.macroPosterior);
  }

  get macroWeights(): CategoryVector {
    return getMacroMeanWeight(this.macroPosterior);
  }

  get selectedCategory(): GroupKey | null {
    return this.selectedGroupKey;
  }
}
