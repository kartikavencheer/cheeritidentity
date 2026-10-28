// Issues an API key for one app backend, revoking its previous key. The key is printed once and never stored.
//
//   IDENTITY_URL=... node src/issue-key.ts score
//
// Put the key in that app's backend .env as IDENTITY_API_KEY.

import { readFileSync } from "node:fs";
import pg from "pg";
import { APP_KEYS, issueKey } from "./service/auth.ts";
import type { AppKey } from "./types.ts";

const url = process.env.IDENTITY_URL;
if (!url) throw new Error("Set IDENTITY_URL to the identity database connection string.");
const appKey = process.argv[2] as AppKey;
if (!APP_KEYS.includes(appKey)) throw new Error(`Usage: node src/issue-key.ts <${APP_KEYS.join("|")}>`);

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await pool.query(readFileSync(new URL("../sql/002_app_clients.sql", import.meta.url), "utf8"));
  const key = await issueKey(pool, appKey);
  console.log(`New key for ${appKey} (any previous key is now revoked):\n\n${key}\n\nStore it in that backend's .env as IDENTITY_API_KEY. It cannot be shown again.`);
} finally {
  await pool.end();
}
