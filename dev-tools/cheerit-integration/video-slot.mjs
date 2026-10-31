import { readFileSync } from "node:fs"; import { execSync } from "node:child_process";
const env = readFileSync("/Volumes/MACDISK/kartik/WEBSITES/CheerIT-Score/backend/.env", "utf8");
const scKey = env.match(/^IDENTITY_API_KEY=(.*)$/m)[1];
const idn = execSync(`psql -h localhost -p 5433 -U avenpc -d cheerit_identity -Atc "select id from users where phone like '%7507355838' limit 1"`).toString().trim();
const A = "http://localhost:4400/api", j = (r) => r.json();
const { token } = await fetch("http://localhost:4100/v1/sso/issue", { method: "POST", headers: { authorization: `Bearer ${scKey}`, "content-type": "application/json" }, body: JSON.stringify({ identityId: idn, toApp: "com" }) }).then(j);
const login = await fetch(`${A}/auth/sso-login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }).then(j);
const ev = (await fetch(`${A}/events/mobile/live`).then(j)).data.find((e) => e.event_name.includes("ScoreIT #10"));
const det = await fetch(`${A}/events/mobile/${ev.event_id}/details?user_id=00000000-0000-0000-0000-000000000000`).then(j);
console.log("card sees allow_video_with_audio =", det.data.event.allow_video_with_audio, "| allow_video =", det.data.event.allow_video);
const slot = await fetch(`${A}/submissions/upload-url`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${login.accessToken}` },
  body: JSON.stringify({ event_id: ev.event_id, user_id: login.user.user_id ?? login.user.id, team_id: det.data.teams[0].team_id, mime_type: "video/mp4", media_name: "cheer.mp4", media_size: 1800000, duration: 7, city_name: "" }) }).then(j);
console.log("video upload slot:", slot.success, slot.status ?? slot.message, "| thumbnail slot:", !!slot.upload?.thumbnail);
