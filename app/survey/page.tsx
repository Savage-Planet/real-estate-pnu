"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ChevronLeft, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

// ──────────────────────────────────────────────────────────
// 유틸 컴포넌트
// ──────────────────────────────────────────────────────────

function RadioGroup({
  question,
  qNum,
  options,
  value,
  onChange,
}: {
  question: string;
  qNum: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-gray-800">
        <span className="mr-1.5 font-bold text-blue-600">{qNum}</span>
        {question}
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-all ${
              value === opt
                ? "border-blue-500 bg-blue-500 text-white shadow"
                : "border-gray-200 bg-white text-gray-600 hover:border-blue-300"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function LikertScale({
  question,
  qNum,
  value,
  onChange,
  note,
}: {
  question: string;
  qNum: string;
  value: number;
  onChange: (v: number) => void;
  note?: string;
}) {
  const COLORS = ["#94a3b8", "#60a5fa", "#34d399", "#f97316", "#ef4444"];
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-gray-800">
        <span className="mr-1.5 font-bold text-blue-600">{qNum}</span>
        {question}
      </p>
      {note && <p className="text-[11px] text-gray-400">{note}</p>}
      <div className="flex items-end gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`flex flex-1 flex-col items-center gap-1 rounded-xl border-2 py-2.5 text-sm font-bold transition-all ${
              value === n
                ? "border-blue-500 bg-blue-500 text-white shadow-md"
                : "border-gray-100 bg-gray-50 text-gray-500 hover:border-blue-200 hover:bg-blue-50"
            }`}
          >
            <span
              className="size-2.5 rounded-full"
              style={{ background: value === n ? "white" : COLORS[n - 1] }}
            />
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>전혀 동의 안 함</span>
        <span>매우 동의</span>
      </div>
    </div>
  );
}

function CheckboxGroup({
  question,
  qNum,
  options,
  values,
  onChange,
}: {
  question: string;
  qNum: string;
  options: string[];
  values: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(opt: string) {
    if (values.includes(opt)) {
      onChange(values.filter((v) => v !== opt));
    } else {
      onChange([...values, opt]);
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-gray-800">
        <span className="mr-1.5 font-bold text-blue-600">{qNum}</span>
        {question}
        <span className="ml-1 text-xs font-normal text-gray-400">(복수 선택 가능)</span>
      </p>
      <div className="space-y-2">
        {options.map((opt) => {
          const checked = values.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              className={`flex w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left text-sm transition-all ${
                checked
                  ? "border-blue-500 bg-blue-50 text-blue-800"
                  : "border-gray-200 bg-white text-gray-600 hover:border-blue-200"
              }`}
            >
              <span
                className={`size-4 shrink-0 rounded border-2 ${
                  checked ? "border-blue-500 bg-blue-500" : "border-gray-300"
                }`}
              >
                {checked && (
                  <svg viewBox="0 0 12 12" className="fill-white">
                    <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                  </svg>
                )}
              </span>
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// 설문 데이터 타입
// ──────────────────────────────────────────────────────────

interface SurveyData {
  // Step 1
  gender: string;
  age_group: string;
  housing_type: string;
  floor_level: string;
  // Step 2
  safety_importance: number;
  had_crime_anxiety: string; // "예" | "아니오" | ""
  anxiety_reasons: string[];
  // Step 3
  age_bug_belief: number;
  restaurant_bug_belief: number;
  streetlight_safety: number;
  cctv_usefulness: number;
  noise_usefulness: number;
  // Step 4
  accuracy_rating: number;
  personalization_rating: number;
  novelty_rating: number;
}

const INITIAL: SurveyData = {
  gender: "",
  age_group: "",
  housing_type: "",
  floor_level: "",
  safety_importance: 0,
  had_crime_anxiety: "",
  anxiety_reasons: [],
  age_bug_belief: 0,
  restaurant_bug_belief: 0,
  streetlight_safety: 0,
  cctv_usefulness: 0,
  noise_usefulness: 0,
  accuracy_rating: 0,
  personalization_rating: 0,
  novelty_rating: 0,
};

const ANXIETY_OPTIONS = [
  "골목길이 어두워서",
  "방범창 등 보안시설 부족",
  "주변 CCTV 부족",
  "외부인 출입이 쉬워서",
  "기타",
];

const STEP_TITLES = [
  "기본 정보",
  "안전 인식",
  "변수 타당성",
  "시스템 평가",
];

// 각 스텝에서 필수 입력 여부 확인
function isStepComplete(data: SurveyData, step: number): boolean {
  if (step === 0) {
    return !!(data.gender && data.age_group && data.housing_type && data.floor_level);
  }
  if (step === 1) {
    if (!data.safety_importance || !data.had_crime_anxiety) return false;
    if (data.had_crime_anxiety === "예" && data.anxiety_reasons.length === 0) return false;
    return true;
  }
  if (step === 2) {
    return !!(
      data.age_bug_belief &&
      data.restaurant_bug_belief &&
      data.streetlight_safety &&
      data.cctv_usefulness &&
      data.noise_usefulness
    );
  }
  if (step === 3) {
    return !!(data.accuracy_rating && data.personalization_rating && data.novelty_rating);
  }
  return true;
}

// ──────────────────────────────────────────────────────────
// 설문 본체
// ──────────────────────────────────────────────────────────

function SurveyContent() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session") ?? "";
  const isDone = params.get("done") === "1";

  const [step, setStep] = useState(0);
  const [data, setData] = useState<SurveyData>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof SurveyData>(key: K, value: SurveyData[K]) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        session_id: sessionId || null,
        gender: data.gender || null,
        age_group: data.age_group || null,
        housing_type: data.housing_type || null,
        floor_level: data.floor_level || null,
        safety_importance: data.safety_importance || null,
        had_crime_anxiety: data.had_crime_anxiety === "예" ? true : data.had_crime_anxiety === "아니오" ? false : null,
        anxiety_reasons: data.anxiety_reasons.length > 0 ? data.anxiety_reasons : null,
        age_bug_belief: data.age_bug_belief || null,
        restaurant_bug_belief: data.restaurant_bug_belief || null,
        streetlight_safety: data.streetlight_safety || null,
        cctv_usefulness: data.cctv_usefulness || null,
        noise_usefulness: data.noise_usefulness || null,
        accuracy_rating: data.accuracy_rating || null,
        personalization_rating: data.personalization_rating || null,
        novelty_rating: data.novelty_rating || null,
      };
      const { error: err } = await supabase.from("survey_responses").insert(payload);
      if (err) throw err;
      router.push("/survey?done=1");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 중 오류가 발생했습니다");
    } finally {
      setSubmitting(false);
    }
  }

  // 완료 화면
  if (isDone) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-gradient-to-b from-blue-50 to-white px-6 py-12 text-center">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          <CheckCircle2 className="mx-auto size-16 text-green-500" />
        </motion.div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-gray-900">설문 완료!</h1>
          <p className="text-sm text-gray-500">
            소중한 응답 감사합니다.
            <br />
            본 설문은 부산대 인근 주거 추천 시스템 연구에 활용됩니다.
          </p>
        </div>
        <Button onClick={() => router.push("/")} className="mt-2 px-8">
          처음으로 돌아가기
        </Button>
      </main>
    );
  }

  const canNext = isStepComplete(data, step);

  return (
    <main className="min-h-dvh bg-gradient-to-b from-blue-50 to-white">
      {/* 헤더 */}
      <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/95 px-4 pt-safe-top backdrop-blur-sm">
        <div className="mx-auto max-w-lg pb-3 pt-4">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500">
              {step + 1} / 4 — {STEP_TITLES[step]}
            </p>
            <p className="text-xs text-gray-400">부산대 주거 만족도 설문</p>
          </div>
          {/* 프로그레스바 */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <motion.div
              className="h-full rounded-full bg-blue-500"
              initial={false}
              animate={{ width: `${((step + 1) / 4) * 100}%` }}
              transition={{ duration: 0.35 }}
            />
          </div>
        </div>
      </div>

      {/* 폼 */}
      <div className="mx-auto max-w-lg px-4 pb-32 pt-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.22 }}
            className="space-y-6"
          >

            {/* ── Step 1: 인구통계 ── */}
            {step === 0 && (
              <>
                <div className="rounded-2xl bg-white p-5 shadow-sm">
                  <h2 className="mb-4 text-base font-bold text-gray-800">기본 정보</h2>
                  <div className="space-y-5">
                    <RadioGroup
                      qNum="Q1."
                      question="귀하의 성별은 무엇입니까?"
                      options={["남성", "여성"]}
                      value={data.gender}
                      onChange={(v) => set("gender", v)}
                    />
                    <RadioGroup
                      qNum="Q2."
                      question="귀하의 연령대는 어떻게 되십니까?"
                      options={["10대", "20대", "30대", "40대 이상"]}
                      value={data.age_group}
                      onChange={(v) => set("age_group", v)}
                    />
                    <RadioGroup
                      qNum="Q3."
                      question="현재 거주 형태는 무엇입니까?"
                      options={["원룸·투룸", "오피스텔", "아파트", "기숙사", "기타"]}
                      value={data.housing_type}
                      onChange={(v) => set("housing_type", v)}
                    />
                    <RadioGroup
                      qNum="Q4."
                      question="현재 거주 층수는 어떻게 되십니까?"
                      options={["반지하", "1층", "2~3층", "4층 이상"]}
                      value={data.floor_level}
                      onChange={(v) => set("floor_level", v)}
                    />
                  </div>
                </div>
              </>
            )}

            {/* ── Step 2: 안전 인식 ── */}
            {step === 1 && (
              <>
                <div className="rounded-2xl bg-white p-5 shadow-sm">
                  <h2 className="mb-4 text-base font-bold text-gray-800">안전 인식</h2>
                  <div className="space-y-6">
                    <LikertScale
                      qNum="Q5."
                      question="집을 구할 때 '방범 및 안전(치안)' 요소를 얼마나 중요하게 고려하십니까?"
                      value={data.safety_importance}
                      onChange={(v) => set("safety_importance", v)}
                      note="1점(전혀 고려 안 함) ~ 5점(매우 중요)"
                    />
                    <RadioGroup
                      qNum="Q6."
                      question="현재 또는 과거 거주지에서 범죄에 대한 불안감을 느낀 적이 있습니까?"
                      options={["예", "아니오"]}
                      value={data.had_crime_anxiety}
                      onChange={(v) => {
                        set("had_crime_anxiety", v);
                        if (v === "아니오") set("anxiety_reasons", []);
                      }}
                    />
                    <AnimatePresence>
                      {data.had_crime_anxiety === "예" && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="rounded-xl bg-blue-50 p-4">
                            <CheckboxGroup
                              qNum="Q6-1."
                              question="불안감을 느낀 가장 큰 이유는 무엇입니까?"
                              options={ANXIETY_OPTIONS}
                              values={data.anxiety_reasons}
                              onChange={(v) => set("anxiety_reasons", v)}
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </>
            )}

            {/* ── Step 3: 변수 타당성 ── */}
            {step === 2 && (
              <>
                <div className="rounded-2xl bg-white p-5 shadow-sm">
                  <h2 className="mb-1 text-base font-bold text-gray-800">변수 타당성 인식</h2>
                  <p className="mb-4 text-xs text-gray-400">
                    각 항목에 대해 얼마나 동의하시는지 선택해 주세요 (1=전혀 동의 안 함 / 5=매우 동의)
                  </p>
                  <div className="space-y-6">
                    <LikertScale
                      qNum="Q7."
                      question="건물 준공 연도(년식)가 오래될수록 벌레 발생 가능성이 높다"
                      value={data.age_bug_belief}
                      onChange={(v) => set("age_bug_belief", v)}
                    />
                    <LikertScale
                      qNum="Q8."
                      question="주변 100m 이내에 음식점이 많을수록 벌레 발생 가능성이 높다"
                      value={data.restaurant_bug_belief}
                      onChange={(v) => set("restaurant_bug_belief", v)}
                    />
                    <LikertScale
                      qNum="Q9."
                      question="경로 반경 내 가로등 개수가 많을수록 야간 보행이 안전하다"
                      value={data.streetlight_safety}
                      onChange={(v) => set("streetlight_safety", v)}
                    />
                    <LikertScale
                      qNum="Q10."
                      question="방에서 학교까지 경로 상 CCTV 수를 알 수 있다면 방 선택에 도움이 되겠습니까?"
                      value={data.cctv_usefulness}
                      onChange={(v) => set("cctv_usefulness", v)}
                      note="1점(전혀 도움 안 됨) ~ 5점(매우 도움)"
                    />
                    <LikertScale
                      qNum="Q11."
                      question="방에서 학교까지의 소음 수준(dB) 정보를 알 수 있다면 방 선택에 도움이 되겠습니까?"
                      value={data.noise_usefulness}
                      onChange={(v) => set("noise_usefulness", v)}
                      note="1점(전혀 도움 안 됨) ~ 5점(매우 도움)"
                    />
                  </div>
                </div>
              </>
            )}

            {/* ── Step 4: 시스템 평가 ── */}
            {step === 3 && (
              <>
                <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
                  <p className="font-semibold">방금 경험하신 추천 시스템에 대해 평가해 주세요.</p>
                  <p className="mt-1 text-xs text-amber-700">
                    실제 비교 화면 및 결과를 경험한 후 답변해 주세요.
                  </p>
                </div>
                <div className="rounded-2xl bg-white p-5 shadow-sm">
                  <h2 className="mb-1 text-base font-bold text-gray-800">시스템 평가</h2>
                  <p className="mb-4 text-xs text-gray-400">
                    1점(전혀 동의 안 함) ~ 5점(매우 동의)
                  </p>
                  <div className="space-y-6">
                    <LikertScale
                      qNum="Q12."
                      question="추천된 방이 나의 조건에 적합하다고 느꼈다"
                      value={data.accuracy_rating}
                      onChange={(v) => set("accuracy_rating", v)}
                      note="[추천 정확성 — Accuracy]"
                    />
                    <LikertScale
                      qNum="Q13."
                      question="추천 이유 설명이 나의 상황과 연결된 것 같다"
                      value={data.personalization_rating}
                      onChange={(v) => set("personalization_rating", v)}
                      note="예: '통학 거리를 중요하게 생각하셨고, 이 방은 학교까지 7분으로 상위 10%입니다'"
                    />
                    <LikertScale
                      qNum="Q14."
                      question="시스템이 내가 미처 몰랐던 나의 선호를 발견하게 해줬다"
                      value={data.novelty_rating}
                      onChange={(v) => set("novelty_rating", v)}
                      note="[새로움 — Novelty] 예: '처음엔 가격을 중요하게 생각하셨지만, 실제로는 소음이 낮은 방을 반복 선택하셨습니다'"
                    />
                  </div>
                </div>
              </>
            )}

          </motion.div>
        </AnimatePresence>

        {error && (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
        )}
      </div>

      {/* 하단 고정 버튼 */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-100 bg-white/95 px-4 pb-safe-bottom pt-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-lg gap-3 pb-4">
          {step > 0 && (
            <Button
              variant="outline"
              className="flex-none gap-1.5"
              onClick={() => setStep((s) => s - 1)}
            >
              <ChevronLeft className="size-4" />
              이전
            </Button>
          )}
          {step < 3 ? (
            <Button
              className="flex-1 gap-1.5"
              disabled={!canNext}
              onClick={() => setStep((s) => s + 1)}
            >
              다음
              <ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button
              className="flex-1 gap-1.5 bg-green-600 hover:bg-green-700"
              disabled={!canNext || submitting}
              onClick={handleSubmit}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  저장 중…
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-4" />
                  설문 제출하기
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}

// ──────────────────────────────────────────────────────────
// 페이지 래퍼 (Suspense for useSearchParams)
// ──────────────────────────────────────────────────────────

export default function SurveyPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-8 animate-spin text-blue-400" />
      </main>
    }>
      <SurveyContent />
    </Suspense>
  );
}
