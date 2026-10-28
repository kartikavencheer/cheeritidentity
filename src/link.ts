// Stage 2: writes each person's identity id back into the apps' own user tables.
//
//   IDENTITY_URL=... LINK_SCORE_URL=... node src/link.ts                 show the plan per app, write nothing
//   IDENTITY_URL=... LINK_SCORE_URL=... node src/link.ts --apply         add the column and fill it
//   IDENTITY_URL=... LINK_SCORE_URL=... node src/link.ts --verify-only   check an earlier run
//
// LINK_<APP>_URL needs a user that may ALTER and UPDATE the app's user table. An app with no URL is skipped.
// The identity database is only read. In each app the only changes are one nullable column, its unique
// index, and filling that column where it is empty. A row that already holds a different identity is never
// overwritten: that app is refused as a whole. Each app is written in its own transaction.
//
// Before --apply: back up the app database, and add the column to that app's schema.prisma (see
// sql/apps/README.md), or the next `prisma db push` will drop it.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import pg from "pg";
import { describeUrl, fetchRows } from "./db.ts";
import { blockers, LINK_TARGETS, planLinks, type AppRow, type LinkPlan, type LinkTarget, type Membership } from "./link-plan.ts";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    "verify-only": { type: "boolean", default: false },
    "allow-remote": { type: "boolean", default: false },
    only: { type: "string" },
  },
});

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

function sameDatabase(a: string, b: string): boolean {
  const x = new URL(a);
  const y = new URL(b);
  return x.hostname === y.hostname && (x.port || "5432") === (y.port || "5432") && x.pathname === y.pathname;
}

const unquote = (identifier: string) => identifier.replace(/"/g, "");

const identityUrl = process.env.IDENTITY_URL;
if (!identityUrl) throw new Error("Set IDENTITY_URL to the identity database connection string.");

const wanted = values.only ? new Set(values.only.split(",").map((s) => s.trim())) : null;
const targets = LINK_TARGETS.filter((t) => !wanted || wanted.has(t.appKey));

// Check every URL before touching anything.
for (const t of targets) {
  const url = process.env[t.envVar];
  if (!url) continue;
  if (!LOCAL_HOSTS.includes(new URL(url).hostname) && !values["allow-remote"]) {
    throw new Error(`${t.envVar} points at non-local host ${new URL(url).hostname}. Pass --allow-remote if that is intended.`);
  }
  if (sameDatabase(url, identityUrl)) throw new Error(`${t.envVar} is the identity database. Refusing.`);
}

console.log(`Identity: ${describeUrl(identityUrl)} (read-only)`);
const allMemberships = await fetchRows(identityUrl, "SELECT app_key, app_user_id, user_id::text AS user_id FROM user_apps");

async function columnExists(url: string, t: LinkTarget): Promise<boolean> {
  const rows = await fetchRows(
    url,
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = '${unquote(t.table)}' AND column_name = '${unquote(t.identityColumn)}'`,
  );
  return rows.length > 0;
}

async function readAppRows(url: string, t: LinkTarget): Promise<{ rows: AppRow[]; hasColumn: boolean }> {
  const hasColumn = await columnExists(url, t);
  const identity = hasColumn ? `${t.identityColumn}::text` : "NULL::text";
  const rows = await fetchRows(url, `SELECT ${t.idColumn}::text AS app_user_id, ${identity} AS identity_id FROM ${t.table}`);
  return {
    hasColumn,
    rows: rows.map((r) => ({ appUserId: String(r.app_user_id), identityId: r.identity_id == null ? null : String(r.identity_id) })),
  };
}

function printPlan(t: LinkTarget, plan: LinkPlan, hasColumn: boolean): void {
  console.log(`\n${t.appKey} (${t.table}.${t.identityColumn}${hasColumn ? "" : ", column not added yet"})`);
  console.log(`  to link: ${plan.toLink.length}, already linked: ${plan.alreadyLinked}, missing in app: ${plan.missingInApp.length}, skipped: ${plan.skipped.length}`);
  for (const m of plan.mismatched) console.log(`  MISMATCH row ${m.appUserId}: holds ${m.current}, expected ${m.expected}`);
  for (const r of plan.unknownLinks) console.log(`  UNKNOWN row ${r.appUserId}: holds ${r.identityId}, not listed in the identity database`);
  if (plan.missingInApp.length) console.log(`  missing rows: ${plan.missingInApp.join(", ")}`);
}

let failed = false;
let ran = 0;

for (const t of targets) {
  const url = process.env[t.envVar];
  if (!url) {
    console.log(`\n${t.appKey}: skipped, ${t.envVar} not set`);
    continue;
  }
  ran += 1;
  console.log(`\n${t.appKey}: ${describeUrl(url)}`);

  const memberships: Membership[] = allMemberships
    .filter((m) => m.app_key === t.appKey)
    .map((m) => ({ appUserId: String(m.app_user_id), identityId: String(m.user_id) }));

  const before = await readAppRows(url, t);
  const plan = planLinks(t, memberships, before.rows);
  printPlan(t, plan, before.hasColumn);

  const blocked = blockers(plan);
  if (blocked.length) {
    console.log(`  REFUSED: ${blocked.join("; ")}. Nothing written to ${t.appKey}.`);
    failed = true;
    continue;
  }

  if (values.apply) {
    const client = new pg.Client({ connectionString: url, application_name: "cheerit-identity-link" });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(readFileSync(new URL(`../sql/apps/${t.migration}`, import.meta.url), "utf8"));
      const res = await client.query(
        `UPDATE ${t.table} AS t SET ${t.identityColumn} = v.identity_id::uuid
         FROM unnest($1::text[], $2::text[]) AS v(app_user_id, identity_id)
         WHERE t.${t.idColumn}::text = v.app_user_id AND t.${t.identityColumn} IS NULL`,
        [plan.toLink.map((m) => m.appUserId), plan.toLink.map((m) => m.identityId)],
      );
      if (res.rowCount !== plan.toLink.length) {
        throw new Error(`expected to link ${plan.toLink.length} rows, the update touched ${res.rowCount}`);
      }
      await client.query("COMMIT");
      console.log(`  Written: column ensured, ${res.rowCount} rows linked.`);
    } catch (error) {
      await client.query("ROLLBACK");
      console.log(`  ROLLED BACK: ${(error as Error).message}. Nothing written to ${t.appKey}.`);
      failed = true;
      continue;
    } finally {
      await client.end();
    }
  }

  if (values.apply || values["verify-only"]) {
    const after = await readAppRows(url, t);
    const check = planLinks(t, memberships, after.rows);
    const ok = after.hasColumn && check.toLink.length === 0 && blockers(check).length === 0;
    console.log(
      `  Verification ${ok ? "PASS" : "FAIL"}: column ${after.hasColumn ? "present" : "missing"}, ` +
        `${check.alreadyLinked} linked, ${check.toLink.length} unlinked, ${check.mismatched.length} mismatched, ` +
        `${check.unknownLinks.length} unknown, ${check.missingInApp.length} missing in app`,
    );
    if (!ok) failed = true;
  }
}

if (ran === 0) console.log("\nNo LINK_<APP>_URL set, nothing to do.");
else if (!values.apply && !values["verify-only"]) console.log("\nNothing written. Pass --apply to write, or --verify-only to check.");
if (failed) process.exitCode = 1;
