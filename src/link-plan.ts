// Stage 2 planning: which app rows get which identity_id. Pure, so it can be tested without a database.

import type { AppKey } from "./types.ts";

export interface LinkTarget {
  appKey: AppKey;
  /** Environment variable for this app's connection string. Must be a user allowed to ALTER and UPDATE. */
  envVar: string;
  /** Quoted SQL identifiers, used as-is in queries. */
  table: string;
  idColumn: string;
  identityColumn: string;
  /** File in sql/apps/ that adds the column and its unique index. */
  migration: string;
  /** Memberships that live in another table and are not linked by this target, such as Score admins. */
  skipAppUserId?: (appUserId: string) => boolean;
}

export const LINK_TARGETS: LinkTarget[] = [
  {
    appKey: "score",
    envVar: "LINK_SCORE_URL",
    table: "si_user",
    idColumn: "si_user_id",
    identityColumn: "si_user_identityid",
    migration: "score.sql",
    // Admins are in si_admin, which has no identity column yet.
    skipAppUserId: (id) => id.startsWith("admin:"),
  },
  { appKey: "booking", envVar: "LINK_BOOKING_URL", table: "users", idColumn: "id", identityColumn: "identity_id", migration: "booking.sql" },
  { appKey: "predictit", envVar: "LINK_PREDICTIT_URL", table: "users", idColumn: "id", identityColumn: "identity_id", migration: "predictit.sql" },
  { appKey: "turfit", envVar: "LINK_TURFIT_URL", table: `"User"`, idColumn: "id", identityColumn: `"identityId"`, migration: "turfit.sql" },
  { appKey: "sponsor", envVar: "LINK_SPONSOR_URL", table: "sp_sponsor_auth_users", idColumn: "id", identityColumn: "identity_id", migration: "sponsor.sql" },
];

export interface Membership {
  appUserId: string;
  identityId: string;
}

export interface AppRow {
  appUserId: string;
  /** Null when the column is missing or empty. */
  identityId: string | null;
}

export interface LinkPlan {
  /** Rows whose identity column is empty and will be filled. */
  toLink: Membership[];
  /** Rows that already hold the right identity. */
  alreadyLinked: number;
  /** Rows that hold a different identity. Never overwritten; the app is refused while any exist. */
  mismatched: { appUserId: string; current: string; expected: string }[];
  /** Memberships whose app row no longer exists. */
  missingInApp: string[];
  /** Memberships handled elsewhere, such as Score admins. */
  skipped: string[];
  /** App rows with an identity that the identity database does not list for that row. */
  unknownLinks: AppRow[];
  /** App rows the identity database has never seen, such as signups in an app not yet calling the service. */
  notInIdentity: string[];
}

export function planLinks(target: LinkTarget, memberships: Membership[], rows: AppRow[]): LinkPlan {
  const byId = new Map(rows.map((r) => [r.appUserId, r]));
  const planned = new Set<string>();
  const plan: LinkPlan = { toLink: [], alreadyLinked: 0, mismatched: [], missingInApp: [], skipped: [], unknownLinks: [], notInIdentity: [] };

  const sorted = [...memberships].sort((a, b) => a.appUserId.localeCompare(b.appUserId));
  for (const m of sorted) {
    if (target.skipAppUserId?.(m.appUserId)) {
      plan.skipped.push(m.appUserId);
      continue;
    }
    planned.add(m.appUserId);
    const row = byId.get(m.appUserId);
    if (!row) plan.missingInApp.push(m.appUserId);
    else if (row.identityId === null) plan.toLink.push(m);
    else if (row.identityId === m.identityId) plan.alreadyLinked += 1;
    else plan.mismatched.push({ appUserId: m.appUserId, current: row.identityId, expected: m.identityId });
  }

  for (const row of rows) {
    if (planned.has(row.appUserId)) continue;
    if (row.identityId !== null) plan.unknownLinks.push(row);
    else plan.notInIdentity.push(row.appUserId);
  }
  return plan;
}

/** An app is written only when nothing in it disagrees with the identity database. */
export function blockers(plan: LinkPlan): string[] {
  const reasons: string[] = [];
  if (plan.mismatched.length) reasons.push(`${plan.mismatched.length} rows already hold a different identity`);
  if (plan.unknownLinks.length) reasons.push(`${plan.unknownLinks.length} rows hold an identity the identity database does not list for them`);
  return reasons;
}
