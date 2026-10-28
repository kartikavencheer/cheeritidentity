// Starts the identity service.
//
//   IDENTITY_URL=postgresql://.../cheeritidentity node src/server.ts
//
// PORT defaults to 4100. HOST defaults to 127.0.0.1, so only backends on the same server can reach it;
// set HOST=0.0.0.0 only behind a firewall or reverse proxy. The schema files are applied on start.

import { readFileSync } from "node:fs";
import pg from "pg";
import { describeUrl } from "./db.ts";
import { createApp } from "./service/app.ts";

const url = process.env.IDENTITY_URL;
if (!url) throw new Error("Set IDENTITY_URL to the identity database connection string.");

const pool = new pg.Pool({ connectionString: url, max: 10, application_name: "cheerit-identity-service" });
for (const file of ["001_identity_schema.sql", "002_app_clients.sql"]) {
  await pool.query(readFileSync(new URL(`../sql/${file}`, import.meta.url), "utf8"));
}

const port = Number(process.env.PORT ?? 4100);
const host = process.env.HOST ?? "127.0.0.1";
createApp(pool).listen(port, host, () => {
  console.log(`Identity service on http://${host}:${port}, database ${describeUrl(url)}`);
});
