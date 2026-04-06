/**
 * Import 가로등 CSV (CP949) into Supabase `street_lights`.
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (recommended; anon often cannot upsert under RLS)
 *
 * Optional:
 *   STREET_LIGHTS_CSV=absolute\path\to\가로등_최종_533개.csv
 *
 * Usage: node scripts/import-street-lights.mjs
 */

import fs from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import iconv from "iconv-lite";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

function loadEnvLocal() {
  const p = join(projectRoot, ".env.local");
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function defaultCsvPath() {
  const fromEnv = process.env.STREET_LIGHTS_CSV;
  if (fromEnv) return fromEnv;
  return join(homedir(), "Desktop", "종프", "가로등_최종_533개.csv");
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV has no data rows");
  const header = lines[0].split(",").map((s) => s.trim());
  if (!header[0].includes("번") && !/^\d+$/.test(lines[1].split(",")[0]?.trim() ?? "")) {
    console.warn("Unexpected header:", header.join(","));
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 3) continue;
    const id = parseInt(parts[0].trim(), 10);
    const lat = parseFloat(parts[1].trim());
    const lng = parseFloat(parts[2].trim());
    if (!Number.isFinite(id) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    rows.push({ id, light_no: id, lat, lng });
  }
  return rows;
}

async function main() {
  loadEnvLocal();
  const csvPath = defaultCsvPath();
  if (!fs.existsSync(csvPath)) {
    console.error("CSV not found:", csvPath);
    console.error("Set STREET_LIGHTS_CSV to the file path.");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const key = serviceKey || anonKey;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or Supabase key in .env.local");
    process.exit(1);
  }
  if (!serviceKey) {
    console.warn(
      "SUPABASE_SERVICE_ROLE_KEY is not set. If upsert fails with RLS/permission, add the service role key from Supabase Dashboard → Settings → API."
    );
  }

  const buf = fs.readFileSync(csvPath);
  const text = iconv.decode(buf, "cp949");
  const rows = parseCsv(text);
  if (rows.length === 0) {
    console.error("No valid rows parsed.");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const batchSize = 200;
  let total = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await supabase.from("street_lights").upsert(chunk, {
      onConflict: "id",
    });
    if (error) {
      console.error("Upsert error:", error.message, error);
      process.exit(1);
    }
    total += chunk.length;
    console.log(`Upserted ${total} / ${rows.length}`);
  }

  console.log("Done. Rows upserted:", rows.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
