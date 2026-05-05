"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { supabase } from "@/lib/supabase";
import { AMENITY_TYPES } from "@/lib/amenities";

const MIN_RENT = 10;
const MAX_RENT = 100;
const MIN_DEPOSIT = 0;
const MAX_DEPOSIT = 10000;
const DEPOSIT_STEP = 500;

function FilterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const building = searchParams.get("building") ?? "";

  const [rentRange, setRentRange] = useState<[number, number]>([30, 50]);
  const [depositRange, setDepositRange] = useState<[number, number]>([MIN_DEPOSIT, MAX_DEPOSIT]);
  const [selectedAmenities, setSelectedAmenities] = useState<Set<string>>(new Set());
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const toggleAmenity = (type: string) => {
    setSelectedAmenities((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const fetchCount = useCallback(
    async (minR: number, maxR: number, minD: number, maxD: number) => {
      setLoading(true);
      try {
        let query = supabase
          .from("properties")
          .select("*", { count: "exact", head: true })
          .gte("monthly_rent", minR)
          .lte("monthly_rent", maxR);

        if (minD > 0) query = query.gte("deposit", minD);
        if (maxD < MAX_DEPOSIT) query = query.lte("deposit", maxD);

        const { count: c, error } = await query;
        if (!error) setCount(c ?? 0);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCount(rentRange[0], rentRange[1], depositRange[0], depositRange[1]);
    }, 300);
    return () => clearTimeout(timer);
  }, [rentRange, depositRange, fetchCount]);

  const handleStart = () => {
    const params = new URLSearchParams({
      building,
      minRent: String(rentRange[0]),
      maxRent: String(rentRange[1]),
      minDeposit: String(depositRange[0]),
      maxDeposit: String(depositRange[1]),
    });
    if (selectedAmenities.size > 0) {
      params.set("amenityTypes", Array.from(selectedAmenities).join(","));
    }
    router.push(`/preferences?${params.toString()}`);
  };

  return (
    <main className="flex min-h-dvh flex-col px-6 py-10">
      <div className="mx-auto flex w-full max-w-md flex-col gap-8">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <p className="text-sm font-medium text-muted-foreground">
            2 / 4 단계
          </p>
          <h1 className="mt-1 text-xl font-bold tracking-tight">
            가격 범위를 설정하세요
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            원하는 월세/보증금 범위의 매물만 비교합니다
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="flex flex-col gap-6 rounded-2xl border bg-card p-5"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">월세 범위</span>
            <span className="text-lg font-bold tabular-nums">
              {rentRange[0]}만 — {rentRange[1]}만원
            </span>
          </div>

          <Slider
            min={MIN_RENT}
            max={MAX_RENT}
            step={5}
            value={rentRange}
            onValueChange={(v) => setRentRange(v as [number, number])}
            className="py-2"
          />

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{MIN_RENT}만원</span>
            <span>{MAX_RENT}만원</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="flex flex-col gap-6 rounded-2xl border bg-card p-5"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">보증금 범위</span>
            <span className="text-lg font-bold tabular-nums">
              {depositRange[0]}만 — {depositRange[1]}만원
            </span>
          </div>

          <Slider
            min={MIN_DEPOSIT}
            max={MAX_DEPOSIT}
            step={DEPOSIT_STEP}
            value={depositRange}
            onValueChange={(v) => setDepositRange(v as [number, number])}
            className="py-2"
          />

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{MIN_DEPOSIT}만원</span>
            <span>{MAX_DEPOSIT.toLocaleString()}만원</span>
          </div>
        </motion.div>

        {/* 편의시설 복수선택 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.25 }}
          className="flex flex-col gap-3 rounded-2xl border bg-card p-5"
        >
          <div>
            <p className="text-sm font-semibold">근처 편의시설 <span className="text-xs font-normal text-muted-foreground">(복수선택 가능)</span></p>
            <p className="mt-0.5 text-xs text-muted-foreground">선택하면 매물 추천 점수와 지도에 반영됩니다</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {AMENITY_TYPES.map((a) => {
              const active = selectedAmenities.has(a.type);
              return (
                <button
                  key={a.type}
                  onClick={() => toggleAmenity(a.type)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                    active
                      ? "border-blue-400 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-600 hover:border-blue-200"
                  }`}
                >
                  <span>{a.icon}</span>
                  {a.label}
                </button>
              );
            })}
          </div>
          {selectedAmenities.size > 0 && (
            <p className="text-xs text-blue-600">
              {selectedAmenities.size}개 선택됨 · 결과에서 가장 가까운 거리를 표시합니다
            </p>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex items-center justify-center gap-2 rounded-xl bg-muted/60 px-4 py-3"
        >
          <Home className="size-4 text-muted-foreground" />
          {loading ? (
            <span className="text-sm text-muted-foreground">검색 중…</span>
          ) : count !== null ? (
            <span className="text-sm font-medium">
              해당 범위 매물:{" "}
              <span className="text-primary font-bold">{count}개</span>
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">
              매물 수를 불러오는 중…
            </span>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="pt-2"
        >
          <Button
            size="lg"
            className="w-full h-14 text-base font-semibold rounded-2xl gap-2"
            disabled={count === 0}
            onClick={handleStart}
          >
            다음: 선호도 설정
            <ArrowRight className="size-5" />
          </Button>
        </motion.div>
      </div>
    </main>
  );
}

export default function FilterPage() {
  return (
    <Suspense>
      <FilterContent />
    </Suspense>
  );
}
