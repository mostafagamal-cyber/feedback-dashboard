import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isViewingAs } from "@/lib/effective";

export const runtime = "nodejs";
export const maxDuration = 300;

// v59: Live vs Offline uploader.
//
// Expected columns (order-agnostic; headers matched case-insensitively):
//   match_date, match_id, offline_collector_hrcode, part_id, event,
//   offline_event_type, jersey, qualifier, live_reviewer_input,
//   offline_collector_input, resolution, Total Count
//
// Accepts CSV / TSV / UTF-16LE BOM. Inserts rows in 500-row chunks.

function parseRows(text: string): string[][] {
  const clean = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const first = clean.split("\n")[0] ?? "";
  const sep = first.includes("\t") ? "\t" : ",";
  return clean.split("\n").map((l) => {
    if (sep === "\t") return l.split("\t").map((c) => c.trim());
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (quoted) {
        if (ch === '"') {
          if (l[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
        } else cur += ch;
      } else {
        if (ch === '"') quoted = true;
        else if (ch === ",") { out.push(cur.trim()); cur = ""; }
        else cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  }).filter((r) => r.some((c) => c));
}

function normHeader(h: string) {
  return h.toLowerCase().replace(/[\s.]+/g, "_");
}

function toIsoDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(s);
  if (m) {
    let [, mm, dd, yy] = m;
    if (yy.length === 2) yy = String(2000 + Number(yy));
    return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return null;
}

function toBoolStr(v: string | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (!s) return null;
  if (["TRUE", "1", "YES"].includes(s)) return "TRUE";
  if (["FALSE", "0", "NO"].includes(s)) return "FALSE";
  return s;
}

async function requireAdmin(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", status: 401 as const };
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).single();
  if ((me as any)?.role !== "Admin") return { error: "Admins only", status: 403 as const };
  return { user };
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  if (isViewingAs()) {
    return NextResponse.json({ error: "Read-only in 'View as' mode." }, { status: 403 });
  }
  const auth = await requireAdmin(supabase);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Missing file." }, { status: 400 });

  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const text =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? new TextDecoder("utf-16le").decode(buf)
      : new TextDecoder("utf-8").decode(buf);

  const rows = parseRows(text);
  if (rows.length < 2) return NextResponse.json({ error: "File has no data." }, { status: 400 });

  const headers = rows[0].map(normHeader);
  const idx = (name: string) => headers.findIndex((h) => h === name || h.includes(name));
  const iDate  = idx("match_date");
  const iMatch = idx("match_id");
  const iHr    = idx("offline_collector_hrcode") >= 0 ? idx("offline_collector_hrcode") : idx("hr_code");
  const iPart  = idx("part_id");
  const iEvent = idx("event");
  const iType  = idx("offline_event_type");
  const iJer   = idx("jersey");
  const iQual  = idx("qualifier");
  const iLive  = idx("live_reviewer_input");
  const iOff   = idx("offline_collector_input");
  const iRes   = idx("resolution");
  const iCount = idx("total_count");

  if (iEvent < 0) {
    return NextResponse.json({ error: "Missing 'event' column." }, { status: 400 });
  }

  const inserts: any[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    inserts.push({
      match_date: toIsoDate(r[iDate]),
      match_id: (r[iMatch] ?? "").trim() || null,
      hr_code: iHr >= 0 ? ((r[iHr] ?? "").trim().toUpperCase() || null) : null,
      part_id: r[iPart] ? Number(r[iPart]) || null : null,
      event: (r[iEvent] ?? "").trim() || null,
      offline_event_type: iType >= 0 ? (r[iType] ?? "").trim() || null : null,
      jersey: iJer >= 0 ? (r[iJer] ?? "").trim() || null : null,
      qualifier: iQual >= 0 ? (r[iQual] ?? "").trim() || null : null,
      live_reviewer_input: toBoolStr(iLive >= 0 ? r[iLive] : undefined),
      offline_collector_input: toBoolStr(iOff >= 0 ? r[iOff] : undefined),
      resolution: iRes >= 0 ? (r[iRes] ?? "").trim() || null : null,
      total_count: iCount >= 0 ? Math.max(1, parseInt(String(r[iCount] ?? "1").replace(/[,\s"]/g, ""), 10) || 1) : 1,
      uploaded_by: auth.user.id,
    });
  }
  if (inserts.length === 0) return NextResponse.json({ error: "No valid rows." }, { status: 400 });

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const slice = inserts.slice(i, i + CHUNK);
    const { error } = await supabase.from("live_vs_offline").insert(slice);
    if (error) return NextResponse.json({ error: error.message, inserted }, { status: 500 });
    inserted += slice.length;
  }
  return NextResponse.json({ ok: true, inserted });
}
