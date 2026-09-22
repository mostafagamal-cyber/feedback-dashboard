import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEffective } from "@/lib/effective";

export const runtime = "nodejs";

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

  const patch: Record<string, unknown> = {};
  if (typeof body.session_date === "string")
    patch.session_date = body.session_date.trim() || null;
  if (typeof body.session_time === "string")
    patch.session_time = body.session_time.trim() || null;
  if (Object.prototype.hasOwnProperty.call(body, "topic"))
    patch.topic = typeof body.topic === "string" ? body.topic.trim() || null : null;

  if (Object.keys(patch).length === 0)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const { error } = await supabase
    .from("feedback_reservations")
    .update(patch)
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
