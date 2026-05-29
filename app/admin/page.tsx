"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Loader2, ShieldCheck, Check, X, RefreshCw, Building2, Users,
  Eye, ThumbsUp, Phone, ClipboardList, ExternalLink, LayoutGrid,
} from "lucide-react";

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface Stats {
  totalProperties: number;
  approvedProperties: number;
  pendingProperties: number;
  totalAgents: number;
  totalSessions: number;
  completedSessions: number;
  totalViews: number;
  likedYes: number;
  phoneRequested: number;
}

interface AdminProperty {
  id: string;
  address: string;
  trade_type: string;
  monthly_rent: number;
  deposit: number;
  rooms: number;
  exclusive_area: number;
  approved: boolean;
  is_active: boolean;
  created_at: string;
  photo_urls: string[];
  agent_profiles?: { username: string; phone: string; office_address: string } | null;
  _views: number;
  _liked: number;
  _phone: number;
}

interface SessionLog {
  session_id: string;
  status: string;
  phase: string | null;
  last_round: number;
  did_extra: boolean;
  selected_category: string | null;
  started_at: string;
  completed_at: string | null;
  viewed: number;
  likedYes: number;
  likedNo: number;
  phoneYes: number;
  phoneNo: number;
}

type Tab = "overview" | "properties" | "sessions" | "links";

const SECRET_KEY = "admin_secret";

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  const [stats, setStats] = useState<Stats | null>(null);
  const [properties, setProperties] = useState<AdminProperty[]>([]);
  const [sessions, setSessions] = useState<SessionLog[]>([]);
  const [loading, setLoading] = useState(false);

  // 저장된 시크릿 복원
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.sessionStorage.getItem(SECRET_KEY) : null;
    if (saved) {
      setSecret(saved);
      void verify(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const api = useCallback(async (path: string, opts: RequestInit = {}, sec?: string) => {
    return fetch(path, {
      ...opts,
      headers: { ...(opts.headers ?? {}), "x-admin-secret": sec ?? secret, "Content-Type": "application/json" },
    });
  }, [secret]);

  async function verify(sec: string) {
    setAuthError(null);
    const res = await api("/api/admin/stats", {}, sec);
    if (res.ok) {
      setAuthed(true);
      window.sessionStorage.setItem(SECRET_KEY, sec);
      const data = await res.json();
      setStats(data);
      void loadAll(sec);
    } else {
      setAuthError("관리자 비밀번호가 올바르지 않습니다");
      setAuthed(false);
    }
  }

  const loadAll = useCallback(async (sec?: string) => {
    setLoading(true);
    try {
      const [s, p, ses] = await Promise.all([
        api("/api/admin/stats", {}, sec).then((r) => r.json()),
        api("/api/admin/properties", {}, sec).then((r) => r.json()),
        api("/api/admin/sessions", {}, sec).then((r) => r.json()),
      ]);
      setStats(s);
      setProperties(p.properties ?? []);
      setSessions(ses.sessions ?? []);
    } finally {
      setLoading(false);
    }
  }, [api]);

  async function toggleApprove(id: string, approved: boolean) {
    await api(`/api/admin/properties/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ approved }),
    });
    setProperties((prev) => prev.map((p) => p.id === id ? { ...p, approved } : p));
    void loadAll();
  }

  // ── 로그인 게이트 ──
  if (!authed) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="size-6 text-blue-600" />
            <h1 className="text-xl font-bold">중앙 관제 센터</h1>
          </div>
          <p className="mb-5 text-sm text-gray-500">관리자 비밀번호를 입력하세요</p>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && verify(secret)}
            placeholder="관리자 비밀번호"
            className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
          />
          {authError && <p className="mt-2 text-sm text-red-500">{authError}</p>}
          <Button className="mt-4 w-full" onClick={() => verify(secret)}>로그인</Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-5xl px-4 py-8">
      {/* 헤더 */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-6 text-blue-600" />
          <h1 className="text-xl font-bold">중앙 관제 센터</h1>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => loadAll()} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          새로고침
        </Button>
      </div>

      {/* 탭 */}
      <div className="mb-6 flex gap-1 rounded-xl bg-gray-100 p-1">
        {([
          ["overview", "통계", <LayoutGrid key="o" className="size-4" />],
          ["properties", `매물 승인${stats?.pendingProperties ? ` (${stats.pendingProperties})` : ""}`, <Building2 key="p" className="size-4" />],
          ["sessions", "세션 로그", <ClipboardList key="s" className="size-4" />],
          ["links", "링크", <ExternalLink key="l" className="size-4" />],
        ] as [Tab, string, React.ReactNode][]).map(([t, label, icon]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition ${tab === t ? "bg-white shadow-sm text-gray-900" : "text-gray-500"}`}>
            {icon}{label}
          </button>
        ))}
      </div>

      {/* ── 통계 탭 ── */}
      {tab === "overview" && stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard icon={<Building2 className="size-5" />} label="전체 등록 매물" value={stats.totalProperties} accent="blue" />
          <StatCard icon={<Check className="size-5" />} label="승인된 매물" value={stats.approvedProperties} accent="green" />
          <StatCard icon={<ClipboardList className="size-5" />} label="승인 대기" value={stats.pendingProperties} accent="amber" />
          <StatCard icon={<Users className="size-5" />} label="등록 중개사" value={stats.totalAgents} accent="blue" />
          <StatCard icon={<ClipboardList className="size-5" />} label="전체 세션" value={stats.totalSessions} accent="blue" />
          <StatCard icon={<Check className="size-5" />} label="완료 세션" value={stats.completedSessions} accent="green" />
          <StatCard icon={<Eye className="size-5" />} label="매물 조회 수" value={stats.totalViews} accent="blue" />
          <StatCard icon={<ThumbsUp className="size-5" />} label="1차 '마음에 듦'" value={stats.likedYes} accent="green" />
          <StatCard icon={<Phone className="size-5" />} label="2차 '번호 요청'" value={stats.phoneRequested} accent="emerald" />
        </div>
      )}

      {/* ── 매물 승인 탭 ── */}
      {tab === "properties" && (
        <div className="space-y-3">
          {properties.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-400">등록된 매물이 없습니다</p>
          ) : properties.map((p) => (
            <div key={p.id} className={`rounded-2xl border p-4 ${p.approved ? "bg-white" : "border-amber-200 bg-amber-50"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold text-gray-900">{p.address}</p>
                    {p.approved
                      ? <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">승인됨</span>
                      : <span className="shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-medium text-amber-800">대기</span>}
                  </div>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {p.trade_type} · {p.trade_type === "월세" ? `월 ${p.monthly_rent}만 / 보증금 ${p.deposit}만` : `전세 ${p.deposit}만`} · 방{p.rooms} · {p.exclusive_area}㎡
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    중개사: {p.agent_profiles?.username ?? "-"} · {p.agent_profiles?.phone ?? "-"} · {p.agent_profiles?.office_address ?? "-"}
                  </p>
                  <div className="mt-1.5 flex gap-3 text-xs text-gray-500">
                    <span className="flex items-center gap-0.5"><Eye className="size-3" />{p._views}</span>
                    <span className="flex items-center gap-0.5"><ThumbsUp className="size-3" />{p._liked}</span>
                    <span className="flex items-center gap-0.5"><Phone className="size-3" />{p._phone}</span>
                    {p.photo_urls?.length > 0 && <span>사진 {p.photo_urls.length}장</span>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  {p.approved ? (
                    <Button variant="outline" size="sm" className="gap-1 text-red-600" onClick={() => toggleApprove(p.id, false)}>
                      <X className="size-3.5" />승인취소
                    </Button>
                  ) : (
                    <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700" onClick={() => toggleApprove(p.id, true)}>
                      <Check className="size-3.5" />승인
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 세션 로그 탭 ── */}
      {tab === "sessions" && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-400">
                <th className="py-2 pr-3">세션</th>
                <th className="py-2 pr-3">상태</th>
                <th className="py-2 pr-3">이탈/단계</th>
                <th className="py-2 pr-3">비교수</th>
                <th className="py-2 pr-3">추가</th>
                <th className="py-2 pr-3">카테고리</th>
                <th className="py-2 pr-3">조회</th>
                <th className="py-2 pr-3">1차 Y/N</th>
                <th className="py-2 pr-3">2차 Y/N</th>
                <th className="py-2 pr-3">시작</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr><td colSpan={10} className="py-12 text-center text-gray-400">세션 로그가 없습니다</td></tr>
              ) : sessions.map((s) => (
                <tr key={s.session_id} className="border-b border-gray-100">
                  <td className="py-2 pr-3 font-mono text-xs text-gray-500">{s.session_id.slice(0, 8)}</td>
                  <td className="py-2 pr-3">
                    {s.status === "completed"
                      ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">완료</span>
                      : <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">진행/이탈</span>}
                  </td>
                  <td className="py-2 pr-3 text-xs text-gray-600">{s.phase ?? "-"}</td>
                  <td className="py-2 pr-3 tabular-nums">{s.last_round}</td>
                  <td className="py-2 pr-3">{s.did_extra ? "O" : "-"}</td>
                  <td className="py-2 pr-3 text-xs">{s.selected_category ?? "-"}</td>
                  <td className="py-2 pr-3 tabular-nums">{s.viewed}</td>
                  <td className="py-2 pr-3 tabular-nums text-xs">{s.likedYes}/{s.likedNo}</td>
                  <td className="py-2 pr-3 tabular-nums text-xs">{s.phoneYes}/{s.phoneNo}</td>
                  <td className="py-2 pr-3 text-xs text-gray-400">{new Date(s.started_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 링크 탭 ── */}
      {tab === "links" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LinkCard href="/" title="홈 / 학습 시작" desc="사용자 매물 추천 학습 페이지" />
          <LinkCard href="/hub" title="링크 허브" desc="전체 페이지 모음 (공개)" />
          <LinkCard href="/agent/register" title="중개사 회원가입" desc="부동산 중개사 계정 생성" />
          <LinkCard href="/agent/login" title="중개사 로그인" desc="매물 관리 대시보드 진입" />
          <LinkCard href="/agent/dashboard" title="중개사 대시보드" desc="매물 등록/관리" />
          <LinkCard href="/select-building" title="건물 선택" desc="학습 시작 첫 단계" />
        </div>
      )}
    </main>
  );
}

function StatCard({ icon, label, value, accent }: {
  icon: React.ReactNode; label: string; value: number;
  accent: "blue" | "green" | "amber" | "emerald";
}) {
  const colors = {
    blue: "text-blue-600 bg-blue-50",
    green: "text-green-600 bg-green-50",
    amber: "text-amber-600 bg-amber-50",
    emerald: "text-emerald-600 bg-emerald-50",
  }[accent];
  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className={`mb-2 inline-flex rounded-lg p-2 ${colors}`}>{icon}</div>
      <p className="text-2xl font-bold tabular-nums text-gray-900">{value.toLocaleString()}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function LinkCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <a href={href} className="flex items-center justify-between rounded-2xl border bg-white p-4 transition hover:border-blue-300 hover:bg-blue-50/30">
      <div>
        <p className="font-semibold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500">{desc}</p>
      </div>
      <ExternalLink className="size-4 text-gray-400" />
    </a>
  );
}
