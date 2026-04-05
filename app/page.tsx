"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  const router = useRouter();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-md flex-col items-center gap-10">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex flex-col items-center gap-3 text-center"
        >
          <span className="text-4xl">🏠</span>
          <h1 className="text-2xl font-bold tracking-tight">
            부산 매물 추천
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            나에게 맞는 매물을 AI가 찾아드립니다
            <br />
            간단한 비교만으로 취향을 파악해요
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="w-full"
        >
          <Button
            size="lg"
            className="w-full h-14 text-base font-semibold rounded-2xl gap-2"
            onClick={() => router.push("/select-building")}
          >
            나의 매물 경향성 파악 시작
            <ArrowRight className="size-5" />
          </Button>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="text-xs text-muted-foreground"
        >
          약 2분 소요 · 10회 비교
        </motion.p>
      </div>
    </main>
  );
}
