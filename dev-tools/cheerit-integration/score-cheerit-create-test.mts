import http from "node:http";
import assert from "node:assert";
const db = { venues: [] as any[], comps: [] as any[], teams: [] as any[], groups: [] as any[], ct: [] as any[], events: [] as any[], calls: [] as string[] };
let id = 0; const uid = () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`;
const srv = http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => {
    const u = new URL(req.url!, "http://x"); const p = u.pathname;
    const multipart = (req.headers["content-type"] || "").startsWith("multipart/");
    const b: any = multipart ? Object.fromEntries([...raw.matchAll(/name="(\w+)"\r\n\r\n([^\r]*)\r\n/g)].map((m) => [m[1], m[2]])) : raw ? JSON.parse(raw) : {};
    if (multipart) b.has_logo = /name="logo"; filename="logo\.(webp|png|jpg)"/.test(raw);
    db.calls.push(`${req.method} ${p}${u.search}`);
    const send = (s: number, j: any) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    if (req.method === "GET" && p === "/api/venues") return send(200, db.venues);
    if (req.method === "POST" && p === "/api/venues") { const v = { venue_id: uid(), ...b }; db.venues.push(v); return send(201, v); }
    if (req.method === "GET" && p === "/api/competition") return send(200, db.comps);
    if (req.method === "POST" && p === "/api/competition") { const c = { competition_id: uid(), ...b }; db.comps.push(c); return send(201, c); }
    if (req.method === "GET" && p === "/api/event-groups") return send(200, { success: true, data: db.groups });
    if (req.method === "POST" && p === "/api/event-groups") { const g = { group_id: uid(), ...b }; db.groups.push(g); return send(201, { success: true, data: g }); }
    if (req.method === "GET" && p === "/api/team") return send(200, db.teams);
    if (req.method === "POST" && p === "/api/team") { if (db.teams.some((t) => t.name === b.name)) return send(500, { error: "unique" }); if (b.short_name.length > 10) return send(400, { message: "short" }); const t = { team_id: uid(), ...b, logo_url: b.has_logo ? "/uploads/teamlogos/x.webp" : null }; db.teams.push(t); return send(201, { success: true, data: t.team_id }); }
    if (req.method === "PUT" && p.startsWith("/api/team/")) { const t = db.teams.find((x) => x.team_id === p.split("/").pop()); if (t && b.has_logo) t.logo_url = "/uploads/teamlogos/y.webp"; return send(200, t ?? {}); }
    if (req.method === "POST" && p === "/api/competition-team") { db.ct.push(b); return send(200, { message: "Teams added" }); }
    if (req.method === "POST" && p === "/api/events") { assert(db.ct.length, "teams must join competition first"); if (!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(b.start_time)) return send(500, { message: "Invalid Date" }); if (b.access_type === "PRIVATE" && !b.group_ids?.length) return send(400, { message: "At least one group is required for private events" }); const e = { event_id: uid(), ...b }; db.events.push(e); return send(201, { event: e }); }
    if (req.method === "GET" && p === "/api/events/mobile/live") { const all = u.searchParams.get("access_scope") === "all"; return send(200, { success: true, data: db.events.filter((e) => all || e.access_type === "PUBLIC").map((e) => ({ event_id: e.event_id, event_name: e.event_name })) }); }
    send(404, {});
  });
}).listen(0);
await new Promise((r) => srv.once("listening", r));
process.env.CHEERIT_API_URL = `http://localhost:${(srv.address() as any).port}`;
const { createCheeritEvent, clearCreateCache } = await import("/Volumes/MACDISK/kartik/WEBSITES/CheerIT-Score-cheer/backend/server/cheeritEventCreate.ts");
const base = { matchId: 1, sportType: "cricket", status: "live", sides: [{ name: "Mumbai Lions", shortCode: "MLI" }, { name: "Pune Tigers", shortCode: null }], events: [] as any[] };

assert.equal((await createCheeritEvent(base)).created, false); assert.equal((await createCheeritEvent(base) as any).reason, "disabled");
process.env.CHEERIT_CREATE_EVENTS = "on";
assert.equal((await createCheeritEvent({ ...base, matchId: 2, status: "scheduled" }) as any).reason, "not_live");
assert.equal((await createCheeritEvent({ ...base, matchId: 2, sportType: "pickleball" }) as any).reason, "not_supported");
assert.equal((await createCheeritEvent({ ...base, matchId: 2, sides: [base.sides[0]] }) as any).reason, "no_teams");
assert.equal((await createCheeritEvent({ ...base, matchId: 2, events: [{ id: "e", name: "Mumbai Lions vs Pune Tigers" }] }) as any).reason, "exists");
assert.equal(db.calls.length, 0, "nothing sent for refused cases");

// no ScoreIT competition and no org -> fails safely, creates nothing
let r: any = await createCheeritEvent({ ...base, matchId: 3 }); assert.equal(r.reason, "failed"); assert.equal(db.events.length, 0);
await new Promise((r) => setTimeout(r, 300)); process.env.CHEERIT_ORG_ID = "11111111-1111-4111-8111-111111111111"; clearCreateCache();
// two concurrent page loads -> one event
const [x, y]: any[] = await Promise.all([createCheeritEvent({ ...base, matchId: 4 }), createCheeritEvent({ ...base, matchId: 4 })]);
assert(x.created && y.created && x.eventId === y.eventId); assert.equal(db.events.length, 1);
const e = db.events[0];
assert.equal(e.event_name, "Mumbai Lions vs Pune Tigers (ScoreIT #4)"); assert.equal(e.access_type, "PRIVATE"); assert.equal(e.eventstatus_id, 3); assert.equal(e.eventtype_id, 1);
assert.equal(e.allow_video_with_audio, true, "video cheers must be on"); assert.equal(e.team_ids.length, 2); assert.equal(e.allow_video_duration_sec, 7); assert(e.end_time > e.start_time); assert.equal(e.group_ids.length, 1); assert.deepEqual(db.groups.map((g) => g.group_name), ["ScoreIT"]);
assert.deepEqual(db.venues.map((v) => v.venue_name), ["ScoreIT"]); assert.deepEqual(db.comps.map((c) => c.name), ["ScoreIT"]);
assert.deepEqual(db.teams.map((t) => t.short_name).sort(), ["MLI", "PT"]);
// public list hides it, access_scope=all (what Score now asks) shows it
const live = await (await fetch(`${process.env.CHEERIT_API_URL}/api/events/mobile/live`)).json(); assert.equal(live.data.length, 0);
const { parseLiveEvents, pickEvent } = await import("/Volumes/MACDISK/kartik/WEBSITES/CheerIT-Score-cheer/backend/server/cheeritEvent.ts");
const all = parseLiveEvents(await (await fetch(`${process.env.CHEERIT_API_URL}/api/events/mobile/live?access_scope=all`)).json());
assert.equal(pickEvent(all, ["Mumbai Lions", "Pune Tigers"], 4).event?.id, e.event_id); assert.equal(pickEvent(all, ["Mumbai Lions", "Pune Tigers"], 40).reason, "no_match", "#4 is not #40, and a marked event is not a hand-made one");
// the SAME match is not duplicated; a DIFFERENT match between the same teams gets its own event
assert.equal(((await createCheeritEvent({ ...base, matchId: 4, events: all })) as any).reason, "exists");
const before = db.events.length; const other: any = await createCheeritEvent({ ...base, matchId: 5, events: all });
assert(other.created && other.eventId !== e.event_id && db.events.length === before + 1, "match 5 has its own event"); assert.match(other.eventName, /\(ScoreIT #5\)/);
const twice: any = await createCheeritEvent({ ...base, matchId: 5, events: [...all, { id: other.eventId, name: other.eventName }] }); assert.equal(twice.reason, "exists");
// a hand-made event naming both teams still counts as existing
assert.equal(((await createCheeritEvent({ ...base, matchId: 99, events: [{ id: "h", name: "Mumbai Lions vs Pune Tigers" }] })) as any).reason, "exists");
// existing teams and venue are reused, not duplicated
clearCreateCache(); const r2: any = await createCheeritEvent({ ...base, matchId: 6, sides: [base.sides[0], { name: "Delhi Dogs", shortCode: "DD" }] });
assert(r2.created); assert.equal(db.venues.length, 1); assert.equal(db.comps.length, 1); assert.equal(db.teams.length, 3);
assert(db.teams.every((t) => t.logo_url), "every team created gets a picture (uploaded or the default badge)");
// public mode: no group, access PUBLIC
process.env.CHEERIT_EVENT_ACCESS = "public"; clearCreateCache(); const groupsBefore = db.groups.length;
const rp: any = await createCheeritEvent({ ...base, matchId: 8, sides: [{ name: "Pub One", shortCode: "P1" }, { name: "Pub Two", shortCode: "P2" }] });
assert(rp.created); const pe = db.events.find((x) => x.event_id === rp.eventId); assert.equal(pe.access_type, "PUBLIC"); assert.equal(pe.group_ids, undefined); assert.equal(db.groups.length, groupsBefore);
delete process.env.CHEERIT_EVENT_ACCESS;
// football and badminton: own competition and event type, cricket's competition untouched
delete process.env.CHEERIT_EVENT_ACCESS; clearCreateCache();
const rf: any = await createCheeritEvent({ ...base, matchId: 20, sportType: "football", sides: [{ name: "FC One", shortCode: "F1" }, { name: "FC Two", shortCode: "F2" }] });
const rb: any = await createCheeritEvent({ ...base, matchId: 21, sportType: "badminton", sides: [{ name: "Bad One", shortCode: "B1" }, { name: "Bad Two", shortCode: "B2" }] });
assert(rf.created && rb.created);
const ev = (id: string) => db.events.find((x) => x.event_id === id);
assert.equal(ev(rf.eventId).eventtype_id, 2); assert.equal(ev(rb.eventId).eventtype_id, 8);
const compOf = (id: string) => db.comps.find((c) => c.competition_id === ev(id).competition_id);
assert.equal(compOf(rf.eventId).name, "ScoreIT Football"); assert.equal(compOf(rf.eventId).eventtype_id, 2);
assert.equal(compOf(rb.eventId).name, "ScoreIT Badminton"); assert.equal(compOf(rb.eventId).eventtype_id, 8);
assert.equal(compOf(x.eventId).name, "ScoreIT"); assert.equal(compOf(x.eventId).eventtype_id, 1);
// CheerIT down -> never throws
srv.close(); clearCreateCache(); r = await createCheeritEvent({ ...base, matchId: 7 }); assert.equal(r.reason, "failed");
console.log("ALL PASSED"); process.exit(0);
