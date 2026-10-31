import assert from "node:assert";
import { readFileSync } from "node:fs";
const src = readFileSync("/Volumes/MACDISK/kartik/WEBSITES/CheerIT-Score/frontend/src/lib/bannerDefaults.ts", "utf8");
const fnText = src.match(/function hashString\(value: string\): number \{[\s\S]*?\n\}/)![0].replace(/: string|: number/g, "");
const hashString = new Function(`${fnText}; return hashString;`)();
const { badgeIndex } = await import("/Volumes/MACDISK/kartik/WEBSITES/CheerIT-Score-cheer/backend/server/cheeritEventCreate.ts");
const names = ["MUMBAI", "Chennai", "test1", "test2", "Test Alpha", "Unknown", "", "Ünï Çode ✓", ...Array.from({ length: 500 }, (_, i) => `Team ${i} ${Math.random().toString(36).slice(2, 2 + (i % 9))}`)];
let seen = new Set<number>();
for (const n of names) { const web = (hashString(n) % 10) + 1; assert.equal(badgeIndex(n), web, `mismatch for "${n}"`); seen.add(web); }
console.log("same picture as the website for", names.length, "names; used", seen.size, "of 10 pictures");
