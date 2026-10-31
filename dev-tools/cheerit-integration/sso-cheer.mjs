import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const env = readFileSync("/Volumes/MACDISK/kartik/WEBSITES/CheerIT-Score/backend/.env", "utf8");
const scKey = env.match(/^IDENTITY_API_KEY=(.*)$/m)[1];
const idn = execSync(`psql -h localhost -p 5433 -U avenpc -d cheerit_identity -Atc "select id from users where phone like '%7507355838' limit 1"`).toString().trim();
const A = "http://localhost:4400/api", j = (r) => r.json();
const { token } = await fetch("http://localhost:4100/v1/sso/issue", { method: "POST", headers: { authorization: `Bearer ${scKey}`, "content-type": "application/json" }, body: JSON.stringify({ identityId: idn, toApp: "com" }) }).then(j);
const login = await fetch(`${A}/auth/sso-login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }).then(j);
console.log("sso login:", login.success, login.user?.full_name);
const live = await fetch(`${A}/events/mobile/live`).then(j);
const ev = live.data.find((e) => e.event_name.includes("ScoreIT #10"));
const det = await fetch(`${A}/events/mobile/${ev.event_id}/details?user_id=00000000-0000-0000-0000-000000000000`).then(j);
const team = det.data.teams[0];
const slot = await fetch(`${A}/submissions/upload-url`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${login.accessToken}` }, body: JSON.stringify({ event_id: ev.event_id, user_id: login.user.user_id ?? login.user.id, team_id: team.team_id, mime_type: "image/jpeg", media_name: "sso.jpg", media_size: 20000, duration: 0, city_name: "" }) }).then(j);
console.log("upload slot with the SSO session:", slot.success, slot.status ?? slot.message);
if (slot.success) {
  const form = new FormData(); for (const [k, v] of Object.entries(slot.upload.video.fields)) form.append(k, v);
  form.append("file", new Blob([new Uint8Array(20000)], { type: "image/jpeg" }), "sso.jpg");
  console.log("storage:", (await fetch(slot.upload.video.url, { method: "POST", body: form })).status);
  const d = await fetch(`${A}/submissions/submission-details/${slot.submissionId}`, { headers: { authorization: `Bearer ${login.accessToken}` } }).then(j);
  console.log("saved:", d.data?.status, "|", d.data?.event_name, "|", d.data?.team_name);
}
