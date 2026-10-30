// Single sign-on tokens. App A's backend asks for a token for a person it has just logged in with an OTP, the
// browser carries it to app B, and app B's backend redeems it for that person's details and starts its own session.
// The identity service never holds a login session; it only vouches for one hop.

import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import type { AppKey } from "../types.ts";
import { APP_KEYS } from "./auth.ts";
import { getUser, ServiceError, type PublicUser } from "./store.ts";

export const SSO_TTL_SECONDS = 60;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Issues a token for `identityId` to be redeemed by `toApp`. The calling app must already have a row for the
 * person (so one app can't mint tokens for people it has never logged in), and the phone must be verified.
 */
export async function issueSsoToken(pool: pg.Pool, fromApp: AppKey, input: { identityId?: unknown; toApp?: unknown }) {
  const { identityId, toApp } = input;
  if (typeof identityId !== "string" || !/^[0-9a-f-]{36}$/i.test(identityId)) throw new ServiceError(400, "invalid_identity_id", "identityId is required.");
  if (typeof toApp !== "string" || !APP_KEYS.includes(toApp as AppKey)) throw new ServiceError(400, "invalid_to_app", "toApp must be one of the known apps.");
  if (toApp === fromApp) throw new ServiceError(400, "invalid_to_app", "toApp must be a different app.");

  const person = await pool.query(
    `SELECT u.status, u.phone_verified_at, EXISTS (SELECT 1 FROM user_apps a WHERE a.user_id = u.id AND a.app_key = $2) AS in_app
       FROM users u WHERE u.id = $1`,
    [identityId, fromApp],
  );
  const row = person.rows[0];
  if (!row || !row.in_app) throw new ServiceError(404, "not_found", "This person is not a user of the calling app.");
  if (row.status === "blocked") throw new ServiceError(403, "blocked", "This person is blocked.");
  if (!row.phone_verified_at) throw new ServiceError(403, "phone_not_verified", "This person's phone number is not verified.");

  const token = randomBytes(32).toString("base64url");
  await pool.query("DELETE FROM sso_tokens WHERE expires_at < now() - interval '1 hour'");
  await pool.query(
    "INSERT INTO sso_tokens (token_hash, user_id, from_app, to_app, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))",
    [hash(token), identityId, fromApp, toApp, SSO_TTL_SECONDS],
  );
  return { token, expiresIn: SSO_TTL_SECONDS };
}

/** Swaps a token for the person. One atomic UPDATE, so two concurrent redeems can never both succeed. */
export async function redeemSsoToken(pool: pg.Pool, toApp: AppKey, input: { token?: unknown }): Promise<PublicUser> {
  if (typeof input.token !== "string" || input.token.length < 20 || input.token.length > 200) {
    throw new ServiceError(400, "invalid_token", "token is required.");
  }
  const res = await pool.query(
    `UPDATE sso_tokens SET used_at = now()
      WHERE token_hash = $1 AND to_app = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [hash(input.token), toApp],
  );
  if (!res.rows.length) throw new ServiceError(401, "invalid_token", "The token is unknown, expired, already used or meant for another app.");
  const user = await getUser(pool, toApp, res.rows[0].user_id);
  if (!user) throw new ServiceError(401, "invalid_token", "The token is unknown, expired, already used or meant for another app.");
  if (user.status === "blocked") throw new ServiceError(403, "blocked", "This person is blocked.");
  return user;
}
