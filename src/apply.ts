// Writes the merged people into the identity database. Reads the apps read-only; the only thing it
// writes to is the identity database.
//
//   IDENTITY_URL=postgresql://.../cheerit_identity node src/apply.ts            show the plan, write nothing
//   IDENTITY_URL=... node src/apply.ts --apply                                  write
//   IDENTITY_URL=... node src/apply.ts --verify-only                            check what is there
//
// Re-running is safe: people and memberships are matched on phone and app id, and existing values are
// only filled in where blank, never overwritten.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import pg from "pg";
import { collect } from "./collect.ts";
import { describeUrl } from "./db.ts";
import { mergeRecords } from "./merge.ts";
import { verifyIdentityDb } from "./verify.ts";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    "verify-only": { type: "boolean", default: false },
    "allow-remote": { type: "boolean", default: false },
    fixtures: { type: "string" },
    only: { type: "string" },
  },
});

const targetUrl = process.env.IDENTITY_URL;
if (!targetUrl) throw new Error("Set IDENTITY_URL to the identity database connection string.");

const target = new URL(targetUrl);
const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname);
if (!isLocal && !values["allow-remote"]) {
  throw new Error(`Refusing to write to non-local host ${target.hostname}. Pass --allow-remote if that is intended.`);
}

const collected = await collect({ fixtures: values.fixtures, only: values.only });
for (const url of collected.sourceUrls) {
  const s = new URL(url);
  if (s.hostname === target.hostname && s.port === target.port && s.pathname === target.pathname) {
    throw new Error("The identity database is the same database as one of the sources. Refusing.");
  }
}

const result = mergeRecords(collected.records);
const { stats } = result;
console.log(`\nPlan: ${stats.totalRecords} records -> ${stats.people} people, ${stats.validRecords} memberships, ${result.issues.length} issues to log.`);
console.log(`Target: ${describeUrl(targetUrl)}`);

if (!values.apply && !values["verify-only"]) {
  console.log("Nothing written. Pass --apply to write, or --verify-only to check an existing run.");
  process.exit(0);
}

const client = new pg.Client({ connectionString: targetUrl, application_name: "cheerit-identity-apply" });
await client.connect();

try {
  if (values.apply) {
    await client.query(readFileSync(new URL("../sql/001_identity_schema.sql", import.meta.url), "utf8"));
    await client.query("BEGIN");
    try {
      const run = await client.query("INSERT INTO migration_runs (mode) VALUES ('apply') RETURNING run_id");
      const runId = run.rows[0].run_id as string;
      let created = 0;
      let existing = 0;
      let memberships = 0;
      let membershipsExisting = 0;
      let ownerClashes = 0;

      for (const person of result.people) {
        const firstSeen = person.apps.map((a) => a.firstSeenAt).filter((d): d is Date => d !== null);
        const earliest = firstSeen.length ? new Date(Math.min(...firstSeen.map((d) => d.getTime()))) : null;
        const res = await client.query(
          `INSERT INTO users (phone, phone_verified_at, name, email, avatar_url, gender, city, first_app, last_login_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, now()))
           ON CONFLICT (phone) DO UPDATE SET
             phone_verified_at = COALESCE(users.phone_verified_at, EXCLUDED.phone_verified_at),
             name = COALESCE(users.name, EXCLUDED.name),
             email = COALESCE(users.email, EXCLUDED.email),
             avatar_url = COALESCE(users.avatar_url, EXCLUDED.avatar_url),
             gender = COALESCE(users.gender, EXCLUDED.gender),
             city = COALESCE(users.city, EXCLUDED.city),
             first_app = COALESCE(users.first_app, EXCLUDED.first_app),
             last_login_at = GREATEST(users.last_login_at, EXCLUDED.last_login_at),
             updated_at = now()
           RETURNING id, (xmax = 0) AS inserted`,
          [
            person.phone,
            person.phoneVerified ? (person.lastLoginAt ?? new Date()) : null,
            person.name, person.email, person.avatarUrl, person.gender, person.city,
            person.firstApp, person.lastLoginAt, earliest,
          ],
        );
        const userId = res.rows[0].id as string;
        if (res.rows[0].inserted) created += 1;
        else existing += 1;

        for (const app of person.apps) {
          const m = await client.query(
            `INSERT INTO user_apps (user_id, app_key, app_user_id, app_role, first_seen_at, last_seen_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (app_key, app_user_id) DO UPDATE SET
               app_role = EXCLUDED.app_role,
               first_seen_at = LEAST(user_apps.first_seen_at, EXCLUDED.first_seen_at),
               last_seen_at = GREATEST(user_apps.last_seen_at, EXCLUDED.last_seen_at)
             RETURNING user_id, (xmax = 0) AS inserted`,
            [userId, app.appKey, app.appUserId, app.appRole, app.firstSeenAt, app.lastSeenAt],
          );
          if (m.rows[0].inserted) memberships += 1;
          else membershipsExisting += 1;
          if (m.rows[0].user_id !== userId) {
            ownerClashes += 1;
            await client.query(
              `INSERT INTO migration_log (run_id, user_id, app_key, action, phone, detail) VALUES ($1, $2, $3, 'membership_belongs_to_other_identity', $4, $5)`,
              [runId, m.rows[0].user_id, app.appKey, person.phone, JSON.stringify({ appUserId: app.appUserId })],
            );
          }
        }
      }

      for (const issue of result.issues) {
        await client.query(
          `INSERT INTO migration_log (run_id, app_key, action, phone, detail) VALUES ($1, $2, $3, $4, $5)`,
          [runId, issue.appKey || null, issue.type, issue.phone, JSON.stringify({ severity: issue.severity, appUserId: issue.appUserId, detail: issue.detail })],
        );
      }

      const summary = { created, existing, memberships, membershipsExisting, ownerClashes, issues: result.issues.length, stats };
      await client.query("UPDATE migration_runs SET finished_at = now(), summary = $2 WHERE run_id = $1", [runId, JSON.stringify(summary)]);
      await client.query("COMMIT");
      console.log(`\nWritten (run ${runId}): ${created} new people, ${existing} already there, ${memberships} new memberships, ${membershipsExisting} already there, ${ownerClashes} ownership clashes.`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  const checks = await verifyIdentityDb(client, result.people, stats.validRecords);
  console.log("\nVerification:");
  for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
} finally {
  await client.end();
}
