// Checks the identity database against what the sources say it should contain.

import type { MergedPerson, SourceRecord } from "./types.ts";

export interface Queryable {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export async function verifyIdentityDb(
  db: Queryable,
  people: MergedPerson[],
  validRecords: number,
): Promise<Check[]> {
  const users = new Map<string, string>();
  for (const row of (await db.query("SELECT id, phone FROM users")).rows) users.set(String(row.phone), String(row.id));

  const memberships = new Map<string, string>();
  for (const row of (await db.query("SELECT user_id, app_key, app_user_id FROM user_apps")).rows) {
    memberships.set(`${row.app_key}:${row.app_user_id}`, String(row.user_id));
  }

  let missingUsers = 0;
  let missingMemberships = 0;
  let wrongOwner = 0;
  let planned = 0;
  for (const person of people) {
    const userId = users.get(person.phone);
    if (!userId) {
      missingUsers += 1;
      continue;
    }
    for (const app of person.apps) {
      planned += 1;
      const owner = memberships.get(`${app.appKey}:${app.appUserId}`);
      if (!owner) missingMemberships += 1;
      else if (owner !== userId) wrongOwner += 1;
    }
  }

  const orphans = (await db.query("SELECT count(*)::int AS n FROM user_apps a LEFT JOIN users u ON u.id = a.user_id WHERE u.id IS NULL")).rows[0].n;
  const badPhones = (await db.query("SELECT count(*)::int AS n FROM users WHERE phone !~ '^\\+[1-9][0-9]{7,14}$'")).rows[0].n;

  return [
    { name: "every planned person exists", ok: missingUsers === 0, detail: `${people.length - missingUsers}/${people.length}` },
    { name: "every usable app record is linked", ok: missingMemberships === 0, detail: `${planned - missingMemberships}/${planned} (source had ${validRecords} usable)` },
    { name: "no app record linked to the wrong person", ok: wrongOwner === 0, detail: `${wrongOwner} mismatches` },
    { name: "planned memberships equal usable source records", ok: planned === validRecords, detail: `${planned} vs ${validRecords}` },
    { name: "no memberships without a person", ok: orphans === 0, detail: `${orphans} orphans` },
    { name: "every phone is valid E.164", ok: badPhones === 0, detail: `${badPhones} bad` },
  ];
}
