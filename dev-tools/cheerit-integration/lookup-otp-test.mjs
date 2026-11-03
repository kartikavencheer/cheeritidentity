// Real requestOtp from the CheerIT API, against the local copies: a phone that only the identity service knows
// must get a CheerIT account created and move on to "OTP sent"; an unknown phone must still get "No account found".
// SMS cannot go out: HTTP_PROXY points at a dead port for axios. Run:
//   HTTP_PROXY=http://127.0.0.1:9 NO_PROXY=127.0.0.1,localhost node --env-file=<CheerITWebAPI>/.env lookup-otp-test.mjs <CheerITWebAPI dir>
const [api] = process.argv.slice(2);
const key = process.env.IDENTITY_API_KEY; // CheerIT's own key, from its .env
const base = process.env.IDENTITY_SERVICE_URL;
const { default: prisma } = await import(`${api}/src/config/prisma.js`);
const { requestOtp } = await import(`${api}/src/modules/auth/auth.service.js`);
const KNOWN = "9000000771", UNKNOWN = "9000000772", SSO_FORM = "+919000000771";
let bad = 0; const check = (name, ok, extra = "") => { console.log(ok ? "PASS" : "FAIL", name, extra); if (!ok) bad++; };
const cleanup = async () => { await prisma.user.deleteMany({ where: { mobile_number: { in: [KNOWN, UNKNOWN, SSO_FORM] } } }); };
await cleanup();
await fetch(`${base}/v1/users/resolve`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({ phone: SSO_FORM, appUserId: "lookup-test-1", name: "Lookup Test", email: "lookup-test@example.invalid", city: "Pune", gender: "FEMALE", phoneVerified: true }) });
try {
  const r1 = await requestOtp(KNOWN, "dev1", "web");
  const u = await prisma.user.findUnique({ where: { mobile_number: KNOWN } });
  check("known to identity: CheerIT account created", !!u, `(${r1.message})`);
  check("profile copied", u?.full_name === "Lookup Test" && u?.city_name === "Pune" && u?.gender === "FEMALE" && u?.email_address === "lookup-test@example.invalid");
  check("linked to identity", !!u?.identity_id);
  check("did not answer 'No account found'", r1.statusCode !== 404);
  const r2 = await requestOtp(KNOWN, "dev1", "web");
  check("second request reuses the account", (await prisma.user.count({ where: { mobile_number: KNOWN } })) === 1 && r2.statusCode !== 404);
  // Score single sign-on once stored +91...; the website sends 10 digits. Same person: reuse, do not create again.
  const person = await fetch(`${base}/v1/users?phone=${encodeURIComponent(SSO_FORM)}`, { headers: { authorization: `Bearer ${key}` } }).then((r) => r.json());
  await prisma.user.update({ where: { mobile_number: KNOWN }, data: { mobile_number: SSO_FORM } });
  const r4 = await requestOtp(KNOWN, "dev1", "web");
  const rows = await prisma.user.findMany({ where: { identity_id: person.user.id } });
  check("account stored as +91...: reused, phone brought to 10 digits", rows.length === 1 && rows[0].mobile_number === KNOWN && r4.statusCode !== 404, `(${r4.message})`);
  const r3 = await requestOtp(UNKNOWN, "dev1", "web");
  check("unknown everywhere: still 'No account found'", r3.statusCode === 404 && !(await prisma.user.findUnique({ where: { mobile_number: UNKNOWN } })));
} finally { await cleanup(); await prisma.$disconnect(); }
console.log(bad ? `${bad} FAILED` : "ALL PASS"); process.exit(bad ? 1 : 0);
