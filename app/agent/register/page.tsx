"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, CheckCircle2, XCircle } from "lucide-react";

export default function AgentRegisterPage() {
  const router = useRouter();

  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    passwordConfirm: "",
    phone: "",
    officeAddress: "",
  });
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);

  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "ok" | "taken">("idle");
  const [geocoding, setGeocoding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === "username") setUsernameStatus("idle");
  }

  async function checkUsername() {
    if (!form.username.trim()) return;
    setUsernameStatus("checking");
    const { data } = await supabase
      .from("agent_profiles")
      .select("username")
      .eq("username", form.username.trim())
      .maybeSingle();
    setUsernameStatus(data ? "taken" : "ok");
  }

  async function geocodeAddress() {
    if (!form.officeAddress.trim()) return;
    setGeocoding(true);
    try {
      const res = await fetch("/api/agent/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: form.officeAddress }),
      });
      const data = (await res.json()) as { lat?: number; lng?: number; error?: string };
      if (!res.ok || !data.lat) {
        setError(data.error ?? "주소 변환 실패");
        return;
      }
      setLat(data.lat ?? null);
      setLng(data.lng ?? null);
      setError(null);
    } catch {
      setError("주소 변환 중 오류가 발생했습니다");
    } finally {
      setGeocoding(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.username.trim()) return setError("아이디를 입력하세요");
    if (usernameStatus === "taken") return setError("이미 사용 중인 아이디입니다");
    if (!form.email.trim()) return setError("이메일을 입력하세요");
    if (form.password.length < 6) return setError("비밀번호는 6자 이상이어야 합니다");
    if (form.password !== form.passwordConfirm) return setError("비밀번호가 일치하지 않습니다");
    if (!form.phone.trim()) return setError("전화번호를 입력하세요");
    if (!form.officeAddress.trim()) return setError("사무소 주소를 입력하세요");
    if (lat === null) return setError("사무소 주소의 좌표를 변환해 주세요");

    setSubmitting(true);
    try {
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
      });
      if (signUpError || !authData.user) {
        setError(signUpError?.message ?? "회원가입 실패");
        return;
      }

      const { error: profileError } = await supabase.from("agent_profiles").insert({
        id: authData.user.id,
        username: form.username.trim(),
        phone: form.phone.trim(),
        office_address: form.officeAddress.trim(),
        office_lat: lat,
        office_lng: lng,
      });
      if (profileError) {
        setError(profileError.message);
        return;
      }

      router.push("/agent/dashboard");
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-bold text-gray-900">중개사 회원가입</h1>
        <p className="mb-6 text-sm text-gray-500">부산대 인근 매물을 등록·관리하세요</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 아이디 */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">아이디</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
                placeholder="영문/숫자 조합"
                className="flex-1 rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
              />
              <Button type="button" variant="outline" size="sm" onClick={checkUsername}
                disabled={usernameStatus === "checking"}>
                중복확인
              </Button>
            </div>
            {usernameStatus === "ok" && (
              <p className="mt-1 flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="size-3.5" />사용 가능한 아이디입니다</p>
            )}
            {usernameStatus === "taken" && (
              <p className="mt-1 flex items-center gap-1 text-xs text-red-500"><XCircle className="size-3.5" />이미 사용 중인 아이디입니다</p>
            )}
          </div>

          {/* 이메일 */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">이메일</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="example@email.com"
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* 비밀번호 */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">비밀번호</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder="6자 이상"
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">비밀번호 확인</label>
            <input
              type="password"
              value={form.passwordConfirm}
              onChange={(e) => set("passwordConfirm", e.target.value)}
              placeholder="비밀번호 재입력"
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* 전화번호 */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">전화번호</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="010-0000-0000"
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* 사무소 주소 */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">공인중개사 사무소 주소</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.officeAddress}
                onChange={(e) => set("officeAddress", e.target.value)}
                placeholder="도로명 주소 입력"
                className="flex-1 rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
              />
              <Button type="button" variant="outline" size="sm" onClick={geocodeAddress}
                disabled={geocoding}>
                {geocoding ? <Loader2 className="size-3.5 animate-spin" /> : <MapPin className="size-3.5" />}
              </Button>
            </div>
            {lat !== null && (
              <p className="mt-1 flex items-center gap-1 text-xs text-green-600">
                <CheckCircle2 className="size-3.5" />
                좌표 변환 완료 ({lat.toFixed(5)}, {lng?.toFixed(5)})
              </p>
            )}
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <><Loader2 className="mr-2 size-4 animate-spin" />가입 중…</> : "가입하기"}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-500">
          이미 계정이 있으신가요?{" "}
          <a href="/agent/login" className="font-medium text-blue-600 hover:underline">로그인</a>
        </p>
      </div>
    </main>
  );
}
