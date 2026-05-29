"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  GraduationCap, Building2, LogIn, UserPlus, ShieldCheck, ChevronRight,
} from "lucide-react";

const LINKS = [
  { href: "/", title: "매물 추천 학습 시작", desc: "AI 비교로 나에게 맞는 매물 찾기", icon: GraduationCap, accent: "blue" },
  { href: "/agent/register", title: "중개사 회원가입", desc: "부동산 중개사 계정 만들기", icon: UserPlus, accent: "emerald" },
  { href: "/agent/login", title: "중개사 로그인", desc: "매물 등록·관리 대시보드", icon: LogIn, accent: "emerald" },
  { href: "/agent/dashboard", title: "매물 관리 대시보드", desc: "내 매물 등록/활성화", icon: Building2, accent: "emerald" },
  { href: "/admin", title: "중앙 관제 센터", desc: "매물 승인·통계·세션 로그 (관리자)", icon: ShieldCheck, accent: "violet" },
] as const;

const ACCENTS: Record<string, string> = {
  blue: "text-blue-600 bg-blue-50",
  emerald: "text-emerald-600 bg-emerald-50",
  violet: "text-violet-600 bg-violet-50",
};

export default function HubPage() {
  const router = useRouter();
  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 py-10">
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 text-center"
      >
        <span className="text-3xl">🏠</span>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">부산대 매물 추천 시스템</h1>
        <p className="mt-1 text-sm text-gray-500">전체 페이지 모음</p>
      </motion.div>

      <div className="flex flex-col gap-3">
        {LINKS.map((l, i) => {
          const Icon = l.icon;
          return (
            <motion.button
              key={l.href}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              onClick={() => router.push(l.href)}
              className="flex items-center gap-3 rounded-2xl border bg-white p-4 text-left transition hover:border-blue-300 hover:shadow-sm"
            >
              <div className={`inline-flex rounded-xl p-2.5 ${ACCENTS[l.accent]}`}>
                <Icon className="size-5" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900">{l.title}</p>
                <p className="text-xs text-gray-500">{l.desc}</p>
              </div>
              <ChevronRight className="size-5 text-gray-300" />
            </motion.button>
          );
        })}
      </div>
    </main>
  );
}
