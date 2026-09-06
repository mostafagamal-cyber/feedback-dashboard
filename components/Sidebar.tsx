"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ThemeToggle from "@/components/ThemeToggle";

export type AppRole =
  | "Admin"
  | "Reviewer"
  | "Viewer"
  | "TeamLeader"
  | "Supervisor"
  | "QualityLeader"
  | "OCTeamLeader";

const roleLabel = (role: AppRole): string => {
  const map: Record<AppRole, string> = {
    Admin: "Admin",
    Reviewer: "Reviewer",
    Viewer: "Collector",
    TeamLeader: "Team Leader",
    Supervisor: "Supervisor",
    QualityLeader: "Quality Leader",
    OCTeamLeader: "OC Team Leader",
  };
  return map[role] ?? role;
};

type NavItem = { href: string; label: string };
type NavEntry =
  | { type: "link"; href: string; label: string }
  | { type: "group"; key: string; label: string; items: NavItem[] };

function buildNav(role: AppRole): NavEntry[] {
  // v59: OC Team Leader gets the same nav as Collector (Viewer). Pages
  // widen the hr_code scope from self to whole squad via getTeamHrCodes().
  if (role === "Viewer" || role === "OCTeamLeader") {
    return [
      { type: "link", href: "/analytics", label: role === "OCTeamLeader" ? "Team Overview" : "Home" },
      { type: "link", href: "/my-reports", label: role === "OCTeamLeader" ? "Team Reports" : "My Reports" },
      { type: "link", href: "/my-sessions", label: role === "OCTeamLeader" ? "Team Sessions" : "My Sessions" },
      { type: "link", href: "/my-matches", label: role === "OCTeamLeader" ? "Team Match Details" : "My Match Details" },
      { type: "link", href: "/my-inquiries", label: role === "OCTeamLeader" ? "Team Inquiries" : "Ask a Question" },
      { type: "link", href: "/my-presentations", label: "Presentations" },
      { type: "link", href: "/my-quizzes", label: "Quizzes" },
      { type: "link", href: "/quality-score", label: "Quality Score" },
      { type: "link", href: "/weekly-quality-score", label: "Weekly Quality Score" },
    ];
  }

  const entries: NavEntry[] = [
    { type: "link", href: "/dashboard", label: "Home" },
    {
      type: "group",
      key: "performance",
      label: "Performance",
      items: [
        { href: "/analytics", label: "Collectors Performance" },
        { href: "/match-totals", label: "Match Total Per Module" },
        { href: "/quality-score", label: "Quality Score" },
        { href: "/weekly-quality-score", label: "Weekly Quality Score" },
        { href: "/performance-thresholds", label: "Performance Thresholds" },
        // v59: per-event views built on base_events / extras_events.
        { href: "/top-events", label: "Top Corrected Events" },
        { href: "/event-matches", label: "Event Matches" },
      ],
    },
  ];

  const uploadItems: NavItem[] = [];
  // v59: Only Module Data is Admin-only per product request. Send Report,
  // Presentations, and Quizzes stay available to Reviewer.
  if (role === "Admin") uploadItems.push({ href: "/module-upload", label: "Module Data" });
  // v59: Base/Extras Final per-event upload (Admin-only).
  if (role === "Admin") uploadItems.push({ href: "/events-upload", label: "Event Details (Base/Extras)" });
  // v59: Live vs. Offline per-event comparison (Admin-only).
  if (role === "Admin") uploadItems.push({ href: "/live-vs-offline-upload", label: "Live vs. Offline" });
  if (role === "Admin" || role === "QualityLeader") uploadItems.push({ href: "/quality-upload", label: "Quality Score Upload" });
  if (role === "Admin" || role === "QualityLeader") uploadItems.push({ href: "/weekly-quality-upload", label: "Weekly Quality Score Upload" });
  if (role === "Admin" || role === "Reviewer") uploadItems.push({ href: "/upload", label: "Send Report" });
  if (role === "Admin" || role === "Reviewer" || role === "Supervisor") {
    uploadItems.push({ href: "/admin-presentations", label: "Presentations" });
  }
  if (role === "Admin" || role === "Reviewer" || role === "Supervisor") {
    uploadItems.push({ href: "/admin-quizzes", label: "Quizzes" });
  }
  if (uploadItems.length > 0) {
    entries.push({ type: "group", key: "upload", label: "Upload Data", items: uploadItems });
  }

  if (role === "Admin" || role === "Reviewer" || role === "Supervisor") {
    const feedbackItems: NavItem[] = [];
    if (role !== "Admin") feedbackItems.push({ href: "/feedback-progress", label: "Feedback Progress" });
    feedbackItems.push({ href: "/feedback-reservation", label: "Feedback Reservations" });
    entries.push({ type: "group", key: "feedback", label: "Feedback", items: feedbackItems });
  }

  // v59: Reviewer now sees the review surfaces (Reports / Inquiries /
  // Presentations Progress / Quiz Analytics) so they can act on collector
  // notes. Admin-only pages (Collector ↔ Reviewer, Assignment History,
  // Users, Feedback Progress) still gate at the page level below.
  if (role === "Admin" || role === "Reviewer") {
    const adminItems: NavItem[] = [
      { href: "/admin-reports", label: "Reports" },
      { href: "/admin-inquiries", label: "Inquiries" },
      { href: "/admin-presentations", label: "Presentations" },
      { href: "/admin-quizzes", label: "Quiz Analytics" },
      // v59: weekly feedback outcome rollup, drills into Feedback Progress.
      { href: "/feedback-analysis", label: "Feedback Analysis" },
      // v59: per-collector attendance totals, drills into Feedback Progress.
      { href: "/collector-attendance", label: "Collector Attendance" },
    ];
    if (role === "Admin") {
      adminItems.push(
        { href: "/feedback-progress", label: "Feedback Progress" },
        { href: "/admin-collector-reviewer", label: "Collector ↔ Reviewer" },
        { href: "/admin-reviewer-history", label: "Assignment History" },
        { href: "/users", label: "Users" }
      );
    }
    entries.push({
      type: "group",
      key: "admin",
      label: "Administration",
      items: adminItems,
    });
  }

  return entries;
}

function groupContainsPath(items: NavItem[], pathname: string): boolean {
  return items.some((it) => pathname === it.href || pathname?.startsWith(it.href + "/"));
}

export default function Sidebar({
  email,
  role,
}: {
  email: string;
  role: AppRole;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const navEntries = buildNav(role);

  const initialOpen = new Set<string>();
  for (const entry of navEntries) {
    if (entry.type === "group" && groupContainsPath(entry.items, pathname ?? "")) {
      initialOpen.add(entry.key);
    }
  }
  const [openGroups, setOpenGroups] = useState<Set<string>>(initialOpen);

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const linkBase = "block rounded-lg px-3 py-2 text-sm font-medium transition";
  const linkInactive = "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800";
  const linkActive = "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900";

  return (
    <aside className="w-60 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 h-screen sticky top-0 flex flex-col overflow-y-auto">
      <div className="px-4 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col items-center text-center gap-2">
        <img src="/Logo/logo.png" alt="Hudl" className="h-8 w-auto max-w-full" />
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 leading-tight">
          Collector Performance Dashboard
        </span>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navEntries.map((entry) => {
          if (entry.type === "link") {
            const active = pathname === entry.href || pathname?.startsWith(entry.href + "/");
            return (
              <Link
                key={entry.href}
                href={entry.href}
                className={`${linkBase} ${active ? linkActive : linkInactive}`}
              >
                {entry.label}
              </Link>
            );
          }

          const isOpen = openGroups.has(entry.key);
          const groupActive = groupContainsPath(entry.items, pathname ?? "");

          return (
            <div key={entry.key}>
              <button
                type="button"
                onClick={() => toggleGroup(entry.key)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs uppercase font-semibold tracking-wider transition ${
                  groupActive && !isOpen
                    ? "text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800"
                    : "text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                }`}
              >
                <span>{entry.label}</span>
                <span className="text-slate-400 dark:text-slate-500 ml-1">{isOpen ? "▼" : "▶"}</span>
              </button>
              {isOpen && (
                <div className="mt-1 space-y-0.5 pl-3">
                  {entry.items.map((item) => {
                    const active = pathname === item.href || pathname?.startsWith(item.href + "/");
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`${linkBase} ${active ? linkActive : linkInactive}`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-slate-100 dark:border-slate-800 p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 truncate" title={email}>
            {email}
          </span>
          <ThemeToggle />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-2 py-0.5 text-xs font-medium">
            {roleLabel(role)}
          </span>
          <button
            onClick={signOut}
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
