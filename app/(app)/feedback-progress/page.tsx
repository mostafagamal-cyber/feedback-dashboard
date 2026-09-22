import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffective } from "@/lib/effective";
import FeedbackProgress, { type Session } from "@/components/FeedbackProgress";


export const dynamic = "force-dynamic";

export default async function FeedbackProgressPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const eff = await getEffective(supabase);
  const profile = eff?.profile ?? null;
  const role = (profile?.role ?? "Viewer") as string;
  const isAdmin = role === "Admin";
  if (role === "Viewer") redirect("/analytics");

  const { data: reservations } = await supabase
    .from("feedback_reservations")
    .select(
      "id, session_date, session_time, shift, mode, is_group, location, meet_link, duration_minutes, topic, feedback_attendees(id, hr_code, attendance, comment)"
    )
    .order("session_date", { ascending: false })
    .order("session_time", { ascending: true });

  // Collector directory for names/teams.
  const { data: usersDirRaw } = await supabase
    .from("users")
    .select("hr_code, first_name, last_name, squad");
  const byHr = new Map<string, { name: string | null; team: string | null }>();
  (usersDirRaw ?? []).forEach((u: any) => {
    if (!u.hr_code) return;
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
    byHr.set(u.hr_code, { name: name || null, team: u.squad ?? null });
  });

  const sessions: Session[] = (reservations ?? []).map((r: any) => ({
    id: r.id,
    session_date: r.session_date,
    session_time: r.session_time,
    shift: r.shift,
    mode: r.mode,
    is_group: r.is_group,
    location: r.location,
    meet_link: r.meet_link,
    duration_minutes: (r.duration_minutes ?? null) as number | null,
    topic: (r.topic ?? null) as string | null,
    attendees: (r.feedback_attendees ?? []).map((a: any) => ({
      id: a.id,
      hr_code: a.hr_code,
      attendance: a.attendance,
      comment: a.comment,
      name: byHr.get(a.hr_code)?.name ?? null,
      team: byHr.get(a.hr_code)?.team ?? null,
    })),
  }));

  return <FeedbackProgress initial={sessions} isAdmin={isAdmin} />;
}
