"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

// ──────────────────────────────────────────────────────────
// 카테고리 정의
// ──────────────────────────────────────────────────────────

const CATEGORIES = [
  {
    idx: 0,
    icon: "🚶",
    label: "거리",
    desc: "캠퍼스까지 통학 거리",
    examples: "도보 5분, 경사 완만",
  },
  {
    idx: 1,
    icon: "💰",
    label: "가격",
    desc: "월세 · 보증금 · 관리비",
    examples: "저렴한 월세, 낮은 관리비",
  },
  {
    idx: 2,
    icon: "🔒",
    label: "안전",
    desc: "보안 시설 · 소음",
    examples: "CCTV, 방범창, 인터폰",
  },
  {
    idx: 3,
    icon: "✨",
    label: "편의성",
    desc: "공간 · 시설 · 년식",
    examples: "신축, 넓은 방, 엘리베이터",
  },
];

// ──────────────────────────────────────────────────────────
// 컴포넌트
// ──────────────────────────────────────────────────────────

function PreferencesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // step: 0 = 안내, 1 = 1순위 선택, 2 = 2순위 선택
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [rank1, setRank1] = useState<number | null>(null);
  const [rank2, setRank2] = useState<number | null>(null);

  const remaining = CATEGORIES.filter((c) => c.idx !== rank1);

  const handleStart = () => {
    const p = new URLSearchParams(searchParams.toString());
    if (rank1 !== null) p.set("rank1", String(rank1));
    if (rank2 !== null) p.set("rank2", String(rank2));
    router.push(`/compare?${p.toString()}`);
  };

  const handleBack = () => {
    if (step === 2) {
      setRank2(null);
      setStep(1);
    } else if (step === 1) {
      setRank1(null);
      setStep(0);
    } else {
      router.back();
    }
  };

  return (
    <main className="flex min-h-dvh flex-col px-6 py-10">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">

        {/* 헤더 */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleBack}
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600"
          >
            <ArrowLeft className="size-4" />
            뒤로
          </button>
        </div>

        <AnimatePresence mode="wait">

          {/* ── 안내 화면 ── */}
          {step === 0 && (
            <motion.div
              key="intro"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col gap-6"
            >
              <div>
                <p className="text-sm font-medium text-muted-foreground">3 / 4 단계</p>
                <h1 className="mt-1 text-xl font-bold tracking-tight">
                  AI가 선호도를 직접 학습합니다
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  먼저 중요한 항목 순서를 알려주시면 더 빠르게 학습해요
                </p>
              </div>

              <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
                {[
                  { icon: "🎯", title: "1·2순위 선택", desc: "가장 중요한 것 2가지를 선택합니다 (선택 후 변경 가능)" },
                  { icon: "🔍", title: "AI 선호도 파악", desc: "가상 매물 비교로 세부 선호를 학습합니다" },
                  { icon: "🏠", title: "실 매물 추천", desc: "맞춤 매물 순위를 제공합니다" },
                ].map((s) => (
                  <div key={s.title} className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-lg">
                      {s.icon}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{s.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <Button
                size="lg"
                className="w-full h-14 text-base font-semibold rounded-2xl gap-2"
                onClick={() => setStep(1)}
              >
                순위 선택하기
                <ArrowRight className="size-5" />
              </Button>
            </motion.div>
          )}

          {/* ── 1순위 선택 ── */}
          {step === 1 && (
            <motion.div
              key="rank1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col gap-4"
            >
              <div>
                <p className="text-sm font-medium text-muted-foreground">3 / 4 단계 · 1순위</p>
                <h1 className="mt-1 text-xl font-bold tracking-tight">
                  가장 중요한 것은 무엇인가요?
                </h1>
              </div>

              <div className="flex flex-col gap-3">
                {CATEGORIES.map((cat) => (
                  <motion.button
                    key={cat.idx}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      setRank1(cat.idx);
                      setRank2(null);
                      setStep(2);
                    }}
                    className="flex items-center gap-4 rounded-2xl border bg-card p-4 text-left hover:border-blue-300 hover:shadow-sm transition"
                  >
                    <span className="text-2xl">{cat.icon}</span>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{cat.label}</p>
                      <p className="text-xs text-muted-foreground">{cat.desc}</p>
                      <p className="mt-0.5 text-[11px] text-gray-400">{cat.examples}</p>
                    </div>
                    <ArrowRight className="size-4 text-gray-300" />
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── 2순위 선택 ── */}
          {step === 2 && rank1 !== null && (
            <motion.div
              key="rank2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col gap-4"
            >
              <div>
                <p className="text-sm font-medium text-muted-foreground">3 / 4 단계 · 2순위</p>
                <h1 className="mt-1 text-xl font-bold tracking-tight">
                  그 다음으로 중요한 것은요?
                </h1>
                <div className="mt-2 flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2">
                  <Check className="size-3.5 text-blue-500" />
                  <p className="text-xs text-blue-700">
                    1순위: <strong>{CATEGORIES[rank1].icon} {CATEGORIES[rank1].label}</strong>
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {remaining.map((cat) => (
                  <motion.button
                    key={cat.idx}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setRank2(cat.idx)}
                    className={`flex items-center gap-4 rounded-2xl border p-4 text-left transition ${
                      rank2 === cat.idx
                        ? "border-blue-400 bg-blue-50 shadow-sm"
                        : "bg-card hover:border-blue-200 hover:shadow-sm"
                    }`}
                  >
                    <span className="text-2xl">{cat.icon}</span>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{cat.label}</p>
                      <p className="text-xs text-muted-foreground">{cat.desc}</p>
                      <p className="mt-0.5 text-[11px] text-gray-400">{cat.examples}</p>
                    </div>
                    {rank2 === cat.idx
                      ? <Check className="size-4 text-blue-500" />
                      : <ArrowRight className="size-4 text-gray-300" />
                    }
                  </motion.button>
                ))}
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  size="lg"
                  className="flex-1 h-12 rounded-2xl"
                  onClick={handleStart}
                >
                  건너뛰기
                </Button>
                <Button
                  size="lg"
                  className="flex-1 h-12 rounded-2xl gap-1.5"
                  disabled={rank2 === null}
                  onClick={handleStart}
                >
                  비교 시작
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
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
