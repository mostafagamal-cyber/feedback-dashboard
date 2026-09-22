"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import MultiSelectCombobox, { type MSOption } from "@/components/MultiSelectCombobox";

type Attendance = "Attended" | "Attended Late" | "Absent" | "Cancelled";
const STATUSES: Attendance[] = ["Attended", "Attended Late", "Absent", "Cancelled"];

export type Attendee = {
  id: string;
  hr_code: string;
  attendance: Attendance | null;
  comment: string | null;
  name: string | null;
  team: string | null;
};
export type Session = {
  id: string;
  session_date: string;
  session_time: string | null;
  shift: string | null;
  mode: "Online" | "Offline";
  is_group: boolean;
  location: string | null;
  meet_link: string | null;
  // v59: duration + free-text topic captured at booking time.
  duration_minutes?: number | null;
  topic?: string | null;
  attendees: Attendee[];
};

const statusStyle: Record<string, string> = {
  Attended: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  "Attended Late": "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  Absent: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  Cancelled: "bg-slate-200 text-slate-600 dark:text-slate-300",
  "": "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400",
};

const first3 = (s: string | null) => (s ? s.trim().split(/\s+/).slice(0, 3).join(" ") : "");

function pad(n: number) { return String(n).padStart(2, "0"); }
function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function FeedbackProgress({
  initial,
  isAdmin = false,
}: {
  initial: Session[];
  isAdmin?: boolean;
}) {
  const supabase = createClient();
  const [sessions, setSessions] = useState<Session[]>(initial);
  // v59: multi-select filters. Empty arrays = "all".
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [teamFilter, setTeamFilter] = useState<string[]>([]);
  const [collectorFilter, setCollectorFilter] = useState<string[]>([]);

  // v59: reviewer's Assigned Collectors toggle.
  const [myAssigned, setMyAssigned] = useState<string[]>([]);
  const [assignmentsLoaded, setAssignmentsLoaded] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  useEffect(() => {
    fetch("/api/my-assigned", { cache: "no-store" })
      .then((r) => r.json())
      .then(({ hr_codes }: { hr_codes?: string[] }) => {
        if (Array.isArray(hr_codes)) setMyAssigned(hr_codes);
      })
      .catch(() => {})
      .finally(() => setAssignmentsLoaded(true));
  }, []);

  // Default range: Jan 1 of the current year through today.
  const now = new Date();
  const [fromDate, setFromDate] = useState<string>(`${now.getFullYear()}-01-01`);
  const [toDate, setToDate] = useState<string>(isoDate(now));

  // v59: Feedback Analysis links land here with ?from=&to=&status=<csv>.
  // Preload those into state on mount so drill-through filters apply.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    const f = q.get("from");
    const t = q.get("to");
    const s = q.get("status");
    const c = q.get("collector");
    if (f && /^\d{4}-\d{2}-\d{2}$/.test(f)) setFromDate(f);
    if (t && /^\d{4}-\d{2}-\d{2}$/.test(t)) setToDate(t);
    if (s) setStatusFilter(s.split(",").map((v) => v.trim()).filter(Boolean));
    if (c) setCollectorFilter(c.split(",").map((v) => v.trim()).filter(Boolean));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Admin: edit session date/time/topic
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    session_date: string;
    session_time: string;
    topic: string;
  }>({ session_date: "", session_time: "", topic: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editMsg, setEditMsg] = useState<string | null>(null);

  function openEdit(s: Session) {
    setEditingId(s.id);
    setEditDraft({
      session_date: s.session_date ?? "",
      session_time: s.session_time ?? "",
      topic: s.topic ?? "",
    });
    setEditMsg(null);
  }

  async function saveSession() {
    if (!editingId) return;
    setEditSaving(true);
    setEditMsg(null);
    const res = await fetch(`/api/admin/feedback-reservation/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_date: editDraft.session_date,
        session_time: editDraft.session_time,
        topic: editDraft.topic,
      }),
    });
    const json = await res.json();
    setEditSaving(false);
    if (!res.ok) {
      setEditMsg(json.error ?? "Error saving");
      return;
    }
    // update local state
    setSessions((prev) =>
      prev.map((s) =>
        s.id !== editingId
          ? s
          : {
              ...s,
              session_date: editDraft.session_date || s.session_date,
              session_time: editDraft.session_time || null,
              topic: editDraft.topic || null,
            }
      )
    );
    setEditingId(null);
  }

  function editAttendee(sid: string, aid: string, patch: Partial<Attendee>) {
    setSessions((p) =>
      p.map((s) =>
        s.id !== sid
          ? s
          : { ...s, attendees: s.attendees.map((a) => (a.id === aid ? { ...a, ...patch } : a)) }
      )
    );
  }

  async function save(_sess: Session, a: Attendee) {
    setSavingId(a.id);
    setSavedId(null);
    setMsg(null);
    const { error } = await supabase
      .from("feedback_attendees")
      .update({ attendance: a.attendance, comment: a.comment })
      .eq("id", a.id);
    if (error) {
      setSavingId(null);
      return setMsg(error.message);
    }
    setSavingId(null);
    setSavedId(a.id);
    setTimeout(() => setSavedId((s) => (s === a.id ? null : s)), 1500);
  }

  const teamOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) for (const a of s.attendees) if (a.team) set.add(a.team);
    return Array.from(set).sort();
  }, [sessions]);

  const teamSet = useMemo(() => new Set(teamFilter), [teamFilter]);
  const collectorSet = useMemo(() => new Set(collectorFilter), [collectorFilter]);
  const statusSet = useMemo(() => new Set(statusFilter), [statusFilter]);

  const collectorOptions = useMemo(() => {
    const map = new Map<string, { hr_code: string; name: string | null; team: string | null }>();
    for (const s of sessions) {
      for (const a of s.attendees) {
        if (!a.hr_code) continue;
        if (!map.has(a.hr_code)) {
          map.set(a.hr_code, { hr_code: a.hr_code, name: a.name, team: a.team });
        }
      }
    }
    return Array.from(map.values())
      .filter((c) => teamSet.size === 0 || (c.team && teamSet.has(c.team)))
      .sort((a, b) => (a.name ?? a.hr_code).localeCompare(b.name ?? b.hr_code));
  }, [sessions, teamSet]);

  const visible = useMemo(() => {
    return sessions
      .map((s) => {
        const attendees = s.attendees.filter((a) => {
          if (statusSet.size > 0) {
            // "__none__" pseudo-value matches un-marked rows.
            const key = a.attendance ?? "__none__";
            if (!statusSet.has(key)) return false;
          }
          if (teamSet.size > 0 && (!a.team || !teamSet.has(a.team))) return false;
          if (collectorSet.size > 0 && !collectorSet.has(a.hr_code)) return false;
          // v59: reviewer's "only mine" gate.
          if (onlyMine && myAssigned.length > 0 && !myAssigned.includes(a.hr_code)) return false;
          return true;
        });
        return { ...s, attendees };
      })
      .filter((s) => {
        if (!s.session_date) return false;
        if (fromDate && s.session_date < fromDate) return false;
        if (toDate && s.session_date > toDate) return false;
        return s.attendees.length > 0;
      });
  }, [sessions, statusSet, teamSet, collectorSet, fromDate, toDate, onlyMine, myAssigned]);

  const stats = useMemo(() => {
    let total = 0, attended = 0, late = 0, absent = 0, cancelled = 0, notMarked = 0;
    for (const s of visible) {
      for (const a of s.attendees) {
        total++;
        switch (a.attendance) {
          case "Attended": attended++; break;
          case "Attended Late": late++; break;
          case "Absent": absent++; break;
          case "Cancelled": cancelled++; break;
          default: notMarked++;
        }
      }
    }
    const completed = attended + late;
    const notCompleted = total - completed;
    return { total, completed, notCompleted, attended, late, absent, cancelled, notMarked };
  }, [visible]);

  const cards = [
    { label: "Total sessions", value: stats.total, color: "text-slate-800 dark:text-slate-100" },
    { label: "Completed", value: stats.completed, color: "text-emerald-600" },
    { label: "Not completed", value: stats.notCompleted, color: stats.notCompleted ? "text-amber-600" : "text-slate-800 dark:text-slate-100" },
    { label: "Attended", value: stats.attended, color: "text-emerald-600" },
    { label: "Late attendance", value: stats.late, color: stats.late ? "text-amber-600" : "text-slate-800 dark:text-slate-100" },
    { label: "Absent", value: stats.absent, color: stats.absent ? "text-red-600" : "text-slate-800 dark:text-slate-100" },
    { label: "Cancelled", value: stats.cancelled, color: "text-slate-500 dark:text-slate-400" },
    { label: "Not marked", value: stats.notMarked, color: stats.notMarked ? "text-amber-600" : "text-slate-800 dark:text-slate-100" },
  ];

  const inputCls = "rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-900 text-sm";

  const anyFilter =
    statusFilter.length > 0 ||
    teamFilter.length > 0 ||
    collectorFilter.length > 0 ||
    fromDate !== `${now.getFullYear()}-01-01` ||
    toDate !== isoDate(now);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Feedback Progress</h1>
        <p className="text-slate-500 dark:text-slate-400">Track attendance for every scheduled feedback session.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3">
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">From</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">To</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className={inputCls}
          />
        </div>

        <div className="w-52">
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Statuses</label>
          <MultiSelectCombobox
            options={[
              { value: "__none__", label: "Not marked" },
              ...STATUSES.map((s) => ({ value: s as string, label: s as string })),
            ]}
            values={statusFilter}
            onApply={setStatusFilter}
            placeholder="All statuses"
            showSearch={false}
          />
        </div>

        <div className="w-52">
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Teams</label>
          <MultiSelectCombobox
            options={teamOptions.map((t) => ({ value: t, label: t }))}
            values={teamFilter}
            onApply={(next) => {
              setTeamFilter(next);
              // Drop collector picks no longer on any applied team.
              if (next.length > 0 && collectorFilter.length > 0) {
                const allowed = new Set(
                  collectorOptions.filter((c) => c.team && next.includes(c.team)).map((c) => c.hr_code)
                );
                setCollectorFilter((prev) => prev.filter((v) => allowed.has(v)));
              }
            }}
            placeholder="All teams"
          />
        </div>

        <div className="w-72">
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Collectors</label>
          <MultiSelectCombobox
            options={collectorOptions.map((c) => ({
              value: c.hr_code,
              label: `${c.hr_code}${c.name && c.name !== c.hr_code ? ` - ${first3(c.name)}` : ""}${c.team ? ` - ${c.team}` : ""}`,
            }))}
            values={collectorFilter}
            onApply={setCollectorFilter}
            placeholder="All collectors"
          />
        </div>

        {assignmentsLoaded && (
          <div className="flex items-end">
            <label
              className={`flex items-center gap-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-900 ${
                myAssigned.length === 0
                  ? "text-slate-400 dark:text-slate-500 cursor-not-allowed"
                  : "text-slate-600 dark:text-slate-300 cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                checked={onlyMine}
                disabled={myAssigned.length === 0}
                onChange={(e) => setOnlyMine(e.target.checked)}
                className="h-4 w-4"
              />
              <span>Only my assigned ({myAssigned.length})</span>
            </label>
          </div>
        )}

        {anyFilter && (
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setStatusFilter([]);
                setTeamFilter([]);
                setCollectorFilter([]);
                setFromDate(`${now.getFullYear()}-01-01`);
                setToDate(isoDate(now));
              }}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {msg && <p className="text-sm text-red-600">{msg}</p>}

      <div className="text-sm text-slate-500 dark:text-slate-400">
        {visible.length} session(s) between {fromDate} and {toDate}
      </div>

      {visible.length === 0 ? (
        <p className="text-slate-500 dark:text-slate-400">No sessions match these filters.</p>
      ) : (
        <div className="space-y-4">
          {visible.map((s) => (
            <div key={s.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                {/* Admin edit button */}
                {isAdmin && editingId !== s.id && (
                  <button
                    type="button"
                    onClick={() => openEdit(s)}
                    title="Edit session"
                    className="ml-auto rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    {/* pencil icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  </button>
                )}
                <span className="font-semibold text-slate-800 dark:text-slate-100">{s.session_date}</span>
                {s.session_time && <span className="text-slate-500 dark:text-slate-400">{s.session_time}</span>}
                {s.shift && (
                  <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs">{s.shift}</span>
                )}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    s.mode === "Online" ? "bg-sky-100 text-sky-800" : "bg-violet-100 text-violet-800"
                  }`}
                >
                  {s.mode}
                </span>
                {s.is_group && (
                  <span className="rounded-full bg-indigo-100 text-indigo-800 px-2 py-0.5 text-xs">
                    Group - {s.attendees.length}
                  </span>
                )}
                {s.mode === "Offline" && s.location && (
                  <span className="text-slate-500 dark:text-slate-400">{s.location}</span>
                )}
                {s.mode === "Online" && s.meet_link && (
                  <a
                    href={s.meet_link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-700 hover:underline truncate max-w-[260px]"
                  >
                    {s.meet_link}
                  </a>
                )}
                {s.duration_minutes != null && s.duration_minutes > 0 && (
                  <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs">
                    {s.duration_minutes} min
                  </span>
                )}
                {s.topic && (
                  <span className="text-slate-600 dark:text-slate-300 italic truncate max-w-[320px]" title={s.topic}>
                    Topic: {s.topic}
                  </span>
                )}
              </div>

              {/* Admin inline edit form */}
              {isAdmin && editingId === s.id && (
                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Edit session</p>
                  <div className="flex flex-wrap gap-3 items-end">
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Date</label>
                      <input
                        type="date"
                        value={editDraft.session_date}
                        onChange={(e) => setEditDraft((d) => ({ ...d, session_date: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Time</label>
                      <input
                        type="time"
                        value={editDraft.session_time}
                        onChange={(e) => setEditDraft((d) => ({ ...d, session_time: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                    <div className="flex-1 min-w-[220px]">
                      <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Topic</label>
                      <input
                        type="text"
                        value={editDraft.topic}
                        onChange={(e) => setEditDraft((d) => ({ ...d, topic: e.target.value }))}
                        placeholder="e.g. Freeze frame mistakes"
                        className={`${inputCls} w-full`}
                      />
                    </div>
                    <div className="flex gap-2 items-center">
                      <button
                        type="button"
                        onClick={saveSession}
                        disabled={editSaving}
                        className="rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
                      >
                        {editSaving ? "Saving..." : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditingId(null); setEditMsg(null); }}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  {editMsg && <p className="mt-2 text-xs text-red-600">{editMsg}</p>}
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800">
                    <tr>
                      <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-4 py-2.5 whitespace-nowrap">Collector</th>
                      <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-4 py-2.5">Attendance</th>
                      <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-4 py-2.5">Comment</th>
                      <th className="text-right font-medium text-slate-500 dark:text-slate-400 px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.attendees.map((a) => (
                      <tr key={a.id} className="border-t border-slate-100 dark:border-slate-800 align-top">
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="font-medium text-slate-800 dark:text-slate-100">{a.hr_code}</span>
                          {a.name && a.name !== a.hr_code && (
                            <span className="text-slate-500 dark:text-slate-400"> - {first3(a.name)}</span>
                          )}
                          {a.team && <span className="text-slate-400 dark:text-slate-500"> - {a.team}</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <select
                            value={a.attendance ?? ""}
                            onChange={(e) =>
                              editAttendee(s.id, a.id, {
                                attendance: (e.target.value || null) as Attendance | null,
                              })
                            }
                            className={`rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-sm ${
                              statusStyle[a.attendance ?? ""]
                            }`}
                          >
                            <option value="">-- not marked --</option>
                            {STATUSES.map((st) => (
                              <option key={st} value={st}>{st}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2.5 w-[40%]">
                          <input
                            value={a.comment ?? ""}
                            onChange={(e) => editAttendee(s.id, a.id, { comment: e.target.value })}
                            placeholder="Reason / notes (late by..., absence reason, etc.)"
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm"
                          />
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <button
                            onClick={() => save(s, a)}
                            disabled={savingId === a.id}
                            className="rounded-lg bg-slate-900 text-white px-4 py-1.5 text-sm font-medium disabled:opacity-50"
                          >
                            {savingId === a.id ? "Saving..." : savedId === a.id ? "Saved" : "Save"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
