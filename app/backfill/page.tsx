"use client";

import { useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";

const ODSAY_KEY = process.env.NEXT_PUBLIC_ODSAY_KEY ?? "";
const PNU_GATE = { lat: 35.231654, lng: 129.084588 };
const DELAY_MS = 500;

interface LogEntry {
  id: string;
  status: "ok" | "fail" | "skip";
  msg: string;
}

async function callOdsay(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
): Promise<
  | { ok: true; data: { total_time_min: number; transit_count: number; summary: string } }
  | { ok: false; reason: string }
> {
  const url = new URL("https://api.odsay.com/v1/api/searchPubTransPathT");
  url.searchParams.set("SX", String(sx));
  url.searchParams.set("SY", String(sy));
  url.searchParams.set("EX", String(ex));
  url.searchParams.set("EY", String(ey));
  url.searchParams.set("apiKey", ODSAY_KEY);

  const res = await fetch(url.toString());
  const json = await res.json();

  if (json.error) return { ok: false, reason: JSON.stringify(json.error) };
  if (!json.result) return { ok: false, reason: "no_result" };

  const paths = json.result.path;
  if (!Array.isArray(paths) || paths.length === 0) return { ok: false, reason: "no_path" };

  const best = paths[0];
  const info = best.info ?? {};
  const totalTime: number = info.totalTime ?? 0;
  const transitCount: number = info.transitCount ?? 0;
  const subPaths: Array<Record<string, unknown>> = best.subPath ?? [];

  const parts: string[] = [];
  for (const sp of subPaths) {
    const tt = sp.trafficType as number;
    if (tt === 1) {
      const lane = (sp.lane as Array<Record<string, unknown>> | undefined) ?? [];
      parts.push(`🚇${(lane[0]?.name as string) ?? "지하철"}`);
    } else if (tt === 2) {
      const lane = (sp.lane as Array<Record<string, unknown>> | undefined) ?? [];
      parts.push(`🚌${(lane[0]?.busNo as string) ?? "버스"}`);
    } else if (tt === 3) {
      const st = sp.sectionTime as number;
      if (st > 0) parts.push(`🚶${st}분`);
    }
  }

  return {
    ok: true,
    data: {
      total_time_min: totalTime,
      transit_count: transitCount,
      summary: parts.join(" → ") || "경로 없음",
    },
  };
}

async function writeToDb(
  table: "properties" | "buildings",
  id: string | number,
  data: Record<string, unknown>,
): Promise<string | null> {
  const res = await fetch("/api/backfill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table, id, data }),
  });
  const json = await res.json();
  if (!res.ok || json.error) return json.error ?? "unknown error";
  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function BackfillPage() {
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState("");
  const [stats, setStats] = useState({ okP: 0, failP: 0, okB: 0, failB: 0 });
  const abortRef = useRef(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((entry: LogEntry) => {
    setLogs((prev) => {
      const next = [...prev, entry];
      return next.length > 300 ? next.slice(-300) : next;
    });
    setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const run = useCallback(async () => {
    if (!ODSAY_KEY) {
      alert("NEXT_PUBLIC_ODSAY_KEY가 설정되어 있지 않습니다.");
      return;
    }

    abortRef.current = false;
    setRunning(true);
    setLogs([]);
    setStats({ okP: 0, failP: 0, okB: 0, failB: 0 });

    // ── 1. 매물 → 정문 ──
    setProgress("매물 목록 조회 중...");
    const { data: props, error: pErr } = await supabase
      .from("properties")
      .select("id,lat,lng,bus_to_gate_min")
      .order("id");

    if (pErr || !props) {
      addLog({ id: "-", status: "fail", msg: `매물 조회 실패: ${pErr?.message}` });
      setRunning(false);
      return;
    }

    const needProps = props.filter((p) => p.bus_to_gate_min == null);
    addLog({
      id: "정보",
      status: "skip",
      msg: `매물 총 ${props.length}개, 미처리 ${needProps.length}개`,
    });

    let okP = 0;
    let failP = 0;
    for (let i = 0; i < needProps.length; i++) {
      if (abortRef.current) break;
      const p = needProps[i];
      setProgress(`매물 → 정문: ${i + 1}/${needProps.length} (성공${okP} 실패${failP})`);

      const r = await callOdsay(p.lng, p.lat, PNU_GATE.lng, PNU_GATE.lat);
      if (r.ok) {
        const err = await writeToDb("properties", p.id, {
          bus_to_gate_min: r.data.total_time_min,
          bus_to_gate_transfers: r.data.transit_count,
          bus_to_gate_info: r.data,
        });
        if (err) {
          addLog({ id: p.id, status: "fail", msg: `DB 쓰기: ${err}` });
          failP++;
        } else {
          addLog({ id: p.id, status: "ok", msg: `${r.data.total_time_min}분 ${r.data.summary}` });
          okP++;
        }
      } else {
        if (r.reason === "no_path" || r.reason === "no_result") {
          await writeToDb("properties", p.id, {
            bus_to_gate_min: 0,
            bus_to_gate_transfers: 0,
            bus_to_gate_info: { reason: r.reason },
          });
          addLog({ id: p.id, status: "skip", msg: `경로 없음 (${r.reason})` });
        } else {
          addLog({ id: p.id, status: "fail", msg: r.reason });
          failP++;
        }
      }
      setStats((s) => ({ ...s, okP, failP }));
      await sleep(DELAY_MS);
    }
    addLog({ id: "합계", status: "ok", msg: `매물 완료 — 성공 ${okP}, 실패 ${failP}` });

    // ── 2. 정문 → 건물 ──
    setProgress("건물 목록 조회 중...");
    const { data: blds, error: bErr } = await supabase
      .from("buildings")
      .select("id,name,lat,lng,bus_from_gate_min")
      .order("name");

    if (bErr || !blds) {
      addLog({ id: "-", status: "fail", msg: `건물 조회 실패: ${bErr?.message}` });
      setRunning(false);
      return;
    }

    const needBlds = blds.filter((b) => b.bus_from_gate_min == null);
    addLog({
      id: "정보",
      status: "skip",
      msg: `건물 총 ${blds.length}개, 미처리 ${needBlds.length}개`,
    });

    let okB = 0;
    let failB = 0;
    for (let i = 0; i < needBlds.length; i++) {
      if (abortRef.current) break;
      const b = needBlds[i];
      setProgress(`정문 → 건물: ${i + 1}/${needBlds.length} ${b.name} (성공${okB} 실패${failB})`);

      const r = await callOdsay(PNU_GATE.lng, PNU_GATE.lat, b.lng, b.lat);
      if (r.ok) {
        const err = await writeToDb("buildings", b.id, {
          bus_from_gate_min: r.data.total_time_min,
          bus_from_gate_transfers: r.data.transit_count,
          bus_from_gate_info: r.data,
        });
        if (err) {
          addLog({ id: b.name, status: "fail", msg: `DB 쓰기: ${err}` });
          failB++;
        } else {
          addLog({
            id: b.name,
            status: "ok",
            msg: `${r.data.total_time_min}분 ${r.data.summary}`,
          });
          okB++;
        }
      } else {
        if (r.reason === "no_path" || r.reason === "no_result") {
          await writeToDb("buildings", b.id, {
            bus_from_gate_min: 0,
            bus_from_gate_transfers: 0,
            bus_from_gate_info: { reason: r.reason },
          });
          addLog({ id: b.name, status: "skip", msg: `경로 없음 (${r.reason})` });
        } else {
          addLog({ id: b.name, status: "fail", msg: r.reason });
          failB++;
        }
      }
      setStats((s) => ({ ...s, okB, failB }));
      await sleep(DELAY_MS);
    }
    addLog({ id: "합계", status: "ok", msg: `건물 완료 — 성공 ${okB}, 실패 ${failB}` });
    setProgress("✅ 전체 완료!");
    setRunning(false);
  }, [addLog]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-xl font-bold">ODsay 버스 백필</h1>
      <p className="mt-2 text-sm text-gray-500">
        브라우저에서 ODsay를 직접 호출합니다 (서버 호출 시 ApiKey 오류 우회).
        <br />
        결과는 <code>/api/backfill</code>을 통해 service_role 키로 Supabase에 저장합니다.
      </p>

      <div className="mt-6 flex items-center gap-3">
        <Button onClick={run} disabled={running} size="lg">
          {running ? "실행 중..." : "백필 시작"}
        </Button>
        {running && (
          <Button variant="destructive" onClick={() => { abortRef.current = true; }}>
            중단
          </Button>
        )}
      </div>

      {progress && (
        <p className="mt-4 text-sm font-semibold text-blue-600">{progress}</p>
      )}

      <div className="mt-2 flex gap-4 text-xs text-gray-500">
        <span>매물: ✅{stats.okP} ❌{stats.failP}</span>
        <span>건물: ✅{stats.okB} ❌{stats.failB}</span>
      </div>

      <div className="mt-4 max-h-[60vh] overflow-y-auto rounded border bg-gray-50 p-3 font-mono text-xs leading-5">
        {logs.length === 0 && (
          <p className="text-gray-400">로그가 여기에 표시됩니다</p>
        )}
        {logs.map((l, i) => (
          <div
            key={i}
            className={
              l.status === "ok"
                ? "text-green-700"
                : l.status === "fail"
                  ? "text-red-600"
                  : "text-gray-500"
            }
          >
            [{l.id}] {l.msg}
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>
    </main>
  );
}
