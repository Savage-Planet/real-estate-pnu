import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * POST /api/backfill
 * 브라우저 백필 페이지에서 ODsay 결과를 받아 Supabase에 기록.
 * service_role key를 써서 RLS 우회.
 */
export async function POST(request: Request) {
  let body: {
    table: "properties" | "buildings";
    id: string | number;
    data: Record<string, unknown>;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { table, id, data } = body;
  if (!table || !id || !data) {
    return NextResponse.json(
      { error: "table, id, data required" },
      { status: 400 },
    );
  }

  if (table !== "properties" && table !== "buildings") {
    return NextResponse.json(
      { error: "table must be properties or buildings" },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from(table)
    .update(data)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
