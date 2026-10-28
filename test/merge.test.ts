import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeRecords } from "../src/merge.ts";
import { assertSelectOnly } from "../src/db.ts";
import { SOURCES } from "../src/sources.ts";
import type { SourceRecord } from "../src/types.ts";

const d = (iso: string) => new Date(iso);

function rec(partial: Partial<SourceRecord> & Pick<SourceRecord, "appKey" | "appUserId" | "phoneRaw">): SourceRecord {
  return {
    sourceName: partial.appKey,
    appRole: "",
    phoneVerified: true,
    name: null,
    email: null,
    avatarUrl: null,
    gender: null,
    city: null,
    lastActiveAt: null,
    updatedAt: null,
    createdAt: null,
    isActive: null,
    notes: [],
    ...partial,
  };
}

test("one phone in several apps becomes one person with several memberships", () => {
  const { people, stats } = mergeRecords([
    rec({ appKey: "score", appUserId: "1", phoneRaw: "9876543210", name: "A" }),
    rec({ appKey: "booking", appUserId: "x", phoneRaw: "+91 98765 43210", name: "A" }),
    rec({ appKey: "turfit", appUserId: "t", phoneRaw: "09876543210", name: "A" }),
  ]);
  assert.equal(people.length, 1);
  assert.equal(people[0].apps.length, 3);
  assert.equal(stats.peopleInMultipleApps, 1);
  assert.equal(stats.overlaps["booking+score+turfit"], 1);
});

test("most recently active app wins a name conflict, and the conflict is reported", () => {
  const { people, issues } = mergeRecords([
    rec({ appKey: "score", appUserId: "1", phoneRaw: "9876543210", name: "Old Name", lastActiveAt: d("2026-01-01") }),
    rec({ appKey: "booking", appUserId: "2", phoneRaw: "9876543210", name: "New Name", lastActiveAt: d("2026-09-01") }),
  ]);
  assert.equal(people[0].name, "New Name");
  assert.equal(people[0].conflicts[0].field, "name");
  assert.ok(issues.some((i) => i.type === "name_conflict"));
});

test("an app with an activity signal beats one without, whatever its updated time", () => {
  const { people } = mergeRecords([
    rec({ appKey: "score", appUserId: "1", phoneRaw: "9876543210", name: "No Signal", updatedAt: d("2026-10-01") }),
    rec({ appKey: "booking", appUserId: "2", phoneRaw: "9876543210", name: "Has Signal", lastActiveAt: d("2025-01-01") }),
  ]);
  assert.equal(people[0].name, "Has Signal");
});

test("an empty value never overrides a real one, even from the newest app", () => {
  const { people } = mergeRecords([
    rec({ appKey: "score", appUserId: "1", phoneRaw: "9876543210", name: "Real Name", city: "Pune", lastActiveAt: d("2026-01-01") }),
    rec({ appKey: "booking", appUserId: "2", phoneRaw: "9876543210", name: null, city: null, lastActiveAt: d("2026-09-01") }),
  ]);
  assert.equal(people[0].name, "Real Name");
  assert.equal(people[0].city, "Pune");
  assert.equal(people[0].conflicts.length, 0);
});

test("names that differ only by case or spacing are not conflicts", () => {
  const { people } = mergeRecords([
    rec({ appKey: "score", appUserId: "1", phoneRaw: "9876543210", name: "Aarav  Mehta" }),
    rec({ appKey: "booking", appUserId: "2", phoneRaw: "9876543210", name: "aarav mehta" }),
  ]);
  assert.equal(people[0].conflicts.length, 0);
});

test("TurfIT player and owner with one phone is one person with two roles", () => {
  const { people, issues } = mergeRecords([
    rec({ appKey: "turfit", appUserId: "p", appRole: "PLAYER", phoneRaw: "9876543210" }),
    rec({ appKey: "turfit", appUserId: "o", appRole: "OWNER", phoneRaw: "9876543210" }),
  ]);
  assert.equal(people.length, 1);
  assert.deepEqual(people[0].apps.map((a) => a.appRole).sort(), ["OWNER", "PLAYER"]);
  assert.ok(issues.some((i) => i.type === "same_app_multiple_roles"));
  assert.ok(!issues.some((i) => i.type === "same_app_duplicate"));
});

test("two rows with the same phone and no distinct roles are flagged as duplicates", () => {
  const { issues } = mergeRecords([
    rec({ appKey: "predictit", appUserId: "1", phoneRaw: "9876543210" }),
    rec({ appKey: "predictit", appUserId: "2", phoneRaw: "9876543210" }),
  ]);
  assert.ok(issues.some((i) => i.type === "same_app_duplicate"));
});

test("invalid phones are never merged or guessed, only reported", () => {
  const { people, issues, stats } = mergeRecords([
    rec({ appKey: "score", appUserId: "1", phoneRaw: "12345" }),
    rec({ appKey: "booking", appUserId: "2", phoneRaw: null }),
    rec({ appKey: "predictit", appUserId: "3", phoneRaw: "9876543210" }),
  ]);
  assert.equal(people.length, 1);
  assert.equal(stats.invalidRecords, 2);
  assert.equal(issues.filter((i) => i.type === "invalid_phone").length, 2);
});

test("a person is verified if any app verified the number", () => {
  const { people, stats } = mergeRecords([
    rec({ appKey: "sponsor", appUserId: "s", phoneRaw: "9876543210", phoneVerified: false }),
    rec({ appKey: "booking", appUserId: "b", phoneRaw: "9876543210", phoneVerified: true }),
    rec({ appKey: "sponsor", appUserId: "s2", phoneRaw: "9123456780", phoneVerified: false }),
  ]);
  assert.equal(people.find((p) => p.phone === "+919876543210")?.phoneVerified, true);
  assert.equal(stats.unverifiedOnlyPeople, 1);
});

test("running the merge twice gives identical results", () => {
  const records = [
    rec({ appKey: "score", appUserId: "1", phoneRaw: "9876543210", name: "A", lastActiveAt: d("2026-01-01") }),
    rec({ appKey: "booking", appUserId: "2", phoneRaw: "9876543210", name: "B", lastActiveAt: d("2026-01-01") }),
  ];
  assert.deepEqual(mergeRecords(records).people, mergeRecords([...records].reverse()).people);
});

test("sponsor: auth-user mobile is verified, contact mobile is not, fake emails are dropped", () => {
  const sponsor = SOURCES.find((s) => s.name === "sponsor")!;
  const verified = sponsor.map({
    id: "1", email: "real@brand.example", auth_mobile: "9876543210", contact_name: "Pat", contact_mobile: "9111111112",
    display_brand_name: "Brand", is_active: true,
  });
  assert.equal(verified.phoneRaw, "9876543210");
  assert.equal(verified.phoneVerified, true);

  const fallback = sponsor.map({
    id: "2", email: "9876543211@mobile.sponsor", auth_mobile: null, contact_name: null, contact_mobile: "09876543211",
    display_brand_name: "Brand Two", is_active: true,
  });
  assert.equal(fallback.phoneVerified, false);
  assert.equal(fallback.email, null);
  assert.equal(fallback.name, "Brand Two");
  assert.ok(fallback.notes.includes("synthetic_email_dropped"));
  assert.ok(fallback.notes.includes("phone_from_contact_unverified"));
});

test("every extractor query is a single read-only SELECT", () => {
  for (const source of SOURCES) assert.doesNotThrow(() => assertSelectOnly(source.sql), source.name);
});

test("the read-only guard refuses writes", () => {
  for (const sql of [
    "DELETE FROM users",
    "UPDATE users SET name = 'x'",
    "SELECT 1; DROP TABLE users",
    "INSERT INTO users VALUES (1)",
    "WITH x AS (DELETE FROM users RETURNING *) SELECT * FROM x",
    "ALTER TABLE users ADD COLUMN a int",
  ]) assert.throws(() => assertSelectOnly(sql), sql);
});
