// Normalizes phone numbers to E.164. India (+91) is the default country.
// A number that cannot be normalized with confidence is rejected with a reason, never guessed.

export type PhoneFailure =
  | "empty"
  | "not_a_number"
  | "placeholder"
  | "too_short"
  | "too_long"
  | "bad_indian_prefix"
  | "bad_country_format";

export type PhoneResult =
  | { ok: true; e164: string; country: "IN" | "OTHER"; notes: string[] }
  | { ok: false; reason: PhoneFailure; raw: string };

const INDIA_MOBILE = /^[6-9]\d{9}$/;

export function normalizePhone(input: unknown): PhoneResult {
  const raw = input == null ? "" : String(input).trim();
  const fail = (reason: PhoneFailure): PhoneResult => ({ ok: false, reason, raw });

  if (!raw) return fail("empty");
  // Letters or symbols other than the usual formatting characters mean this is not a phone number.
  if (/[^\d\s+\-().]/.test(raw)) return fail("not_a_number");

  let digits = raw.replace(/\D/g, "");
  if (!digits) return fail("empty");
  if (/^(\d)\1+$/.test(digits)) return fail("placeholder");

  const notes: string[] = [];
  let international = raw.startsWith("+");
  if (!international && digits.startsWith("00")) {
    international = true;
    digits = digits.slice(2);
    notes.push("stripped_00_prefix");
  }

  if (international) {
    if (digits.startsWith("91")) {
      let rest = digits.slice(2);
      if (rest.length === 11 && rest.startsWith("0")) {
        rest = rest.slice(1);
        notes.push("stripped_trunk_zero");
      }
      return indian(rest, notes, fail);
    }
    if (digits.length < 8) return fail("too_short");
    if (digits.length > 15) return fail("too_long");
    if (digits.startsWith("0")) return fail("bad_country_format");
    return { ok: true, e164: `+${digits}`, country: "OTHER", notes };
  }

  // National format, no plus sign.
  if (digits.length === 13 && digits.startsWith("091")) {
    notes.push("stripped_country_code", "stripped_trunk_zero");
    return indian(digits.slice(3), notes, fail);
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    notes.push("stripped_country_code");
    return indian(digits.slice(2), notes, fail);
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    notes.push("stripped_trunk_zero");
    return indian(digits.slice(1), notes, fail);
  }
  return indian(digits, notes, fail);
}

function indian(
  national: string,
  notes: string[],
  fail: (reason: PhoneFailure) => PhoneResult,
): PhoneResult {
  if (national.length < 10) return fail("too_short");
  if (national.length > 10) return fail("too_long");
  if (/^(\d)\1+$/.test(national)) return fail("placeholder");
  if (!INDIA_MOBILE.test(national)) return fail("bad_indian_prefix");
  return { ok: true, e164: `+91${national}`, country: "IN", notes };
}
