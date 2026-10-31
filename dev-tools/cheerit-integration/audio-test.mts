import assert from "node:assert";
const { getAudioValidationIssue: mine } = await import("/Volumes/MACDISK/kartik/WEBSITES/CheerIT-Score-cheer/frontend/src/lib/cheerAudio.ts");
const { getAudioValidationIssue: theirs } = await import("/Volumes/MACDISK/kartik/WEBSITES/CheerIT-COM/src/components/RecordCheerModal/audio/audioMeter.ts");
let n = 0;
for (const mean of [null, -100, -60, -50, -43, -40, -39, -38, -30, -20]) for (const max of [null, -80, -50, -45, -44, -43, -30, -10]) for (const dur of [0, 1, 1.9, 2, 5, 7]) {
  const stats = { meanDb: mean, maxDb: max, isSilent: mean !== null ? mean <= -39 - 4 : true };
  const a = mine(stats, dur), b = theirs(stats, dur);
  // the wording for "no sound captured" is mine; every accept/refuse decision must match
  assert.equal(a === "", b === "", `decision differs for mean=${mean} max=${max} dur=${dur}: "${a}" vs "${b}"`); n++;
}
console.log("same accept/refuse decision as the CheerIT website in", n, "cases");
