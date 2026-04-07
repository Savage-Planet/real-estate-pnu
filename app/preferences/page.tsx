"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

interface WeightItem {
  key: string;
  label: string;
  description: string;
  defaultValue: number;
  group: string;
  footerLeft?: string;
  footerRight?: string;
}

const GROUPS = [
  { id: "cost", label: "비용", emoji: "💰" },
  { id: "space", label: "공간", emoji: "🏠" },
  { id: "facility", label: "편의시설", emoji: "🔧" },
  { id: "environment", label: "환경", emoji: "🌿" },
  { id: "commute", label: "통학", emoji: "🚶" },
];

const WEIGHT_ITEMS: WeightItem[] = [
  { key: "monthlyRent", label: "월세", description: "낮을수록 좋다", defaultValue: 80, group: "cost" },
  { key: "deposit", label: "보증금", description: "낮을수록 좋다", defaultValue: 60, group: "cost" },
  { key: "maintenanceFee", label: "관리비", description: "낮을수록 좋다", defaultValue: 60, group: "cost" },
  { key: "area", label: "크기", description: "클수록 좋다", defaultValue: 30, group: "space" },
  { key: "rooms", label: "방 개수", description: "많을수록 좋다", defaultValue: 30, group: "space" },
  { key: "directionSouth", label: "남향 선호", description: "높을수록 남향 선호", defaultValue: 50, group: "facility" },
  { key: "parking", label: "주차", description: "있으면 좋다", defaultValue: 20, group: "facility" },
  { key: "cctv", label: "CCTV", description: "있으면 좋다", defaultValue: 50, group: "facility" },
  { key: "elevator", label: "엘리베이터", description: "있으면 좋다", defaultValue: 30, group: "facility" },
  { key: "year", label: "년식(신축)", description: "최신일수록 좋다", defaultValue: 50, group: "facility" },
  { key: "options", label: "기타옵션", description: "많을수록 좋다", defaultValue: 30, group: "facility" },
  { key: "noise", label: "소음", description: "낮을수록 좋다", defaultValue: 50, group: "environment" },
  { key: "commute", label: "통학·도보", description: "캠퍼스까지 짧을수록 좋다", defaultValue: 55, group: "commute" },
  {
    key: "busAvailable",
    label: "버스 통학",
    description: "버스 소요시간 짧을수록 좋다",
    defaultValue: 45,
    group: "commute",
    footerLeft: "안중요",
    footerRight: "중요",
  },
];

function PreferencesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<1 | 2>(1);
  const [selected, setSelected] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const item of WEIGHT_ITEMS) {
      if (item.defaultValue >= 40) s.add(item.key);
    }
    return s;
  });
  const [weights, setWeights] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const item of WEIGHT_ITEMS) init[item.key] = item.defaultValue;
    return init;
  });

  const toggleItem = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleStart = () => {
    const final: Record<string, number> = {};
    for (const item of WEIGHT_ITEMS) {
      final[item.key] = selected.has(item.key) ? weights[item.key] : 0;
    }
    const p = new URLSearchParams(searchParams.toString());
    p.set("weights", JSON.stringify(final));
    router.push(`/compare?${p.toString()}`);
  };

  const selectedItems = WEIGHT_ITEMS.filter((i) => selected.has(i.key));

  return (
    <main className="flex min-h-dvh flex-col px-6 py-10">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <p className="text-sm font-medium text-muted-foreground">3 / 4 단계</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight">
            {step === 1
              ? "중요하게 보는 요소를 선택하세요"
              : "선택한 요소의 중요도를 조절하세요"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {step === 1
              ? "관심 없는 항목은 해제하면 됩니다"
              : "슬라이더를 움직여 중요도를 설정하세요"}
          </p>
        </motion.div>

        <AnimatePresence mode="wait">
          {step === 1 ? (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
              className="flex flex-col gap-5 rounded-2xl border bg-card p-5"
            >
              {GROUPS.map((group) => {
                const items = WEIGHT_ITEMS.filter((i) => i.group === group.id);
                return (
                  <div key={group.id}>
                    <p className="mb-2 text-xs font-semibold text-gray-500">
                      {group.emoji} {group.label}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {items.map((item) => {
                        const active = selected.has(item.key);
                        return (
                          <button
                            key={item.key}
                            onClick={() => toggleItem(item.key)}
                            className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                              active
                                ? "border-blue-300 bg-blue-50 text-blue-700"
                                : "border-gray-200 bg-gray-50 text-gray-400"
                            }`}
                          >
                            {active && <Check className="size-3.5" />}
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </motion.div>
          ) : (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25 }}
            >
              <button
                onClick={() => setStep(1)}
                className="mb-3 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600"
              >
                <ArrowLeft className="size-4" />
                요소 다시 선택
              </button>
              <div className="flex flex-col gap-5 rounded-2xl border bg-card p-5">
                {selectedItems.map((item) => (
                  <div key={item.key}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <div>
                        <span className="text-sm font-semibold">{item.label}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      </div>
                      <span className="text-sm font-bold tabular-nums text-primary">
                        {weights[item.key]}
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={100}
                      step={5}
                      value={[weights[item.key]]}
                      onValueChange={(v) =>
                        setWeights((prev) => ({ ...prev, [item.key]: v[0] }))
                      }
                    />
                    <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
                      <span>{item.footerLeft ?? "관심없음"}</span>
                      <span>{item.footerRight ?? "매우 중요"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="pt-2"
        >
          {step === 1 ? (
            <Button
              size="lg"
              className="w-full h-14 text-base font-semibold rounded-2xl gap-2"
              onClick={() => setStep(2)}
              disabled={selected.size === 0}
            >
              다음: 가중치 조절 ({selected.size}개 선택)
              <ArrowRight className="size-5" />
            </Button>
          ) : (
            <Button
              size="lg"
              className="w-full h-14 text-base font-semibold rounded-2xl gap-2"
              onClick={handleStart}
            >
              매물 비교 시작
              <ArrowRight className="size-5" />
            </Button>
          )}
        </motion.div>
      </div>
    </main>
  );
}

export default function PreferencesPage() {
  return (
    <Suspense>
      <PreferencesContent />
    </Suspense>
  );
}
