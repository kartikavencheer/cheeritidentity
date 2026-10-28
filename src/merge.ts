// Groups source records by normalized phone into one person each, applying the agreed rule:
// when apps disagree, the most recently active app wins.

import { normalizePhone } from "./phone.ts";
import type {
  AppKey,
  AppStats,
  Conflict,
  Issue,
  MergeResult,
  MergedPerson,
  MergeStats,
  SourceRecord,
} from "./types.ts";

function time(date: Date | null): number {
  return date ? date.getTime() : Number.NEGATIVE_INFINITY;
}

function desc(a: number, b: number): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

/** Most recently active first. A record with no activity signal loses to one that has it. */
function byRecency(a: SourceRecord, b: SourceRecord): number {
  return (
    desc(time(a.lastActiveAt), time(b.lastActiveAt)) ||
    desc(time(a.updatedAt), time(b.updatedAt)) ||
    desc(time(a.createdAt), time(b.createdAt)) ||
    `${a.appKey}:${a.appUserId}`.localeCompare(`${b.appKey}:${b.appUserId}`)
  );
}

const comparable = {
  name: (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim(),
  email: (v: string) => v.toLowerCase().trim(),
};

function pick(sorted: SourceRecord[], field: "name" | "email" | "avatarUrl" | "gender" | "city"): string | null {
  for (const rec of sorted) {
    const value = rec[field];
    if (value) return value;
  }
  return null;
}

function findConflict(sorted: SourceRecord[], field: "name" | "email", chosen: string | null): Conflict | null {
  if (!chosen) return null;
  const distinct = new Set<string>();
  const values: Conflict["values"] = [];
  for (const rec of sorted) {
    const value = rec[field];
    if (!value) continue;
    distinct.add(comparable[field](value));
    values.push({ value, appKey: rec.appKey, appUserId: rec.appUserId });
  }
  return distinct.size > 1 ? { field, chosen, values } : null;
}

export function mergeRecords(records: SourceRecord[]): MergeResult {
  const issues: Issue[] = [];
  const perApp: Partial<Record<AppKey, AppStats>> = {};
  const invalidByReason: Record<string, number> = {};
  const groups = new Map<string, SourceRecord[]>();
  let nonIndianPhones = 0;

  const bump = (appKey: AppKey, key: keyof AppStats) => {
    const stats = (perApp[appKey] ??= { records: 0, valid: 0, invalid: 0 });
    stats[key] += 1;
  };

  for (const rec of records) {
    bump(rec.appKey, "records");

    for (const note of rec.notes) {
      issues.push({
        severity: "info",
        type: note,
        appKey: rec.appKey,
        appUserId: rec.appUserId,
        phone: rec.phoneRaw ?? "",
        detail: "",
      });
    }

    const phone = normalizePhone(rec.phoneRaw);
    if (!phone.ok) {
      bump(rec.appKey, "invalid");
      invalidByReason[phone.reason] = (invalidByReason[phone.reason] ?? 0) + 1;
      issues.push({
        severity: "error",
        type: "invalid_phone",
        appKey: rec.appKey,
        appUserId: rec.appUserId,
        phone: phone.raw,
        detail: phone.reason,
      });
      continue;
    }

    bump(rec.appKey, "valid");
    if (phone.country === "OTHER") nonIndianPhones += 1;
    const group = groups.get(phone.e164);
    if (group) group.push(rec);
    else groups.set(phone.e164, [rec]);
  }

  const people: MergedPerson[] = [];
  const overlaps: Record<string, number> = {};
  const conflictsByField = { name: 0, email: 0 };
  let unverifiedOnlyPeople = 0;
  let peopleInMultipleApps = 0;

  for (const [phone, group] of groups) {
    const sorted = [...group].sort(byRecency);
    const name = pick(sorted, "name");
    const email = pick(sorted, "email");

    const conflicts: Conflict[] = [];
    for (const field of ["name", "email"] as const) {
      const conflict = findConflict(sorted, field, field === "name" ? name : email);
      if (conflict) {
        conflicts.push(conflict);
        conflictsByField[field] += 1;
        issues.push({
          severity: "warning",
          type: `${field}_conflict`,
          appKey: "",
          appUserId: "",
          phone,
          detail: `kept "${conflict.chosen}" from most recently active; saw ${conflict.values
            .map((v) => `"${v.value}" (${v.appKey})`)
            .join(", ")}`,
        });
      }
    }

    const byApp = new Map<AppKey, SourceRecord[]>();
    for (const rec of group) byApp.set(rec.appKey, [...(byApp.get(rec.appKey) ?? []), rec]);
    for (const [appKey, rows] of byApp) {
      if (rows.length < 2) continue;
      const roles = rows.map((r) => r.appRole);
      const distinctRoles = roles.every((r) => r !== "") && new Set(roles).size === roles.length;
      issues.push({
        severity: distinctRoles ? "info" : "warning",
        type: distinctRoles ? "same_app_multiple_roles" : "same_app_duplicate",
        appKey,
        appUserId: rows.map((r) => r.appUserId).join(" | "),
        phone,
        detail: distinctRoles ? roles.join(" + ") : `${rows.length} rows share this phone in one app`,
      });
    }

    const verified = group.some((r) => r.phoneVerified);
    if (!verified) {
      unverifiedOnlyPeople += 1;
      issues.push({
        severity: "info",
        type: "phone_unverified",
        appKey: "",
        appUserId: "",
        phone,
        detail: "no app has proven this number by OTP; verify at first SSO login",
      });
    }

    const appKeys = [...new Set(group.map((r) => r.appKey))].sort();
    if (appKeys.length > 1) {
      peopleInMultipleApps += 1;
      const combo = appKeys.join("+");
      overlaps[combo] = (overlaps[combo] ?? 0) + 1;
    }

    const byCreated = [...group].sort((a, b) => desc(-time(a.createdAt), -time(b.createdAt)));
    const firstApp = byCreated.find((r) => r.createdAt)?.appKey ?? sorted[0]?.appKey ?? null;
    const lastActive = sorted.find((r) => r.lastActiveAt)?.lastActiveAt ?? null;

    people.push({
      phone,
      phoneVerified: verified,
      name,
      email,
      avatarUrl: pick(sorted, "avatarUrl"),
      gender: pick(sorted, "gender"),
      city: pick(sorted, "city"),
      firstApp,
      lastLoginAt: lastActive,
      // Sorted so the output is identical however the rows were read.
      apps: group
        .map((r) => ({
          appKey: r.appKey,
          appUserId: r.appUserId,
          appRole: r.appRole,
          firstSeenAt: r.createdAt,
          lastSeenAt: r.lastActiveAt ?? r.updatedAt,
        }))
        .sort((a, b) => `${a.appKey}:${a.appUserId}`.localeCompare(`${b.appKey}:${b.appUserId}`)),
      conflicts,
    });
  }

  people.sort((a, b) => a.phone.localeCompare(b.phone));

  const validRecords = Object.values(perApp).reduce((n, s) => n + s.valid, 0);
  const stats: MergeStats = {
    totalRecords: records.length,
    validRecords,
    invalidRecords: records.length - validRecords,
    people: people.length,
    peopleInMultipleApps,
    perApp,
    overlaps,
    conflictsByField,
    unverifiedOnlyPeople,
    nonIndianPhones,
    invalidByReason,
  };

  return { people, issues, stats };
}
