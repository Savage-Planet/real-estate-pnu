/**
 * 사용자 세션 진행 로그 헬퍼.
 * user_sessions 테이블에 시작/진행/완료를 기록한다. (best-effort, 실패 무시)
 */
import { supabase } from "@/lib/supabase";

export interface SessionProgress {
  phase?: "macro" | "micro" | "extra" | "done";
  macroRound?: number;
  microRound?: number;
  extraRound?: number;
  lastRound?: number;
  didExtra?: boolean;
  selectedCategory?: string;
}

/** 세션 시작 기록 (upsert) */
export async function logSessionStart(sessionId: string, buildingId: string): Promise<void> {
  if (!sessionId) return;
  try {
    await supabase.from("user_sessions").upsert(
      {
        session_id: sessionId,
        building_id: buildingId,
        status: "started",
        phase: "macro",
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id" },
    );
  } catch { /* best-effort */ }
}

/** 세션 진행 상황 갱신 */
export async function logSessionProgress(sessionId: string, p: SessionProgress): Promise<void> {
  if (!sessionId) return;
  try {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (p.phase !== undefined) update.phase = p.phase;
    if (p.macroRound !== undefined) update.macro_round = p.macroRound;
    if (p.microRound !== undefined) update.micro_round = p.microRound;
    if (p.extraRound !== undefined) update.extra_round = p.extraRound;
    if (p.lastRound !== undefined) update.last_round = p.lastRound;
    if (p.didExtra !== undefined) update.did_extra = p.didExtra;
    if (p.selectedCategory !== undefined) update.selected_category = p.selectedCategory;
    await supabase.from("user_sessions").update(update).eq("session_id", sessionId);
  } catch { /* best-effort */ }
}

/** 세션 완료 기록 */
export async function logSessionComplete(
  sessionId: string,
  selectedCategory?: string,
  didExtra?: boolean,
): Promise<void> {
  if (!sessionId) return;
  try {
    await supabase
      .from("user_sessions")
      .update({
        status: "completed",
        phase: "done",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...(selectedCategory ? { selected_category: selectedCategory } : {}),
        ...(didExtra !== undefined ? { did_extra: didExtra } : {}),
      })
      .eq("session_id", sessionId);
  } catch { /* best-effort */ }
}
