"use client";

import { useEffect, useMemo, useState } from "react";
import MultiSelectCombobox, { type MSOption } from "@/components/MultiSelectCombobox";
import { createClient } from "@/lib/supabase/client";

type Collector = { hr_code: string; name: string; team: string | null };

type BaseRow = {
  hr_code: string | null;
  collector_event: string | null;
  reviewer_event: string | null;
  total_count: number;
};
type ExtrasRow = {
  hr_code: string | null;
  extra_field: string | null;
  changed_from: string | null;
  changed_to: string | null;
  total_count: number;
};
type LvoRow = {
  hr_code: string | null;
  event: string | null;
  qualifier: string | null;
  live_reviewer_input: string | null;
  offline_collector_input: string | null;
  resolution: string | null;
  total_count: number;
};

type ViewMode = "base_extras" | "live_vs_offline";
type LvoSubView = "events" | "extras";

// v59: decode the offline/live TRUE/FALSE pair into human-readable meaning.
// Live is treated as authoritative.
function meaningOf(offline: string, live: string, resolution: string): string {
  if (resolution === "Both are wrong") return "Both are wrong";
  const l = live.toUpperCase();
  const o = offline.toUpperCase();
  if (l === "TRUE" && o === "FALSE") return "Collector missed";
  if (l === "FALSE" && o === "TRUE") return "Collector added extra";
  if (l === "TRUE" && o === "TRUE")  return "Both agreed";
  if (l === "FALSE" && o === "FALSE") return "Both said no";
  return "—";
}

// v59: Top Corrected Events — side-by-side Base + Extras. Aggregates by
// (original → corrected) pair. Shared filters: Team, Collectors, Assigned,
// Top-N. Sorted by count desc.
export default function TopEventsView({
  collectors,
}: {
  collectors: Collector[];
}) {
  const supabase = createClient();

  const [collectorFilter, setCollectorFilter] = useState<string[]>([]);
  const [teamFilter, setTeamFilter] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [topN, setTopN] = useState<string>("10");
  const [viewMode, setViewMode] = useState<ViewMode>("base_extras");
  const [lvoSubView, setLvoSubView] = useState<LvoSubView>("events");
  const [validationFilter, setValidationFilter] = useState<string[]>([]);
  const [baseRows, setBaseRows] = useState<BaseRow[]>([]);
  const [extrasRows, setExtrasRows] = useState<ExtrasRow[]>([]);
  const [lvoRows, setLvoRows] = useState<LvoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

  const teams = useMemo(() => {
    const s = new Set<string>();
    for (const c of collectors) if (c.team) s.add(c.team);
    return Array.from(s).sort();
  }, [collectors]);

  const collectorOptions: MSOption[] = useMemo(() => {
    const teamSet = new Set(teamFilter);
    return collectors
      .filter((c) => teamSet.size === 0 || (c.team && teamSet.has(c.team)))
      .map((c) => ({ value: c.hr_code, label: `${c.hr_code} - ${c.name}` }));
  }, [collectors, teamFilter]);

  const effectiveHrs = useMemo(() => {
    let set: string[] = collectorFilter;
    if (teamFilter.length > 0) {
      const teamSet = new Set(teamFilter);
      const teamHrs = collectors.filter((c) => c.team && teamSet.has(c.team)).map((c) => c.hr_code);
      set = set.length === 0 ? teamHrs : set.filter((h) => teamHrs.includes(h));
    }
    if (onlyMine && myAssigned.length > 0) {
      set = set.length === 0 ? myAssigned : set.filter((h) => myAssigned.includes(h));
    }
    return set;
  }, [collectorFilter, teamFilter, onlyMine, myAssigned, collectors]);

  // v59 fix: PostgREST caps a single request at 1000 rows regardless of
  // .limit(). Paginate with .range() until we've drained the result set,
  // otherwise Base/Extras totals get capped at ~1k and the header shows a
  // fraction of the true totals.
  async function fetchAll(table: string, cols: string, dateCol: string): Promise<any[]> {
    const PAGE = 1000;
    let start = 0;
    const out: any[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let q = supabase.from(table).select(cols).range(start, start + PAGE - 1);
      if (effectiveHrs.length > 0) q = q.in("hr_code", effectiveHrs);
      if (dateFrom) q = q.gte(dateCol, dateFrom);
      if (dateTo)   q = q.lte(dateCol, dateTo);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as any[];
      out.push(...batch);
      if (batch.length < PAGE) break;
      start += PAGE;
      if (start > 500000) break;
    }
    return out;
  }

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      if (viewMode === "base_extras") {
        const [bd, ed] = await Promise.all([
          fetchAll("base_events", "hr_code, collector_event, reviewer_event, total_count", "review_date"),
          fetchAll("extras_events", "hr_code, extra_field, changed_from, changed_to, total_count", "review_date"),
        ]);
        setBaseRows(bd as any);
        setExtrasRows(ed as any);
        setLvoRows([]);
      } else {
        const ld = await fetchAll(
          "live_vs_offline",
          "hr_code, event, qualifier, live_reviewer_input, offline_collector_input, resolution, total_count",
          "match_date"
        );
        setLvoRows(ld as any);
        setBaseRows([]);
        setExtrasRows([]);
      }
    } catch (e: any) {
      setErr(e.message);
      setBaseRows([]); setExtrasRows([]); setLvoRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveHrs, dateFrom, dateTo, viewMode]);

  const nTop = (() => {
    const n = parseInt(topN, 10);
    return Number.isFinite(n) && n > 0 ? n : Infinity;
  })();

  const baseAgg = useMemo(() => {
    const map = new Map<string, { from: string; to: string; count: number }>();
    for (const r of baseRows) {
      const from = (r.collector_event ?? "").trim() || "(blank)";
      const to = (r.reviewer_event ?? "").trim() || "(blank)";
      const key = `${from}||${to}`;
      const cur = map.get(key);
      const add = Number(r.total_count ?? 0);
      if (cur) cur.count += add;
      else map.set(key, { from, to, count: add });
    }
    const arr = Array.from(map.values()).sort((a, b) => b.count - a.count);
    return arr.slice(0, nTop);
  }, [baseRows, nTop]);

  // Live vs Offline: rank (event, qualifier, offline_input → live_input) pairs.
  const lvoFiltered = useMemo(() => {
    if (validationFilter.length === 0) return lvoRows;
    const vset = new Set(validationFilter);
    return lvoRows.filter((r) => vset.has((r.resolution ?? "").trim()));
  }, [lvoRows, validationFilter]);

  const lvoAgg = useMemo(() => {
    // events sub-view: group by (event, offline, live, resolution) — drop qualifier.
    // extras sub-view: group by (event, qualifier, offline, live, resolution).
    const map = new Map<string, { event: string; qualifier: string; offline: string; live: string; resolution: string; meaning: string; count: number }>();
    for (const r of lvoFiltered) {
      const event = (r.event ?? "").trim() || "(blank)";
      const qualifier = (r.qualifier ?? "").trim() || "—";
      const offline = (r.offline_collector_input ?? "").trim() || "—";
      const live = (r.live_reviewer_input ?? "").trim() || "—";
      const resolution = (r.resolution ?? "").trim() || "—";
      const meaning = meaningOf(offline, live, resolution);
      const key = lvoSubView === "events"
        ? `${event}||${offline}||${live}||${resolution}`
        : `${event}||${qualifier}||${offline}||${live}||${resolution}`;
      const cur = map.get(key);
      const add = Number(r.total_count ?? 0);
      if (cur) cur.count += add;
      else map.set(key, { event, qualifier, offline, live, resolution, meaning, count: add });
    }
    const arr = Array.from(map.values()).sort((a, b) => b.count - a.count);
    return arr.slice(0, nTop);
  }, [lvoFiltered, nTop, lvoSubView]);

  const lvoTotal = useMemo(
    () => lvoFiltered.reduce((s, r) => s + Number(r.total_count ?? 0), 0),
    [lvoFiltered]
  );
  const lvoPairCount = useMemo(() => {
    const s = new Set<string>();
    for (const r of lvoFiltered) {
      const ev = (r.event ?? "").trim();
      const off = (r.offline_collector_input ?? "").trim();
      const liv = (r.live_reviewer_input ?? "").trim();
      const qual = (r.qualifier ?? "").trim();
      s.add(lvoSubView === "events" ? `${ev}||${off}||${liv}` : `${ev}||${qual}||${off}||${liv}`);
    }
    return s.size;
  }, [lvoFiltered, lvoSubView]);

  const resolutionOptions: MSOption[] = useMemo(() => {
    const s = new Set<string>();
    for (const r of lvoRows) if (r.resolution) s.add(r.resolution.trim());
    return Array.from(s).sort().map((v) => ({ value: v, label: v }));
  }, [lvoRows]);

  const extrasAgg = useMemo(() => {
    const map = new Map<string, { field: string; from: string; to: string; count: number }>();
    for (const r of extrasRows) {
      const field = (r.extra_field ?? "").trim() || "—";
      const from = (r.changed_from ?? "").trim() || "(blank)";
      const to = (r.changed_to ?? "").trim() || "(blank)";
      const key = `${field}||${from}||${to}`;
      const cur = map.get(key);
      const add = Number(r.total_count ?? 0);
      if (cur) cur.count += add;
      else map.set(key, { field, from, to, count: add });
    }
    const arr = Array.from(map.values()).sort((a, b) => b.count - a.count);
    return arr.slice(0, nTop);
  }, [extrasRows, nTop]);

  // v59 fix: totals must sum ALL fetched rows, not just the top-N slice.
  // Otherwise the "Total Errors" number shrank when Top N was set.
  const baseTotal = useMemo(
    () => baseRows.reduce((s, r) => s + Number(r.total_count ?? 0), 0),
    [baseRows]
  );
  const extrasTotal = useMemo(
    () => extrasRows.reduce((s, r) => s + Number(r.total_count ?? 0), 0),
    [extrasRows]
  );
  const basePairCount = useMemo(() => {
    const s = new Set<string>();
    for (const r of baseRows) {
      s.add(`${(r.collector_event ?? "").trim()}||${(r.reviewer_event ?? "").trim()}`);
    }
    return s.size;
  }, [baseRows]);
  const extrasPairCount = useMemo(() => {
    const s = new Set<string>();
    for (const r of extrasRows) {
      s.add(`${(r.extra_field ?? "").trim()}||${(r.changed_from ?? "").trim()}||${(r.changed_to ?? "").trim()}`);
    }
    return s.size;
  }, [extrasRows]);

  const inputCls =
    "rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-900 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Top Corrected Events</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          Original → corrected pairs ranked by frequency. Base events on the
          left, Extras on the right. Filters apply to both.
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap gap-3 items-end">
        <div className="w-52">
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Teams</label>
          <MultiSelectCombobox
            options={teams.map((t) => ({ value: t, label: t }))}
            values={teamFilter}
            onApply={(next) => {
              setTeamFilter(next);
              if (next.length > 0 && collectorFilter.length > 0) {
                const allowed = new Set(
                  collectors.filter((c) => c.team && next.includes(c.team)).map((c) => c.hr_code)
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
            options={collectorOptions}
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
              <span>Only my assigned active collectors ({myAssigned.length})</span>
            </label>
          </div>
        )}
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Top N</label>
          <input
            type="number"
            min={1}
            value={topN}
            onChange={(e) => setTopN(e.target.value)}
            placeholder="All"
            className={`${inputCls} w-24`}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">View</label>
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as ViewMode)}
            className={inputCls}
          >
            <option value="base_extras">Base / Extras</option>
            <option value="live_vs_offline">Live vs. Offline</option>
          </select>
        </div>
        {viewMode === "live_vs_offline" && (
          <>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Sub-view</label>
              <select value={lvoSubView} onChange={(e) => setLvoSubView(e.target.value as LvoSubView)} className={inputCls}>
                <option value="events">Events</option>
                <option value="extras">Extras (with qualifier)</option>
              </select>
            </div>
            <div className="w-52">
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Validation</label>
              <MultiSelectCombobox
                options={resolutionOptions}
                values={validationFilter}
                onApply={setValidationFilter}
                placeholder="All (Live right + Both are wrong)"
              />
            </div>
          </>
        )}
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      {viewMode === "live_vs_offline" ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-baseline justify-between">
            <h2 className="font-semibold">Live vs. Offline</h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {loading ? "…" : `showing ${lvoAgg.length} of ${lvoPairCount} pair(s) · ${lvoTotal.toLocaleString()} total`}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Event</th>
                  {lvoSubView === "extras" && (
                    <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Qualifier</th>
                  )}
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Offline</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Live</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Meaning</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Resolution</th>
                  <th className="text-right font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Count</th>
                </tr>
              </thead>
              <tbody>
                {lvoAgg.length === 0 ? (
                  <tr>
                    <td colSpan={lvoSubView === "extras" ? 7 : 6} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                      {loading ? "" : "No rows — upload Live vs. Offline data first."}
                    </td>
                  </tr>
                ) : (
                  lvoAgg.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 font-medium">{r.event}</td>
                      {lvoSubView === "extras" && (
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{r.qualifier}</td>
                      )}
                      <td className="px-3 py-2 text-rose-700 dark:text-rose-300 font-medium">{r.offline}</td>
                      <td className="px-3 py-2 text-emerald-700 dark:text-emerald-300 font-medium">{r.live}</td>
                      <td className={`px-3 py-2 font-medium ${
                        r.meaning === "Collector missed" ? "text-red-700 dark:text-red-300" :
                        r.meaning === "Collector added extra" ? "text-amber-700 dark:text-amber-300" :
                        r.meaning === "Both are wrong" ? "text-amber-700 dark:text-amber-300" :
                        "text-slate-500 dark:text-slate-400"
                      }`}>{r.meaning}</td>
                      <td className={`px-3 py-2 ${r.resolution === "Both are wrong" ? "text-amber-700 dark:text-amber-300" : "text-slate-500 dark:text-slate-400"}`}>{r.resolution}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.count.toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-baseline justify-between">
            <h2 className="font-semibold">Events (Base)</h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {loading ? "…" : `showing ${baseAgg.length} of ${basePairCount} pair(s) · ${baseTotal.toLocaleString()} total errors`}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Collector Event</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Reviewer Event</th>
                  <th className="text-right font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Count</th>
                </tr>
              </thead>
              <tbody>
                {baseAgg.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                      {loading ? "" : "No rows."}
                    </td>
                  </tr>
                ) : (
                  baseAgg.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 text-rose-700 dark:text-rose-300 font-medium">{r.from}</td>
                      <td className="px-3 py-2 text-emerald-700 dark:text-emerald-300 font-medium">{r.to}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.count.toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-baseline justify-between">
            <h2 className="font-semibold">Extras</h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {loading ? "…" : `showing ${extrasAgg.length} of ${extrasPairCount} pair(s) · ${extrasTotal.toLocaleString()} total errors`}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Extra Field</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Changed From</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Changed To</th>
                  <th className="text-right font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Count</th>
                </tr>
              </thead>
              <tbody>
                {extrasAgg.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                      {loading ? "" : "No rows."}
                    </td>
                  </tr>
                ) : (
                  extrasAgg.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{r.field}</td>
                      <td className="px-3 py-2 text-rose-700 dark:text-rose-300 font-medium">{r.from}</td>
                      <td className="px-3 py-2 text-emerald-700 dark:text-emerald-300 font-medium">{r.to}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.count.toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
