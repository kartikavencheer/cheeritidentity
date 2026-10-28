// API keys for app backends. A key is shown once when issued; only its SHA-256 is stored.
// The key decides which app is calling, so an app can never write memberships for another app.

import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type pg from "pg";
import type { AppKey } from "../types.ts";

export const APP_KEYS: AppKey[] = ["score", "booking", "predictit", "turfit", "sponsor", "com"];

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export function newKey(appKey: AppKey): string {
  return `cid_${appKey}_${randomBytes(32).toString("base64url")}`;
}

/** Revokes the app's current key, if any, and returns a new one. */
export async function issueKey(pool: pg.Pool, appKey: AppKey): Promise<string> {
  const key = newKey(appKey);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE app_clients SET revoked_at = now() WHERE app_key = $1 AND revoked_at IS NULL", [appKey]);
    await client.query("INSERT INTO app_clients (app_key, key_hash, key_prefix) VALUES ($1, $2, $3)", [appKey, hashKey(key), key.slice(0, 16)]);
    await client.query("COMMIT");
    return key;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function requireAppKey(pool: pg.Pool) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const match = /^Bearer (\S+)$/.exec(req.get("authorization") ?? "");
    if (!match) return res.status(401).json({ error: "missing_api_key" });
    const found = await pool.query("SELECT app_key FROM app_clients WHERE key_hash = $1 AND revoked_at IS NULL", [hashKey(match[1])]);
    if (!found.rows.length) return res.status(401).json({ error: "invalid_api_key" });
    res.locals.appKey = found.rows[0].app_key as AppKey;
    next();
  };
}
