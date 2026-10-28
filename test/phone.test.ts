import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone } from "../src/phone.ts";

const ok = (input: unknown, e164: string) => {
  const r = normalizePhone(input);
  assert.equal(r.ok, true, `${String(input)} should be accepted`);
  if (r.ok) assert.equal(r.e164, e164);
};
const bad = (input: unknown, reason: string) => {
  const r = normalizePhone(input);
  assert.equal(r.ok, false, `${String(input)} should be rejected`);
  if (!r.ok) assert.equal(r.reason, reason);
};

test("accepts every Indian format the apps store", () => {
  ok("9876543210", "+919876543210");
  ok("09876543210", "+919876543210");
  ok("919876543210", "+919876543210");
  ok("+919876543210", "+919876543210");
  ok("+91 98765 43210", "+919876543210");
  ok("+91-98765-43210", "+919876543210");
  ok("(98765) 43210", "+919876543210");
  ok("0919876543210", "+919876543210");
  ok("00919876543210", "+919876543210");
  ok("+91 09876543210", "+919876543210");
  ok("  9876543210  ", "+919876543210");
  ok(9876543210, "+919876543210");
});

test("accepts other countries in E.164 form", () => {
  ok("+14155550123", "+14155550123");
  ok("0014155550123", "+14155550123");
  const r = normalizePhone("+14155550123");
  assert.equal(r.ok && r.country, "OTHER");
});

test("rejects numbers that cannot be trusted, with a reason", () => {
  bad(null, "empty");
  bad("", "empty");
  bad("   ", "empty");
  bad("abc", "not_a_number");
  bad("98765 4321 x", "not_a_number");
  bad("12345", "too_short");
  bad("987654321", "too_short");
  bad("98765432101234", "too_long");
  bad("5876543210", "bad_indian_prefix");
  bad("1234567890", "bad_indian_prefix");
  bad("0000000000", "placeholder");
  bad("9999999999", "placeholder");
  bad("+91 99999 99999", "placeholder");
  bad("+91 12345", "too_short");
  bad("+910000", "too_short");
});

test("the same person written four ways normalizes to one number", () => {
  const forms = ["9876543210", "+91 98765 43210", "09876543210", "919876543210"];
  assert.equal(new Set(forms.map((f) => (normalizePhone(f) as { e164: string }).e164)).size, 1);
});
