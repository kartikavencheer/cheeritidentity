// Runs the identity service against a real, throwaway database. Skipped unless TEST_IDENTITY_URL is set.
// Every table in that database is emptied first, so never point it at a real identity database.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import pg from "pg";
import { createApp } from "../src/service/app.ts";
import { issueKey } from "../src/service/auth.ts";

const url = process.env.TEST_IDENTITY_URL;
const skip = url ? false : "TEST_IDENTITY_URL not set";

let pool: pg.Pool;
let server: Server;
let base = "";
const keys: Record<string, string> = {};

async function call(method: string, path: string, key: string | null, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

before(async () => {
  if (!url) return;
  if (!/test/i.test(new URL(url).pathname)) throw new Error("TEST_IDENTITY_URL must name a database with 'test' in it.");
  pool = new pg.Pool({ connectionString: url, max: 5 });
  for (const file of ["001_identity_schema.sql", "002_app_clients.sql"]) {
    await pool.query(readFileSync(new URL(`../sql/${file}`, import.meta.url), "utf8"));
  }
  await pool.query("TRUNCATE users, user_apps, app_clients, migration_runs, migration_log CASCADE");
  keys.score = await issueKey(pool, "score");
  keys.turfit = await issueKey(pool, "turfit");
  server = createApp(pool).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (!url) return;
  server.close();
  await pool.end();
});

test("requests without a valid key are refused", { skip }, async () => {
  assert.equal((await call("GET", "/v1/users?phone=9876543210", null)).status, 401);
  assert.equal((await call("GET", "/v1/users?phone=9876543210", "cid_score_wrong")).status, 401);
});

test("one phone used from two apps is one person with both memberships", { skip }, async () => {
  const first = await call("POST", "/v1/users/resolve", keys.score, { phone: "98765 43210", appUserId: 7, name: "Asha" });
  assert.equal(first.status, 201);
  assert.equal(first.body.user.phone, "+919876543210");

  const second = await call("POST", "/v1/users/resolve", keys.turfit, { phone: "+91 9876543210", appUserId: "ck1", role: "OWNER", name: "Other" });
  assert.equal(second.status, 200);
  assert.equal(second.body.user.id, first.body.user.id);
  assert.equal(second.body.user.name, "Asha", "an existing name is never overwritten");
  assert.deepEqual(second.body.user.apps.map((a: any) => a.app), ["score", "turfit"]);
  // Each app only sees its own row id.
  assert.equal(second.body.user.apps.find((a: any) => a.app === "turfit").appUserId, "ck1");
  assert.equal(second.body.user.apps.find((a: any) => a.app === "score").appUserId, undefined);
});

test("logging in again is not a new person", { skip }, async () => {
  const again = await call("POST", "/v1/users/resolve", keys.score, { phone: "9876543210", appUserId: "7" });
  assert.equal(again.status, 200);
  assert.equal(again.body.created, false);
});

test("an app user already linked to another phone is refused, not moved", { skip }, async () => {
  const res = await call("POST", "/v1/users/resolve", keys.score, { phone: "9123456780", appUserId: "7" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "app_user_linked_elsewhere");
  assert.equal((await call("GET", "/v1/users?phone=9123456780", keys.score)).status, 404, "the refused call left nothing behind");
});

test("bad input gets a clear 400", { skip }, async () => {
  assert.equal((await call("POST", "/v1/users/resolve", keys.score, { phone: "12345", appUserId: "1" })).body.error, "invalid_phone");
  assert.equal((await call("POST", "/v1/users/resolve", keys.score, { phone: "9876543210" })).body.error, "missing_app_user_id");
  assert.equal((await call("GET", "/v1/users/not-a-uuid", keys.score)).status, 404);
});

test("a reissued key replaces the old one", { skip }, async () => {
  const old = keys.turfit;
  keys.turfit = await issueKey(pool, "turfit");
  assert.equal((await call("GET", "/v1/users?phone=9876543210", old)).status, 401);
  assert.equal((await call("GET", "/v1/users?phone=9876543210", keys.turfit)).status, 200);
});
