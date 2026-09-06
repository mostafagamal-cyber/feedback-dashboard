"use client";

import { useEffect, useMemo, useState } from "react";
import MultiSelectCombobox, { type MSOption } from "@/components/MultiSelectCombobox";
import { createClient } from "@/lib/supabase/client";

type Collector = { hr_code: string; name: string; team: string | null };

type BaseRow = {
  review_date: string | null;
  match_id: string | null;
  part_id: number | null;
  hr_code: string | null;
  collector_event: string | null;
  reviewer_event: string | null;
  total_count: number;
};
type ExtrasRow = {
  review_date: string | null;
  match_id: string | null;
  part_id: number | null;
  hr_code: string | null;
  extra_field: string | null;
  changed_from: string | null;
  changed_to: string | null;
  total_count: number;
};
type LvoRow = {
  match_date: string | null;
  match_id: string | null;
  part_id: number | null;
  hr_code: string | null;
  event: string | null;
  qualifier: string | null;
  jersey: string | null;
  live_reviewer_input: string | null;
  offline_collector_input: string | null;
  resolution: string | null;
  total_count: number;
};
type ViewMode = "base_extras" | "live_vs_offline";
type LvoSubView = "events" | "extras";

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

// v59: Event Matches — same layout as Top Corrected Events but rows are
// grouped by Match ID (one row per match), sorted by total corrections desc.
export default function EventMatchesView({
  collectors,
}: {
  collectors: Collector[];
}) {
  const supabase = createClient();

  const [collectorFilter, setCollectorFilter] = useState<string[]>([]);
  const [teamFilter, setTeamFilter] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [colEventFilter, setColEventFilter] = useState<string[]>([]);
  const [revEventFilter, setRevEventFilter] = useState<string[]>([]);
  const [changedFromFilter, setChangedFromFilter] = useState<string[]>([]);
  const [changedToFilter, setChangedToFilter] = useState<string[]>([]);
  const [matchIdFilter, setMatchIdFilter] = useState<string>("");
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

  // v59 fix: PostgREST returns at most 1000 rows per request — paginate.
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
          fetchAll("base_events", "review_date, match_id, part_id, hr_code, collector_event, reviewer_event, total_count", "review_date"),
          fetchAll("extras_events", "review_date, match_id, part_id, hr_code, extra_field, changed_from, changed_to, total_count", "review_date"),
        ]);
        setBaseRows(bd as any);
        setExtrasRows(ed as any);
        setLvoRows([]);
      } else {
        const ld = await fetchAll(
          "live_vs_offline",
          "match_date, match_id, part_id, hr_code, event, qualifier, jersey, live_reviewer_input, offline_collector_input, resolution, total_count",
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

  // Base: one row per (match_id, collector_event → reviewer_event). Sorted
  // by match count desc, then by pair count desc within a match.
  // Distinct values per column. Include a "(blank)" pseudo-option if any
  // row has an empty value there — lets the user filter for rows where the
  // reviewer OR collector event was left empty.
  const BLANK = "__blank__";
  const distinct = (rows: any[], key: string): MSOption[] => {
    const s = new Set<string>();
    let hasBlank = false;
    for (const r of rows) {
      const v = (r?.[key] ?? "").toString().trim();
      if (v) s.add(v);
      else hasBlank = true;
    }
    const opts = Array.from(s).sort().map((v) => ({ value: v, label: v }));
    if (hasBlank) opts.unshift({ value: BLANK, label: "(blank)" });
    return opts;
  };
  const colEventOptions   = useMemo(() => distinct(baseRows, "collector_event"), [baseRows]);
  const revEventOptions   = useMemo(() => distinct(baseRows, "reviewer_event"), [baseRows]);
  const changedFromOptions = useMemo(() => distinct(extrasRows, "changed_from"), [extrasRows]);
  const changedToOptions   = useMemo(() => distinct(extrasRows, "changed_to"), [extrasRows]);

  const baseAgg = useMemo(() => {
    type Pair = { from: string; to: string; count: number };
    type MatchGroup = { key: string; review_date: string; match_id: string; part_id: string; total: number; pairs: Pair[] };
    const groups = new Map<string, MatchGroup>();
    const colSet = new Set(colEventFilter);
    const revSet = new Set(revEventFilter);
    const midQ = matchIdFilter.trim().toLowerCase();
    const inSel = (set: Set<string>, v: string) =>
      set.size === 0 || set.has(v) || (v === "" && set.has(BLANK));
    for (const r of baseRows) {
      const ce = (r.collector_event ?? "").trim();
      const re = (r.reviewer_event ?? "").trim();
      if (!inSel(colSet, ce)) continue;
      if (!inSel(revSet, re)) continue;
      if (midQ && !((r.match_id ?? "").toString().toLowerCase().includes(midQ))) continue;
      const date = (r.review_date ?? "").trim() || "—";
      const mid = (r.match_id ?? "").trim() || "(no match id)";
      const pid = r.part_id == null ? "—" : String(r.part_id);
      const key = `${date}||${mid}||${pid}`;
      const from = (r.collector_event ?? "").trim() || "(blank)";
      const to = (r.reviewer_event ?? "").trim() || "(blank)";
      const add = Number(r.total_count ?? 0);
      let g = groups.get(key);
      if (!g) { g = { key, review_date: date, match_id: mid, part_id: pid, total: 0, pairs: [] }; groups.set(key, g); }
      g.total += add;
      const p = g.pairs.find((x) => x.from === from && x.to === to);
      if (p) p.count += add;
      else g.pairs.push({ from, to, count: add });
    }
    const arr = Array.from(groups.values());
    for (const g of arr) g.pairs.sort((a, b) => b.count - a.count);
    arr.sort((a, b) => b.total - a.total);
    const flat: { review_date: string; match_id: string; part_id: string; total: number; from: string; to: string; count: number; first: boolean; span: number }[] = [];
    for (const g of arr) {
      g.pairs.forEach((p, i) => flat.push({
        review_date: g.review_date, match_id: g.match_id, part_id: g.part_id, total: g.total,
        from: p.from, to: p.to, count: p.count,
        first: i === 0, span: g.pairs.length,
      }));
    }
    return { flat, groupCount: arr.length, total: arr.reduce((s, g) => s + g.total, 0) };
  }, [baseRows, colEventFilter, revEventFilter, matchIdFilter]);

  // Extras: same, but pair = (extra_field, changed_from → changed_to).
  const extrasAgg = useMemo(() => {
    type Pair = { field: string; from: string; to: string; count: number };
    type MatchGroup = { key: string; review_date: string; match_id: string; part_id: string; total: number; pairs: Pair[] };
    const groups = new Map<string, MatchGroup>();
    const fromSet = new Set(changedFromFilter);
    const toSet = new Set(changedToFilter);
    const midQ = matchIdFilter.trim().toLowerCase();
    const inSel = (set: Set<string>, v: string) =>
      set.size === 0 || set.has(v) || (v === "" && set.has(BLANK));
    for (const r of extrasRows) {
      const cf = (r.changed_from ?? "").trim();
      const ct = (r.changed_to ?? "").trim();
      if (!inSel(fromSet, cf)) continue;
      if (!inSel(toSet, ct)) continue;
      if (midQ && !((r.match_id ?? "").toString().toLowerCase().includes(midQ))) continue;
      const date = (r.review_date ?? "").trim() || "—";
      const mid = (r.match_id ?? "").trim() || "(no match id)";
      const pid = r.part_id == null ? "—" : String(r.part_id);
      const key = `${date}||${mid}||${pid}`;
      const field = (r.extra_field ?? "").trim() || "—";
      const from = (r.changed_from ?? "").trim() || "(blank)";
      const to = (r.changed_to ?? "").trim() || "(blank)";
      const add = Number(r.total_count ?? 0);
      let g = groups.get(key);
      if (!g) { g = { key, review_date: date, match_id: mid, part_id: pid, total: 0, pairs: [] }; groups.set(key, g); }
      g.total += add;
      const p = g.pairs.find((x) => x.field === field && x.from === from && x.to === to);
      if (p) p.count += add;
      else g.pairs.push({ field, from, to, count: add });
    }
    const arr = Array.from(groups.values());
    for (const g of arr) g.pairs.sort((a, b) => b.count - a.count);
    arr.sort((a, b) => b.total - a.total);
    const flat: { review_date: string; match_id: string; part_id: string; total: number; field: string; from: string; to: string; count: number; first: boolean; span: number }[] = [];
    for (const g of arr) {
      g.pairs.forEach((p, i) => flat.push({
        review_date: g.review_date, match_id: g.match_id, part_id: g.part_id, total: g.total,
        field: p.field, from: p.from, to: p.to, count: p.count,
        first: i === 0, span: g.pairs.length,
      }));
    }
    return { flat, groupCount: arr.length, total: arr.reduce((s, g) => s + g.total, 0) };
  }, [extrasRows, changedFromFilter, changedToFilter, matchIdFilter]);

  const baseTotal = baseAgg.total;
  const extrasTotal = extrasAgg.total;

  // Live vs Offline: group by (match_date, match_id, part_id), sub-rows by
  // (event, qualifier, jersey, offline_input, live_input, resolution).
  const lvoFiltered = useMemo(() => {
    if (validationFilter.length === 0) return lvoRows;
    const vset = new Set(validationFilter);
    return lvoRows.filter((r) => vset.has((r.resolution ?? "").trim()));
  }, [lvoRows, validationFilter]);

  const lvoAgg = useMemo(() => {
    type Item = { event: string; qualifier: string; jersey: string; offline: string; live: string; resolution: string; meaning: string; count: number };
    type MatchGroup = { key: string; match_date: string; match_id: string; part_id: string; total: number; items: Item[] };
    const groups = new Map<string, MatchGroup>();
    const midQ = matchIdFilter.trim().toLowerCase();
    for (const r of lvoFiltered) {
      if (midQ && !((r.match_id ?? "").toString().toLowerCase().includes(midQ))) continue;
      const date = (r.match_date ?? "").trim() || "—";
      const mid = (r.match_id ?? "").trim() || "(no match id)";
      const pid = r.part_id == null ? "—" : String(r.part_id);
      const event = (r.event ?? "").trim() || "(blank)";
      const qualifier = (r.qualifier ?? "").trim() || "—";
      const jersey = (r.jersey ?? "").trim() || "—";
      const offline = (r.offline_collector_input ?? "").trim() || "—";
      const live = (r.live_reviewer_input ?? "").trim() || "—";
      const resolution = (r.resolution ?? "").trim() || "—";
      const meaning = meaningOf(offline, live, resolution);
      const gkey = `${date}||${mid}||${pid}`;
      let g = groups.get(gkey);
      if (!g) { g = { key: gkey, match_date: date, match_id: mid, part_id: pid, total: 0, items: [] }; groups.set(gkey, g); }
      const add = Number(r.total_count ?? 0);
      g.total += add;
      // Events sub-view: dedupe by (event, offline, live, resolution) — jersey/qualifier
      // are ignored so multiple rows for the same event collapse.
      // Extras sub-view: include qualifier + jersey.
      const dupe = lvoSubView === "events"
        ? g.items.find((x) => x.event === event && x.offline === offline && x.live === live && x.resolution === resolution)
        : g.items.find((x) => x.event === event && x.qualifier === qualifier && x.jersey === jersey && x.offline === offline && x.live === live && x.resolution === resolution);
      if (dupe) dupe.count += add;
      else g.items.push({ event, qualifier, jersey, offline, live, resolution, meaning, count: add });
    }
    const arr = Array.from(groups.values());
    for (const g of arr) g.items.sort((a, b) => b.count - a.count);
    arr.sort((a, b) => b.total - a.total);
    const flat: { match_date: string; match_id: string; part_id: string; total: number; event: string; qualifier: string; jersey: string; offline: string; live: string; resolution: string; meaning: string; count: number; first: boolean; span: number }[] = [];
    for (const g of arr) {
      g.items.forEach((it, i) => flat.push({
        match_date: g.match_date, match_id: g.match_id, part_id: g.part_id, total: g.total,
        ...it, first: i === 0, span: g.items.length,
      }));
    }
    return { flat, groupCount: arr.length, total: arr.reduce((s, g) => s + g.total, 0) };
  }, [lvoFiltered, matchIdFilter, lvoSubView]);

  const resolutionOptions: MSOption[] = useMemo(() => {
    const s = new Set<string>();
    for (const r of lvoRows) if (r.resolution) s.add(r.resolution.trim());
    return Array.from(s).sort().map((v) => ({ value: v, label: v }));
  }, [lvoRows]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Event Matches</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          Corrections grouped by Match ID. Base events on the left, Extras on
          the right. Filters apply to both.
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
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-900 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-900 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Match ID</label>
          <input type="text" value={matchIdFilter} onChange={(e) => setMatchIdFilter(e.target.value)}
            placeholder="contains…"
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-900 text-sm w-40" />
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
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">View</label>
          <select value={viewMode} onChange={(e) => setViewMode(e.target.value as ViewMode)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-900 text-sm">
            <option value="base_extras">Base / Extras</option>
            <option value="live_vs_offline">Live vs. Offline</option>
          </select>
        </div>
        {viewMode === "live_vs_offline" && (
          <>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Sub-view</label>
              <select value={lvoSubView} onChange={(e) => setLvoSubView(e.target.value as LvoSubView)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-900 text-sm">
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
                placeholder="All"
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
              {loading ? "…" : `${lvoAgg.groupCount} match(es) · ${lvoAgg.total.toLocaleString()} total`}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Date</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Match ID</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Part</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Event</th>
                  {lvoSubView === "extras" && (<>
                    <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Qualifier</th>
                    <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Jersey</th>
                  </>)}
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Offline</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Live</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Meaning</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Resolution</th>
                  <th className="text-right font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Count</th>
                </tr>
              </thead>
              <tbody>
                {lvoAgg.flat.length === 0 ? (
                  <tr><td colSpan={lvoSubView === "extras" ? 11 : 9} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">{loading ? "" : "No rows."}</td></tr>
                ) : (
                  lvoAgg.flat.map((r, i) => (
                    <tr key={i} className={r.first ? "border-t-2 border-slate-200 dark:border-slate-700" : "border-t border-slate-100 dark:border-slate-800"}>
                      {r.first ? (
                        <td rowSpan={r.span} className="px-3 py-2 tabular-nums align-top bg-slate-50/50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300">{r.match_date}</td>
                      ) : null}
                      {r.first ? (
                        <td rowSpan={r.span} className="px-3 py-2 font-medium align-top bg-slate-50/50 dark:bg-slate-800/40">
                          <div>{r.match_id}</div>
                          <div className="text-xs text-slate-400 tabular-nums">{r.total.toLocaleString()}</div>
                        </td>
                      ) : null}
                      {r.first ? (
                        <td rowSpan={r.span} className="px-3 py-2 tabular-nums align-top bg-slate-50/50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300">{r.part_id}</td>
                      ) : null}
                      <td className="px-3 py-2 font-medium">{r.event}</td>
                      {lvoSubView === "extras" && (<>
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{r.qualifier}</td>
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{r.jersey}</td>
                      </>)}
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
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-semibold">Events (Base)</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-52">
                <MultiSelectCombobox
                  options={colEventOptions}
                  values={colEventFilter}
                  onApply={setColEventFilter}
                  placeholder="Collector Event"
                />
              </div>
              <div className="w-52">
                <MultiSelectCombobox
                  options={revEventOptions}
                  values={revEventFilter}
                  onApply={setRevEventFilter}
                  placeholder="Reviewer Event"
                />
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {loading ? "…" : `${baseAgg.groupCount} · ${baseTotal.toLocaleString()}`}
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Date</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Match ID</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Part</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Collector Event</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Reviewer Event</th>
                  <th className="text-right font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Count</th>
                </tr>
              </thead>
              <tbody>
                {baseAgg.flat.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                      {loading ? "" : "No rows."}
                    </td>
                  </tr>
                ) : (
                  baseAgg.flat.map((r, i) => (
                    <tr key={i} className={r.first ? "border-t-2 border-slate-200 dark:border-slate-700" : "border-t border-slate-100 dark:border-slate-800"}>
                      {r.first ? (
                        <td rowSpan={r.span} className="px-3 py-2 tabular-nums align-top bg-slate-50/50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300">
                          {r.review_date}
                        </td>
                      ) : null}
                      {r.first ? (
                        <td rowSpan={r.span} className="px-3 py-2 font-medium align-top bg-slate-50/50 dark:bg-slate-800/40">
                          <div>{r.match_id}</div>
                          <div className="text-xs text-slate-400 tabular-nums">{r.total.toLocaleString()}</div>
                        </td>
                      ) : null}
                      {r.first ? (
                        <td rowSpan={r.span} className="px-3 py-2 tabular-nums align-top bg-slate-50/50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300">
                          {r.part_id}
                        </td>
                      ) : null}
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
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-semibold">Extras</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-52">
                <MultiSelectCombobox
                  options={changedFromOptions}
                  values={changedFromFilter}
                  onApply={setChangedFromFilter}
                  placeholder="Changed From"
                />
              </div>
              <div className="w-52">
                <MultiSelectCombobox
                  options={changedToOptions}
                  values={changedToFilter}
                  onApply={setChangedToFilter}
                  placeholder="Changed To"
                />
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {loading ? "…" : `${extrasAgg.groupCount} · ${extrasTotal.toLocaleString()}`}
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Date</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Match ID</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Part</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Extra Field</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Changed From</th>
                  <th className="text-left font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Changed To</th>
                  <th className="text-right font-medium text-slate-500 dark:text-slate-400 px-3 py-2">Count</th>
                </tr>
              </thead>
              <tbody>
                {extrasAgg.flat.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                      {loading ? "" : "No rows."}
                    </td>
                  </tr>
                ) : (
                  extrasAgg.flat.map((r, i) => (
                    <tr key={i} className={r.first ? "border-t-2 border-slate-200 dark:border-slate-700" : "border-t border-slate-100 dark:border-slate-800"}>
                      {r.first ? (
                        <td rowSpan={r.span} className="px-3 py-2 tabular-nums align-top bg-slate-50/50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300">
                          {r.review_date}
                        </td>
                      ) : null}
                      {r.first ? (
                        <td rowSpan={r.span} className="px-3 py-2 font-medium align-top bg-slate-50/50 dark:bg-slate-800/40">
                          <div>{r.match_id}</div>
                          <div className="text-xs text-slate-400 tabular-nums">{r.total.toLocaleString()}</div>
                        </td>
                      ) : null}
                      {r.first ? (
                        <td rowSpan={r.span} className="px-3 py-2 tabular-nums align-top bg-slate-50/50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300">
                          {r.part_id}
                        </td>
                      ) : null}
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
