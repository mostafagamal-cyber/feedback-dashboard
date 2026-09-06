import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isViewingAs } from "@/lib/effective";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// v59: Admin-only endpoint to remove uploaded rows.
//
// POST body:
//   { target: "module_totals" | "quality_scores" | "freeze_frame_scores"
//           | "weekly_quality_scores",
//     mode:   "date" | "month" | "range",
//     date:   "YYYY-MM-DD" (mode=date),
//     month:  "YYYY-MM"    (mode=month),
//     from:   "YYYY-MM-DD" (mode=range),
//     to:     "YYYY-MM-DD" (mode=range),
//     module: optional module filter for module_totals + quality_scores }
//
// Returns { ok: true, deleted: <count> } or { error }.

async function requireAdmin(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", status: 401 as const };
  const { data: me } = await supabase
    .from("users").select("role").eq("id", user.id).single();
  if ((me as any)?.role !== "Admin") {
    return { error: "Admins only", status: 403 as const };
  }
  return { user };
}

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// Columns per target used for date filtering.
const DATE_COL: Record<string, string> = {
  module_totals: "review_date",
  quality_scores: "upload_month",
  freeze_frame_scores: "upload_month",
  weekly_quality_scores: "week_start_date",
  // v59: per-event tables (Base / Extras Final from the Google Sheet).
  base_events: "review_date",
  extras_events: "review_date",
  // v59: Live vs Offline comparison.
  live_vs_offline: "match_date",
};

// Whether the table supports a "module" column filter.
const MODULE_COL: Record<string, string | null> = {
  module_totals: "module",
  quality_scores: "module",
  freeze_frame_scores: null,
  weekly_quality_scores: null,
  base_events: null,
  extras_events: null,
  live_vs_offline: null,
};

export async function POST(req: NextRequest) {
  const supabase = createClient();
  if (isViewingAs()) {
    return NextResponse.json({ error: "Read-only in 'View as' mode." }, { status: 403 });
  }
  const auth = await requireAdmin(supabase);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const target = String(body.target || "");
  const mode = String(body.mode || "");
  const module_ = body.module ? String(body.module).trim() : null;

  if (!DATE_COL[target]) {
    return NextResponse.json({ error: `Unknown target "${target}".` }, { status: 400 });
  }
  const dateCol = DATE_COL[target];
  const moduleCol = MODULE_COL[target];

  let from = "";
  let to = "";
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const ym = /^\d{4}-\d{2}$/;

  if (mode === "date") {
    const d = String(body.date || "").trim();
    if (!iso.test(d)) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    from = d;
    to = d;
  } else if (mode === "month") {
    const m = String(body.month || "").trim();
    if (!ym.test(m)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
    // quality_scores + freeze_frame_scores use YYYY-MM-01 as the "month".
    from = `${m}-01`;
    if (target === "quality_scores" || target === "freeze_frame_scores") {
      to = from;
    } else {
      // Last day of that month for review_date / week_start_date tables.
      const [y, mm] = m.split("-").map(Number);
      const last = new Date(y, mm, 0).getDate();
      to = `${m}-${String(last).padStart(2, "0")}`;
    }
  } else if (mode === "range") {
    const f = String(body.from || "").trim();
    const t = String(body.to || "").trim();
    if (!iso.test(f) || !iso.test(t)) {
      return NextResponse.json({ error: "from/to must be YYYY-MM-DD" }, { status: 400 });
    }
    if (t < f) return NextResponse.json({ error: "to must be >= from" }, { status: 400 });
    from = f;
    to = t;
  } else {
    return NextResponse.json({ error: "mode must be date | month | range" }, { status: 400 });
  }

  const a = adminClient();

  // Count first so we can echo it back.
  let countQ = a.from(target).select("*", { count: "exact", head: true })
    .gte(dateCol, from).lte(dateCol, to);
  if (module_ && moduleCol) countQ = countQ.eq(moduleCol, module_);
  const { count, error: countErr } = await countQ;
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 400 });

  if (!count) return NextResponse.json({ ok: true, deleted: 0 });

  let delQ = a.from(target).delete().gte(dateCol, from).lte(dateCol, to);
  if (module_ && moduleCol) delQ = delQ.eq(moduleCol, module_);
  const { error } = await delQ;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, deleted: count });
}
