// Read-only access to an app database. Three independent guards:
// the query must be a single SELECT, it runs inside BEGIN READ ONLY, and it is always rolled back.

const FORBIDDEN = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do|vacuum)\b/i;

export function assertSelectOnly(sql: string): void {
  const text = sql.replace(/--.*$/gm, "").trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(text)) throw new Error("Only SELECT queries are allowed.");
  if (text.includes(";")) throw new Error("Only a single statement is allowed.");
  if (FORBIDDEN.test(text)) throw new Error("Query contains a write keyword.");
}

/** Host, port, database and user only. Never the password. */
export function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.username || "?"}@${u.hostname}:${u.port || "5432"}/${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "(unparseable connection string)";
  }
}

export async function fetchRows(url: string, sql: string): Promise<Record<string, unknown>[]> {
  assertSelectOnly(sql);
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: url,
    statement_timeout: 60_000,
    application_name: "cheerit-identity-dry-run",
  });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query(sql);
    await client.query("ROLLBACK");
    return result.rows;
  } finally {
    await client.end();
  }
}
