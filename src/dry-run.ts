// Dry run: reads each app's users, merges them by phone and writes a report.
// It never writes to any database. Live mode only runs SELECTs inside READ ONLY transactions.
//
//   node src/dry-run.ts --fixtures fixtures/demo     read JSON files instead of databases
//   node src/dry-run.ts                              read the databases named in the environment
//   node src/dry-run.ts --only turfit,sponsor        limit to some sources
//   node src/dry-run.ts --out out                    where reports go (default: out)

import { parseArgs } from "node:util";
import { collect } from "./collect.ts";
import { mergeRecords } from "./merge.ts";
import { writeReport } from "./report.ts";

const { values } = parseArgs({
  options: {
    fixtures: { type: "string" },
    only: { type: "string" },
    out: { type: "string", default: "out" },
  },
});

const { records, read, skipped } = await collect({ fixtures: values.fixtures, only: values.only });
const result = mergeRecords(records);
const dir = writeReport(
  result,
  { mode: values.fixtures ? "fixtures" : "live", generatedAt: new Date(), read, skipped },
  values.out!,
);

const { stats } = result;
console.log(
  `\n${stats.totalRecords} records -> ${stats.people} people ` +
    `(${stats.peopleInMultipleApps} in several apps, ${stats.invalidRecords} rejected phones).`,
);
if (skipped.length) console.log(`Skipped: ${skipped.join(", ")}`);
console.log(`Report written to ${dir}`);
