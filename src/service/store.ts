// Database logic for the identity service. Follows the same rules as the migration: the phone is the
// person, profile fields are only filled where blank, and an app row never silently moves to another person.

import type pg from "pg";
import { normalizePhone } from "../phone.ts";
import type { AppKey } from "../types.ts";

export interface ResolveInput {
  phone: unknown;
  appUserId: unknown;
  role?: unknown;
  name?: unknown;
  email?: unknown;
  avatarUrl?: unknown;
  gender?: unknown;
  city?: unknown;
  /** Apps call this after a successful OTP, so a number is verified unless the app says otherwise. */
  phoneVerified?: unknown;
}

export interface PublicUser {
  id: string;
  phone: string;
  phoneVerified: boolean;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  gender: string | null;
  city: string | null;
  status: "active" | "blocked";
  apps: { app: AppKey; role: string; firstSeenAt: Date | null; lastSeenAt: Date | null; appUserId?: string }[];
}

export class ServiceError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function text(value: unknown, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new ServiceError(400, "invalid_field", "Profile fields must be strings.");
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ServiceError(400, "invalid_field", `A field is longer than ${max} characters.`);
  return trimmed === "" ? null : trimmed;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parsePhone(value: unknown): string {
  const result = normalizePhone(value);
  if (!result.ok) throw new ServiceError(400, "invalid_phone", `Phone number rejected: ${result.reason}.`);
  return result.e164;
}

/**
 * Finds or creates the person for this phone and records that this app row belongs to them.
 * Called by an app backend at signup and at every login.
 */
export async function resolveUser(pool: pg.Pool, appKey: AppKey, input: ResolveInput): Promise<{ user: PublicUser; created: boolean }> {
  const phone = parsePhone(input.phone);
  const appUserId = text(input.appUserId == null ? null : String(input.appUserId), 100);
  if (!appUserId) throw new ServiceError(400, "missing_app_user_id", "appUserId is required.");
  const role = text(input.role, 40) ?? "";
  let email = text(input.email, 200)?.toLowerCase() ?? null;
  if (email && (!EMAIL.test(email) || email.endsWith("@mobile.sponsor"))) email = null;
  const verified = input.phoneVerified !== false;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `INSERT INTO users (phone, phone_verified_at, name, email, avatar_url, gender, city, first_app, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (phone) DO UPDATE SET
         phone_verified_at = COALESCE(users.phone_verified_at, EXCLUDED.phone_verified_at),
         name = COALESCE(users.name, EXCLUDED.name),
         email = COALESCE(users.email, EXCLUDED.email),
         avatar_url = COALESCE(users.avatar_url, EXCLUDED.avatar_url),
         gender = COALESCE(users.gender, EXCLUDED.gender),
         city = COALESCE(users.city, EXCLUDED.city),
         last_login_at = now(),
         updated_at = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [phone, verified ? new Date() : null, text(input.name, 100), email, text(input.avatarUrl, 500), text(input.gender, 20), text(input.city, 100), appKey],
    );
    const userId = res.rows[0].id as string;

    const m = await client.query(
      `INSERT INTO user_apps (user_id, app_key, app_user_id, app_role, first_seen_at, last_seen_at)
       VALUES ($1, $2, $3, $4, now(), now())
       ON CONFLICT (app_key, app_user_id) DO UPDATE SET app_role = EXCLUDED.app_role, last_seen_at = now()
       RETURNING user_id`,
      [userId, appKey, appUserId, role],
    );
    if (m.rows[0].user_id !== userId) {
      // The app row is already linked to a different phone. Happens when a user changes their number in
      // the app. Moving it is a decision for a person, not for a login call.
      await client.query("ROLLBACK");
      throw new ServiceError(409, "app_user_linked_elsewhere", "This app user is already linked to a different phone number.");
    }
    await client.query("COMMIT");

    const user = await getUser(pool, appKey, userId);
    return { user: user!, created: Boolean(res.rows[0].inserted) };
  } catch (error) {
    if (!(error instanceof ServiceError)) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** A person and the apps they use. The app row id is only shown for the calling app's own row. */
export async function getUser(pool: pg.Pool, appKey: AppKey, id: string): Promise<PublicUser | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const u = await pool.query(
    `SELECT id, phone, phone_verified_at, name, email, avatar_url, gender, city, status FROM users WHERE id = $1`,
    [id],
  );
  if (!u.rows.length) return null;
  const apps = await pool.query(
    `SELECT app_key, app_user_id, app_role, first_seen_at, last_seen_at FROM user_apps WHERE user_id = $1 ORDER BY app_key, app_user_id`,
    [id],
  );
  const row = u.rows[0];
  return {
    id: row.id,
    phone: row.phone,
    phoneVerified: row.phone_verified_at != null,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url,
    gender: row.gender,
    city: row.city,
    status: row.status,
    apps: apps.rows.map((a) => ({
      app: a.app_key,
      role: a.app_role,
      firstSeenAt: a.first_seen_at,
      lastSeenAt: a.last_seen_at,
      ...(a.app_key === appKey ? { appUserId: a.app_user_id } : {}),
    })),
  };
}

export async function findByPhone(pool: pg.Pool, appKey: AppKey, phone: unknown): Promise<PublicUser | null> {
  const e164 = parsePhone(phone);
  const res = await pool.query("SELECT id FROM users WHERE phone = $1", [e164]);
  return res.rows.length ? getUser(pool, appKey, res.rows[0].id) : null;
}
