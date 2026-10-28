// Reads every source (read-only) into SourceRecords. Shared by the dry run and the writer.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describeUrl, fetchRows } from "./db.ts";
import { SOURCES } from "./sources.ts";
import type { SourceRecord } from "./types.ts";

export interface CollectOptions {
  /** Read `<source>.json` files from this folder instead of databases. */
  fixtures?: string;
  /** Limit to these source or app names. */
  only?: string;
}

export interface Collected {
  records: SourceRecord[];
  read: { source: string; rows: number; origin: string }[];
  skipped: string[];
  /** Connection strings that were actually used, so callers can refuse to write into a source. */
  sourceUrls: string[];
}

export async function collect(options: CollectOptions): Promise<Collected> {
  const wanted = options.only ? new Set(options.only.split(",").map((s) => s.trim())) : null;
  const records: SourceRecord[] = [];
  const read: Collected["read"] = [];
  const skipped: string[] = [];
  const sourceUrls: string[] = [];

  for (const source of SOURCES) {
    if (wanted && !wanted.has(source.name) && !wanted.has(source.appKey)) continue;

    let rows: Record<string, unknown>[] | null = null;
    let origin = "";

    if (options.fixtures) {
      const file = join(options.fixtures, `${source.name}.json`);
      if (existsSync(file)) {
        rows = JSON.parse(readFileSync(file, "utf8"));
        origin = file;
      }
    } else {
      const url = process.env[source.envVar];
      if (url) {
        origin = describeUrl(url);
        sourceUrls.push(url);
        console.log(`Reading ${source.name} from ${origin} (read-only)`);
        rows = await fetchRows(url, source.sql);
      }
    }

    if (!rows) {
      skipped.push(source.name);
      continue;
    }
    read.push({ source: source.name, rows: rows.length, origin });
    for (const row of rows) records.push(source.map(row));
  }

  return { records, read, skipped, sourceUrls };
}
