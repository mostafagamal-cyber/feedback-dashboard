"use client";

import { useState } from "react";
import UploadDeleteWidget from "@/components/UploadDeleteWidget";

// v59: Admin-only Live vs Offline uploader. API enforces role.
export default function LiveVsOfflineUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok?: boolean; inserted?: number; error?: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/live-vs-offline-upload", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setResult(data);
    setUploading(false);
    if (data.ok) setFile(null);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Live vs. Offline Upload</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          Upload the per-event Live vs. Offline comparison sheet. Live is
          treated as the correct value (offline collectors are being reviewed
          against it). Expected columns:
          <br />
          <code className="text-xs">
            match_date, match_id, offline_collector_hrcode, part_id, event,
            offline_event_type, jersey, qualifier, live_reviewer_input,
            offline_collector_input, resolution, Total Count
          </code>
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-5"
      >
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">CSV / TSV file</label>
          <input
            type="file"
            accept=".csv,.tsv,.txt"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600 dark:text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:text-white file:px-4 file:py-2 file:text-sm cursor-pointer"
          />
          {file && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{file.name}</p>}
        </div>

        <button
          type="submit"
          disabled={!file || uploading}
          className="w-full rounded-lg bg-slate-900 text-white py-2 font-medium disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Upload Live vs. Offline"}
        </button>

        {result && (
          <div className={`rounded-lg p-4 text-sm ${result.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            {result.ok ? <p className="font-semibold">Inserted {result.inserted} rows.</p> : <p>{result.error}</p>}
          </div>
        )}
      </form>

      <UploadDeleteWidget target="live_vs_offline" title="Live vs. Offline" />
    </div>
  );
}
