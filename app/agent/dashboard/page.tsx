"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
  Plus, LogOut, Loader2, MapPin, Eye, EyeOff, Trash2,
  CheckCircle2, Clock, Bus, Camera, X,
} from "lucide-react";

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface AgentProperty {
  id: string;
  address: string;
  lat: number;
  lng: number;
  trade_type: string;
  rooms: number;
  monthly_rent: number;
  deposit: number;
  exclusive_area: number;
  is_active: boolean;
  walk_to_gate_min: number | null;
  bus_to_gate_min: number | null;
  noise_level: number | null;
  photo_urls: string[];
  created_at: string;
}

interface FormState {
  address: string;
  lat: string;
  lng: string;
  trade_type: "월세" | "전세";
  property_type: string;
  rooms: string;
  parking: string;
  direction: string;
  monthly_rent: string;
  deposit: string;
  exclusive_area: string;
  maintenance_fee: string;
  has_elevator: boolean;
  has_closet: boolean;
  has_builtin_closet: boolean;
  has_entrance_security: boolean;
  built_year: string;
}

const DEFAULT_FORM: FormState = {
  address: "", lat: "", lng: "",
  trade_type: "월세", property_type: "원룸",
  rooms: "1", parking: "0",
  direction: "",
  monthly_rent: "0", deposit: "0",
  exclusive_area: "0", maintenance_fee: "0",
  has_elevator: false, has_closet: false,
  has_builtin_closet: false, has_entrance_security: false,
  built_year: "10",
};

const DIRECTIONS = ["남향", "북향", "동향", "서향", "남동향", "남서향", "북동향", "북서향"];

// ── 컴포넌트 ──────────────────────────────────────────────────────────────────

export default function AgentDashboardPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [properties, setProperties] = useState<AgentProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [geocoding, setGeocoding] = useState(false);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreview, setPhotoPreview] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 세션 확인
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/agent/login"); return; }
      setToken(session.access_token);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) router.push("/agent/login");
      else setToken(session.access_token);
    });
    return () => subscription.unsubscribe();
  }, [router]);

  // 프로필 + 매물 로드
  const loadData = useCallback(async (tok: string) => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("agent_profiles").select("username").eq("id", user.id).single();
      if (profile) setUsername((profile as { username: string }).username);
    }
    const res = await fetch("/api/agent/property", {
      headers: { Authorization: `Bearer ${tok}` },
    });
    const data = await res.json() as { properties?: AgentProperty[] };
    setProperties(data.properties ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (token) void loadData(token);
  }, [token, loadData]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/agent/login");
  }

  function setField<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((p) => ({ ...p, [key]: val }));
  }

  async function geocodeAddress() {
    if (!form.address.trim()) return;
    setGeocoding(true);
    const res = await fetch("/api/agent/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: form.address }),
    });
    const data = await res.json() as { lat?: number; lng?: number; error?: string };
    setGeocoding(false);
    if (data.lat) {
      setField("lat", String(data.lat));
      setField("lng", String(data.lng));
    } else {
      setFormError(data.error ?? "좌표 변환 실패");
    }
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPhotoFiles((prev) => [...prev, ...files].slice(0, 5));
    const previews = files.map((f) => URL.createObjectURL(f));
    setPhotoPreview((prev) => [...prev, ...previews].slice(0, 5));
  }

  function removePhoto(i: number) {
    setPhotoFiles((prev) => prev.filter((_, idx) => idx !== i));
    setPhotoPreview((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function uploadPhotos(propertyId: string): Promise<string[]> {
    const urls: string[] = [];
    for (const file of photoFiles) {
      const path = `${propertyId}/${Date.now()}_${file.name}`;
      const { data, error } = await supabase.storage
        .from("property-photos")
        .upload(path, file, { upsert: false });
      if (error) continue;
      const { data: pub } = supabase.storage.from("property-photos").getPublicUrl(data.path);
      urls.push(pub.publicUrl);
    }
    return urls;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.address) return setFormError("주소를 입력하세요");
    if (!form.lat || !form.lng) return setFormError("주소의 좌표를 변환해 주세요");
    if (!token) return;

    setSubmitting(true);
    try {
      // 매물 먼저 등록 (사진 URL 없이)
      const res = await fetch("/api/agent/property", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...form, lat: Number(form.lat), lng: Number(form.lng), photo_urls: [] }),
      });
      const data = await res.json() as { ok?: boolean; id?: string; error?: string };
      if (!res.ok || !data.id) { setFormError(data.error ?? "등록 실패"); return; }

      // 사진 업로드 후 URL 업데이트
      if (photoFiles.length > 0) {
        const urls = await uploadPhotos(data.id);
        await supabase.from("agent_properties").update({ photo_urls: urls }).eq("id", data.id);
      }

      setShowForm(false);
      setForm(DEFAULT_FORM);
      setPhotoFiles([]);
      setPhotoPreview([]);
      await loadData(token);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(id: string, current: boolean) {
    if (!token) return;
    await fetch(`/api/agent/property/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ is_active: !current }),
    });
    setProperties((prev) => prev.map((p) => p.id === id ? { ...p, is_active: !current } : p));
  }

  async function deleteProperty(id: string) {
    if (!token || !confirm("매물을 삭제하시겠습니까?")) return;
    await fetch(`/api/agent/property/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setProperties((prev) => prev.filter((p) => p.id !== id));
  }

  if (loading) return (
    <main className="flex min-h-dvh items-center justify-center">
      <Loader2 className="size-6 animate-spin text-gray-400" />
    </main>
  );

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-8">
      {/* 헤더 */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">매물 관리 대시보드</h1>
          {username && <p className="text-sm text-gray-500">{username} 님</p>}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowForm(true)} className="gap-2">
            <Plus className="size-4" />매물 추가
          </Button>
          <Button variant="outline" onClick={handleLogout} className="gap-2">
            <LogOut className="size-4" />로그아웃
          </Button>
        </div>
      </div>

      {/* 매물 목록 */}
      {properties.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed py-16 text-gray-400">
          <Plus className="size-8" />
          <p className="text-sm">등록된 매물이 없습니다</p>
        </div>
      ) : (
        <div className="space-y-3">
          {properties.map((p) => (
            <div key={p.id}
              className={`rounded-2xl border p-4 ${p.is_active ? "bg-white" : "bg-gray-50 opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-gray-900">{p.address}</p>
                  <p className="text-sm text-gray-500">
                    {p.trade_type} · 방{p.rooms}개 · {p.exclusive_area}㎡
                    {p.trade_type === "월세"
                      ? ` · 월 ${p.monthly_rent.toLocaleString()}만`
                      : ` · 전세 ${p.deposit.toLocaleString()}만`}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-gray-400">
                    {p.walk_to_gate_min != null && (
                      <span className="flex items-center gap-0.5"><Clock className="size-3" />{Math.round(p.walk_to_gate_min)}분</span>
                    )}
                    {p.bus_to_gate_min != null && (
                      <span className="flex items-center gap-0.5"><Bus className="size-3" />{Math.round(p.bus_to_gate_min)}분</span>
                    )}
                    {p.noise_level != null && (
                      <span>소음 {p.noise_level.toFixed(0)}</span>
                    )}
                    {p.photo_urls.length > 0 && (
                      <span className="flex items-center gap-0.5"><Camera className="size-3" />{p.photo_urls.length}장</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => toggleActive(p.id, p.is_active)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                    title={p.is_active ? "비활성화" : "활성화"}>
                    {p.is_active ? <Eye className="size-4 text-green-600" /> : <EyeOff className="size-4" />}
                  </button>
                  <button onClick={() => deleteProperty(p.id)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 매물 등록 모달 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() => setShowForm(false)}>
          <div className="w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl"
            style={{ maxHeight: "90vh" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">매물 등록</h2>
              <button onClick={() => setShowForm(false)}>
                <X className="size-5 text-gray-400" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 주소 */}
              <Section title="위치">
                <div className="flex gap-2">
                  <input value={form.address} onChange={(e) => setField("address", e.target.value)}
                    placeholder="도로명 주소 입력" className={inputCls} />
                  <Button type="button" variant="outline" size="sm" onClick={geocodeAddress} disabled={geocoding}>
                    {geocoding ? <Loader2 className="size-3.5 animate-spin" /> : <MapPin className="size-3.5" />}
                  </Button>
                </div>
                <div className="flex gap-2">
                  <input value={form.lat} onChange={(e) => setField("lat", e.target.value)}
                    placeholder="위도 (자동)" className={inputCls} />
                  <input value={form.lng} onChange={(e) => setField("lng", e.target.value)}
                    placeholder="경도 (자동)" className={inputCls} />
                </div>
                {form.lat && <p className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="size-3" />좌표 변환 완료</p>}
              </Section>

              {/* 거래 유형 */}
              <Section title="거래 유형">
                <div className="flex gap-2">
                  {(["월세", "전세"] as const).map((t) => (
                    <button key={t} type="button"
                      onClick={() => setField("trade_type", t)}
                      className={`flex-1 rounded-xl border py-2 text-sm font-medium transition ${form.trade_type === t ? "border-blue-500 bg-blue-50 text-blue-700" : "text-gray-600"}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </Section>

              {/* 가격 */}
              <Section title="가격">
                {form.trade_type === "월세" && (
                  <LabeledInput label="월세 (만원)" value={form.monthly_rent}
                    onChange={(v) => setField("monthly_rent", v)} type="number" />
                )}
                <LabeledInput label="보증금 (만원)" value={form.deposit}
                  onChange={(v) => setField("deposit", v)} type="number" />
                <LabeledInput label="관리비 (원)" value={form.maintenance_fee}
                  onChange={(v) => setField("maintenance_fee", v)} type="number" />
              </Section>

              {/* 매물 정보 */}
              <Section title="매물 정보">
                <LabeledInput label="실전용면적 (㎡)" value={form.exclusive_area}
                  onChange={(v) => setField("exclusive_area", v)} type="number" />
                <LabeledInput label="방 개수" value={form.rooms}
                  onChange={(v) => setField("rooms", v)} type="number" />
                <LabeledInput label="건물 년식 (현재부터 몇 년)" value={form.built_year}
                  onChange={(v) => setField("built_year", v)} type="number"
                  placeholder="예: 5 → 5년 이하" />
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-600">방향</p>
                  <div className="flex flex-wrap gap-1.5">
                    {DIRECTIONS.map((d) => (
                      <button key={d} type="button"
                        onClick={() => setField("direction", d)}
                        className={`rounded-lg border px-2.5 py-1 text-xs transition ${form.direction === d ? "border-blue-500 bg-blue-50 text-blue-700" : "text-gray-600"}`}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium text-gray-600">주차</p>
                  {[["없음", "0"], ["가능", "1"]].map(([lbl, val]) => (
                    <button key={val} type="button"
                      onClick={() => setField("parking", val)}
                      className={`rounded-lg border px-3 py-1 text-xs transition ${form.parking === val ? "border-blue-500 bg-blue-50 text-blue-700" : "text-gray-600"}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-600">매물 유형</p>
                  <div className="flex flex-wrap gap-1.5">
                    {["원룸", "투룸", "오피스텔", "아파트", "고시원"].map((t) => (
                      <button key={t} type="button"
                        onClick={() => setField("property_type", t)}
                        className={`rounded-lg border px-2.5 py-1 text-xs transition ${form.property_type === t ? "border-blue-500 bg-blue-50 text-blue-700" : "text-gray-600"}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </Section>

              {/* 옵션 */}
              <Section title="옵션">
                {([
                  ["has_elevator", "엘리베이터"],
                  ["has_closet", "수납공간"],
                  ["has_builtin_closet", "붙박이장"],
                  ["has_entrance_security", "현관보안"],
                ] as [keyof FormState, string][]).map(([key, label]) => (
                  <label key={key} className="flex cursor-pointer items-center gap-2">
                    <input type="checkbox"
                      checked={Boolean(form[key])}
                      onChange={(e) => setField(key, e.target.checked as FormState[typeof key])}
                      className="size-4 rounded" />
                    <span className="text-sm text-gray-700">{label}</span>
                  </label>
                ))}
              </Section>

              {/* 사진 */}
              <Section title="사진 (최대 5장)">
                <div className="flex flex-wrap gap-2">
                  {photoPreview.map((src, i) => (
                    <div key={i} className="relative size-20 overflow-hidden rounded-xl">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="size-full object-cover" />
                      <button type="button" onClick={() => removePhoto(i)}
                        className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5">
                        <X className="size-3 text-white" />
                      </button>
                    </div>
                  ))}
                  {photoPreview.length < 5 && (
                    <label className="flex size-20 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-gray-400 hover:bg-gray-50">
                      <Camera className="size-5" />
                      <span className="mt-1 text-[10px]">추가</span>
                      <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoChange} />
                    </label>
                  )}
                </div>
              </Section>

              {formError && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <><Loader2 className="mr-2 size-4 animate-spin" />등록 중…</> : "매물 등록"}
              </Button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function LabeledInput({ label, value, onChange, type = "text", placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-0.5 block text-xs font-medium text-gray-600">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputCls} />
    </div>
  );
}

const inputCls = "w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400";
