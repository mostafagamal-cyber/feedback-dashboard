"use client";

import { useState } from "react";

type Target =
  | "module_totals"
  | "quality_scores"
  | "freeze_frame_scores"
  | "weekly_quality_scores"
  | "base_events"
  | "extras_events"
  | "live_vs_offline";

type Mode = "date" | "month" | "range";

// v59: Admin-only widget for wiping uploaded rows for a specific date /
// month / range on a chosen table. Renders as a collapsible red-tinted
// panel so admins understand this is a destructive operation.

export default function UploadDeleteWidget({
  target,
  title,
  modules,
  moduleLabel = "Module",
}: {
  target: Target;
  title: string;
  // If provided, admin can additionally scope the delete to a single module.
  modules?: { value: string; label: string }[];
  moduleLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("month");
  const [date, setDate] = useState("");
  const [month, setMonth] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [module_, setModule] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function run() {
    setResult(null);
    const label =
      mode === "date"
        ? `${date}`
        : mode === "month"
        ? `${month}`
        : `${from} → ${to}`;
    const moduleHint = module_ ? ` for module "${module_}"` : "";
    if (
      !confirm(
        `Delete every row on ${title} for ${label}${moduleHint}?\n\nThis cannot be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/delete-uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          mode,
          date: mode === "date" ? date : undefined,
          month: mode === "month" ? month : undefined,
          from: mode === "range" ? from : undefined,
          to: mode === "range" ? to : undefined,
          module: module_ || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Delete failed");
      setResult({
        type: "ok",
        text: `Deleted ${j.deleted ?? 0} row(s).`,
      });
    } catch (e: any) {
      setResult({ type: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-900 text-sm";

  return (
    <div className="mt-6 rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/20 p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-semibold text-red-700 dark:text-red-300"
      >
        {open ? "▾ Delete uploaded data" : "▸ Delete uploaded data"}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-red-700/80 dark:text-red-300/80">
            Admin-only. Wipes rows from <code>{target}</code> matching the
            filter below. Cannot be undone.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Scope</label>
              <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={inputCls}>
                <option value="date">Specific date</option>
                <option value="month">Specific month</option>
                <option value="range">Date range</option>
              </select>
            </div>
            {mode === "date" && (
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
              </div>
            )}
            {mode === "month" && (
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Month</label>
                <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls} />
              </div>
            )}
            {mode === "range" && (
              <>
                <div>
                  <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">From</label>
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">To</label>
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
                </div>
              </>
            )}
            {modules && modules.length > 0 && (
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">{moduleLabel} (optional)</label>
                <select value={module_} onChange={(e) => setModule(e.target.value)} className={inputCls}>
                  <option value="">All modules</option>
                  {modules.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            )}
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="rounded-lg bg-red-600 text-white px-4 py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
          {result && (
            <p className={`text-sm ${result.type === "ok" ? "text-emerald-600" : "text-red-600"}`}>
              {result.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
