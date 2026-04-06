"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

interface WeightItem {
  key: string;
  label: string;
  description: string;
  defaultValue: number;
}

const WEIGHT_ITEMS: WeightItem[] = [
  { key: "monthlyRent", label: "월세", description: "낮을수록 좋다", defaultValue: 80 },
  { key: "deposit", label: "보증금", description: "낮을수록 좋다", defaultValue: 60 },
  { key: "maintenanceFee", label: "관리비", description: "낮을수록 좋다", defaultValue: 60 },
  { key: "area", label: "크기", description: "클수록 좋다", defaultValue: 30 },
  { key: "rooms", label: "방 개수", description: "많을수록 좋다", defaultValue: 30 },
  { key: "directionSouth", label: "남향 선호", description: "높을수록 남향 선호 (낮으면 북향 선호)", defaultValue: 50 },
  { key: "parking", label: "주차", description: "있으면 좋다", defaultValue: 20 },
  { key: "cctv", label: "CCTV", description: "있으면 좋다", defaultValue: 50 },
  { key: "elevator", label: "엘리베이터", description: "있으면 좋다", defaultValue: 30 },
  { key: "year", label: "년식(신축)", description: "최신일수록 좋다", defaultValue: 50 },
  { key: "options", label: "기타옵션", description: "많을수록 좋다", defaultValue: 30 },
  { key: "noise", label: "소음", description: "낮을수록 좋다", defaultValue: 50 },
];

function PreferencesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [weights, setWeights] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const item of WEIGHT_ITEMS) {
      init[item.key] = item.defaultValue;
    }
    return init;
  });

  const handleChange = (key: string, value: number) => {
    setWeights((prev) => ({ ...prev, [key]: value }));
  };

  const handleStart = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("weights", JSON.stringify(weights));
    router.push(`/compare?${params.toString()}`);
  };

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
            초기 선호도를 설정하세요
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            각 항목의 중요도를 조절하면 더 빠르게 학습합니다
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="flex flex-col gap-5 rounded-2xl border bg-card p-5"
        >
          {WEIGHT_ITEMS.map((item) => (
            <div key={item.key}>
              <div className="mb-1.5 flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold">{item.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{item.description}</span>
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
                onValueChange={(v) => handleChange(item.key, v[0])}
              />
              <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
                <span>관심없음</span>
                <span>매우 중요</span>
              </div>
            </div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="pt-2"
        >
          <Button
            size="lg"
            className="w-full h-14 text-base font-semibold rounded-2xl gap-2"
            onClick={handleStart}
          >
            매물 비교 시작
            <ArrowRight className="size-5" />
          </Button>
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
