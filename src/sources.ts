// One extractor per app. Each is a single SELECT plus a mapper into the shared SourceRecord shape.
// Column names come from each app's schema.prisma or SQL migrations.

import type { AppKey, Source, SourceRecord } from "./types.ts";

type Row = Record<string, unknown>;

export function str(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

export function toDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Sponsor OTP signups get a made-up login email when the real one is taken. It must never be imported.
const SYNTHETIC_EMAIL_SUFFIXES = ["@mobile.sponsor"];

export function cleanEmail(value: unknown, notes: string[]): string | null {
  const email = str(value)?.toLowerCase() ?? null;
  if (!email) return null;
  if (SYNTHETIC_EMAIL_SUFFIXES.some((suffix) => email.endsWith(suffix))) {
    notes.push("synthetic_email_dropped");
    return null;
  }
  if (!EMAIL.test(email)) {
    notes.push("invalid_email_dropped");
    return null;
  }
  return email;
}

function base(appKey: AppKey, sourceName: string, row: Row, id: unknown): SourceRecord {
  return {
    appKey,
    sourceName,
    appUserId: String(id),
    appRole: "",
    phoneRaw: null,
    phoneVerified: true,
    name: null,
    email: null,
    avatarUrl: null,
    gender: null,
    city: null,
    lastActiveAt: null,
    updatedAt: toDate(row.updated_at),
    createdAt: toDate(row.created_at),
    isActive: null,
    notes: [],
  };
}

// CheerIT-Score: si_user. Players are separate rows and are not users until linked, so they are out of scope here.
const score: Source = {
  name: "score",
  appKey: "score",
  envVar: "SRC_SCORE_URL",
  sql: `SELECT u.si_user_id AS id, u.si_user_fullname AS name, u.si_user_phonenumber AS phone,
               u.si_user_email AS email, u.si_user_createdat AS created_at,
               u.si_user_updatedat AS updated_at, u.si_user_lastloginat AS last_login_at
        FROM si_user u`,
  map(row) {
    const rec = base("score", "score", row, row.id);
    const notes = rec.notes;
    return {
      ...rec,
      appRole: "USER",
      phoneRaw: str(row.phone),
      name: str(row.name),
      email: cleanEmail(row.email, notes),
      lastActiveAt: toDate(row.last_login_at),
    };
  },
};

// Score admins log in by phone too, so they are people as well.
const scoreAdmin: Source = {
  name: "score_admin",
  appKey: "score",
  envVar: "SRC_SCORE_URL",
  sql: `SELECT a.si_admin_id AS id, a.si_admin_phone AS phone, a.si_admin_name AS name,
               a.si_admin_isactive AS is_active, a.si_admin_createdat AS created_at
        FROM si_admin a`,
  map(row) {
    const rec = base("score", "score_admin", row, `admin:${row.id}`);
    return {
      ...rec,
      appRole: "ADMIN",
      phoneRaw: str(row.phone),
      name: str(row.name),
      isActive: row.is_active == null ? null : Boolean(row.is_active),
    };
  },
};

// scoreit-sports-booking-match-platform: users. Last activity is the newest refresh token.
const booking: Source = {
  name: "booking",
  appKey: "booking",
  envVar: "SRC_BOOKING_URL",
  sql: `SELECT u.id, u.name, u.phone, u.gender, u.email, u."avatarUrl" AS avatar_url,
               u."createdAt" AS created_at, u."updatedAt" AS updated_at,
               (SELECT MAX(t."createdAt") FROM auth_tokens t WHERE t."userId" = u.id) AS last_login_at
        FROM users u`,
  map(row) {
    const rec = base("booking", "booking", row, row.id);
    return {
      ...rec,
      phoneRaw: str(row.phone),
      name: str(row.name),
      email: cleanEmail(row.email, rec.notes),
      avatarUrl: str(row.avatar_url),
      gender: str(row.gender),
      lastActiveAt: toDate(row.last_login_at),
    };
  },
};

// predictitapp: users. Last activity is the newest session use.
const predictit: Source = {
  name: "predictit",
  appKey: "predictit",
  envVar: "SRC_PREDICTIT_URL",
  sql: `SELECT u.id, u.full_name AS name, u.mobile_number AS phone, u.email_address AS email,
               u.city_name AS city, u.gender, u.profile_image AS avatar_url,
               u.created_at, u.updated_at,
               (SELECT MAX(s.last_used_at) FROM auth_sessions s WHERE s.user_id = u.id) AS last_login_at
        FROM users u`,
  map(row) {
    const rec = base("predictit", "predictit", row, row.id);
    return {
      ...rec,
      phoneRaw: str(row.phone),
      name: str(row.name),
      email: cleanEmail(row.email, rec.notes),
      avatarUrl: str(row.avatar_url),
      gender: str(row.gender),
      city: str(row.city),
      lastActiveAt: toDate(row.last_login_at),
    };
  },
};

// turfitweb: "User". One phone can be a PLAYER row and an OWNER row, so appRole matters here.
const turfit: Source = {
  name: "turfit",
  appKey: "turfit",
  envVar: "SRC_TURFIT_URL",
  sql: `SELECT u.id, u.role::text AS role, u.name, u.phone, u.email, u.city, u.gender::text AS gender,
               u."avatarUrl" AS avatar_url, u."isActive" AS is_active,
               u."createdAt" AS created_at, u."updatedAt" AS updated_at, u."lastLoginAt" AS last_login_at
        FROM "User" u`,
  map(row) {
    const rec = base("turfit", "turfit", row, row.id);
    return {
      ...rec,
      appRole: str(row.role) ?? "",
      phoneRaw: str(row.phone),
      name: str(row.name),
      email: cleanEmail(row.email, rec.notes),
      avatarUrl: str(row.avatar_url),
      gender: str(row.gender),
      city: str(row.city),
      lastActiveAt: toDate(row.last_login_at),
      isActive: row.is_active == null ? null : Boolean(row.is_active),
    };
  },
};

// CheerIT-Sponsor: one auth user per sponsor company. A mobile stored on the auth user was set by a real OTP,
// so it counts as verified. Otherwise the primary contact's mobile is used and stays unverified.
const sponsor: Source = {
  name: "sponsor",
  appKey: "sponsor",
  envVar: "SRC_SPONSOR_URL",
  sql: `SELECT u.id, u.email_address AS email, u.mobile_number AS auth_mobile, u.is_active,
               u.last_login_at, u.created_at, u.updated_at,
               c.full_name AS contact_name, c.mobile_number AS contact_mobile,
               s.display_brand_name, s.legal_company_name
        FROM sp_sponsor_auth_users u
        JOIN sp_sponsors s ON s.id = u.sponsor_id
        LEFT JOIN LATERAL (
          SELECT full_name, mobile_number FROM sp_sponsor_contacts
          WHERE sponsor_id = u.sponsor_id
          ORDER BY is_primary DESC, created_at
          LIMIT 1
        ) c ON TRUE`,
  map(row) {
    const rec = base("sponsor", "sponsor", row, row.id);
    const notes = rec.notes;
    const authMobile = str(row.auth_mobile);
    const contactMobile = str(row.contact_mobile);
    if (!authMobile && contactMobile) notes.push("phone_from_contact_unverified");
    return {
      ...rec,
      appRole: "sponsor",
      phoneRaw: authMobile ?? contactMobile,
      phoneVerified: Boolean(authMobile),
      name: str(row.contact_name) ?? str(row.display_brand_name) ?? str(row.legal_company_name),
      email: cleanEmail(row.email, notes),
      lastActiveAt: toDate(row.last_login_at),
      isActive: row.is_active == null ? null : Boolean(row.is_active),
    };
  },
};

export const SOURCES: Source[] = [score, scoreAdmin, booking, predictit, turfit, sponsor];
