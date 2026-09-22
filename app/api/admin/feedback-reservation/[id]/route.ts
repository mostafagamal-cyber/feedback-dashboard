import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getEffective } from "@/lib/effective";
import { sendEmail, renderEmail } from "@/lib/email";

export const runtime = "nodejs";

const DASHBOARD_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://feedback-dashboard-7i8h.vercel.app";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Resolve auth emails for a list of hr_codes via the service-role client. */
async function getCollectorEmails(hrCodes: string[]): Promise<string[]> {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || hrCodes.length === 0) return [];
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false } }
  );
  const { data: rows } = await admin
    .from("users")
    .select("id, hr_code")
    .in("hr_code", hrCodes);
  const emails: string[] = [];
  for (const row of (rows ?? []) as any[]) {
    const {
      data: { user },
    } = await admin.auth.admin.getUserById(row.id);
    if (user?.email) emails.push(user.email);
  }
  return emails;
}

// ---------------------------------------------------------------------------
// PATCH — edit session_date / session_time / topic (Admin only)
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const eff = await getEffective(supabase);
  if (!eff?.profile || eff.profile.role !== "Admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  // Fetch current row (needed for diff + attendee list)
  const { data: current } = await supabase
    .from("feedback_reservations")
    .select("session_date, session_time, topic, feedback_attendees(hr_code)")
    .eq("id", params.id)
    .single();

  const patch: Record<string, unknown> = {};
  const changes: string[] = []; // human-readable list of what changed

  if (typeof body.session_date === "string") {
    const val = body.session_date.trim() || null;
    patch.session_date = val;
    if (val && val !== (current?.session_date ?? null))
      changes.push(`Date: ${val}`);
  }
  if (typeof body.session_time === "string") {
    const val = body.session_time.trim() || null;
    patch.session_time = val;
    if (val !== (current?.session_time ?? null))
      changes.push(val ? `Time: ${val}` : "Time: removed");
  }
  if (Object.prototype.hasOwnProperty.call(body, "topic")) {
    const val =
      typeof body.topic === "string" ? body.topic.trim() || null : null;
    patch.topic = val;
    if (val !== ((current as any)?.topic ?? null))
      changes.push(val ? `Topic: ${val}` : "Topic: removed");
  }

  if (Object.keys(patch).length === 0)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const { error } = await supabase
    .from("feedback_reservations")
    .update(patch)
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Send update notification (fire-and-forget)
  if (changes.length > 0 && current) {
    const hrCodes = (
      ((current as any).feedback_attendees ?? []) as { hr_code: string }[]
    )
      .map((a) => a.hr_code)
      .filter(Boolean);
    const emails = await getCollectorEmails(hrCodes);
    const sessionDate =
      (patch.session_date as string) ?? (current as any).session_date;
    const subject = `Feedback session updated - ${sessionDate}`;
    const changesHtml = changes
      .map((c) => `<li>${esc(c)}</li>`)
      .join("");
    const bodyHtml = `<ul style="margin:0 0 12px 18px;padding:0;color:#374151;">${changesHtml}</ul>`;
    const bodyText = changes.join("\n");

    for (const email of emails) {
      const { html, text } = renderEmail({
        heading: "Feedback session updated",
        intro: "Your feedback session details have been updated.",
        bodyHtml,
        bodyText,
        cta: {
          label: "Open My Sessions",
          url: `${DASHBOARD_URL}/my-sessions`,
        },
        closing: "Please log in to the dashboard for full details.",
      });
      sendEmail({ to: email, subject, html, text }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// DELETE — remove session + send cancellation email (Admin only)
// ---------------------------------------------------------------------------
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const eff = await getEffective(supabase);
  if (!eff?.profile || eff.profile.role !== "Admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  // Fetch before deleting so we can notify attendees
  const { data: current } = await supabase
    .from("feedback_reservations")
    .select(
      "session_date, session_time, shift, mode, feedback_attendees(hr_code)"
    )
    .eq("id", params.id)
    .single();

  const { error } = await supabase
    .from("feedback_reservations")
    .delete()
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Send cancellation emails (fire-and-forget)
  if (current) {
    const hrCodes = (
      ((current as any).feedback_attendees ?? []) as { hr_code: string }[]
    )
      .map((a) => a.hr_code)
      .filter(Boolean);
    const emails = await getCollectorEmails(hrCodes);
    const sessionDate = (current as any).session_date as string;
    const sessionTime = (current as any).session_time as string | null;
    const shift = (current as any).shift as string | null;
    const mode = (current as any).mode as string;
    const timeStr = sessionTime ? ` at ${sessionTime}` : "";
    const shiftStr = shift ? ` (${shift} shift)` : "";
    const subject = `Feedback session cancelled - ${sessionDate}`;
    const bodyHtml = `
      <ul style="margin:0 0 12px 18px;padding:0;color:#374151;">
        <li><strong>Date:</strong> ${esc(sessionDate)}${timeStr}${shiftStr}</li>
        <li><strong>Mode:</strong> ${esc(mode)}</li>
      </ul>`;
    const bodyText =
      `Date: ${sessionDate}${timeStr}${shiftStr}\nMode: ${mode}`;

    for (const email of emails) {
      const { html, text } = renderEmail({
        heading: "Feedback session cancelled",
        intro: "Your upcoming feedback session has been cancelled.",
        bodyHtml,
        bodyText,
        cta: {
          label: "Open My Sessions",
          url: `${DASHBOARD_URL}/my-sessions`,
        },
        closing: "Please contact your reviewer if you have any questions.",
      });
      sendEmail({ to: email, subject, html, text }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}
