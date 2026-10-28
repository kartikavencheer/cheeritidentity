// Writes the dry-run report. summary.md and report.json hold counts only, no personal data.
// issues.csv lists individual records and contains phone numbers, so it stays in the git-ignored out/ folder.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Issue, MergeResult } from "./types.ts";

export interface ReportContext {
  mode: "fixtures" | "live";
  generatedAt: Date;
  /** Sources that were read, with how many rows each returned. */
  read: { source: string; rows: number; origin: string }[];
  /** Sources skipped because no connection or fixture was provided. */
  skipped: string[];
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function issuesCsv(issues: Issue[]): string {
  const header = "severity,type,app_key,app_user_id,phone,detail";
  const rows = issues.map((i) =>
    [i.severity, i.type, i.appKey, i.appUserId, i.phone, i.detail].map(csvCell).join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

function countBy(issues: Issue[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const i of issues) counts[i.type] = (counts[i.type] ?? 0) + 1;
  return counts;
}

function summaryMarkdown(result: MergeResult, ctx: ReportContext): string {
  const { stats } = result;
  const lines: string[] = [];
  const add = (line = "") => lines.push(line);

  add("# Dry-run report");
  add();
  add(`Generated ${ctx.generatedAt.toISOString()}. Mode: ${ctx.mode}. **Nothing was written to any database.**`);
  add();
  add("## Totals");
  add();
  add(`- Records read: **${stats.totalRecords}**`);
  add(`- Usable phone numbers: **${stats.validRecords}**`);
  add(`- Rejected phone numbers: **${stats.invalidRecords}** (listed in issues.csv, to fix by hand)`);
  add(`- People after merging by phone: **${stats.people}**`);
  add(`- People using more than one app: **${stats.peopleInMultipleApps}**`);
  add(`- Name conflicts: **${stats.conflictsByField.name}**, email conflicts: **${stats.conflictsByField.email}**`);
  add(`- People whose phone no app has verified: **${stats.unverifiedOnlyPeople}**`);
  add(`- Non-Indian phone numbers accepted: **${stats.nonIndianPhones}**`);
  add();
  add("## Per app");
  add();
  add("| App | Records | Usable | Rejected |");
  add("|---|---:|---:|---:|");
  for (const [app, s] of Object.entries(stats.perApp)) add(`| ${app} | ${s.records} | ${s.valid} | ${s.invalid} |`);
  add();

  const overlaps = Object.entries(stats.overlaps).sort((a, b) => b[1] - a[1]);
  add("## Overlap between apps");
  add();
  if (overlaps.length === 0) add("No person appears in more than one app.");
  else {
    add("| Apps | People |");
    add("|---|---:|");
    for (const [combo, n] of overlaps) add(`| ${combo.replace(/\+/g, " + ")} | ${n} |`);
  }
  add();

  const rejected = Object.entries(stats.invalidByReason).sort((a, b) => b[1] - a[1]);
  add("## Why phone numbers were rejected");
  add();
  if (rejected.length === 0) add("None.");
  else for (const [reason, n] of rejected) add(`- ${reason}: ${n}`);
  add();

  add("## Issues by type");
  add();
  for (const [type, n] of Object.entries(countBy(result.issues)).sort((a, b) => b[1] - a[1])) add(`- ${type}: ${n}`);
  add();

  add("## Sources");
  add();
  for (const r of ctx.read) add(`- ${r.source}: ${r.rows} rows from ${r.origin}`);
  for (const s of ctx.skipped) add(`- ${s}: **skipped**, no connection or fixture provided`);
  add();
  add("## Assumptions to confirm");
  add();
  add("- Phones in Score, booking, PredictIt and TurfIT are treated as verified, because those apps create the user at OTP verification.");
  add("- Sponsor phones count as verified only when stored on the auth user. A primary-contact phone stays unverified.");
  add("- Activity for the \"most recently active app wins\" rule: last login or newest session where the app records it, otherwise the row's updated time.");
  add("- CheerIT-COM is not included. Its backend is separate.");
  add();
  return lines.join("\n");
}

export function writeReport(result: MergeResult, ctx: ReportContext, outDir: string): string {
  const dir = join(outDir, ctx.generatedAt.toISOString().replace(/[:.]/g, "-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "summary.md"), summaryMarkdown(result, ctx));
  writeFileSync(join(dir, "report.json"), JSON.stringify({ stats: result.stats, issueCounts: countBy(result.issues), sources: ctx }, null, 2));
  writeFileSync(join(dir, "issues.csv"), issuesCsv(result.issues));
  return dir;
}
