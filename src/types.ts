export type AppKey = "score" | "booking" | "predictit" | "turfit" | "sponsor" | "com";

// One row from one app's user table, in a shape shared by every app.
export interface SourceRecord {
  appKey: AppKey;
  /** Which extractor produced it, for example "score" or "score_admin". */
  sourceName: string;
  /** The id in that app's own table, always a string. */
  appUserId: string;
  /** TurfIT role or similar. Empty where the app has no roles. */
  appRole: string;
  phoneRaw: string | null;
  /** True when the phone was proven by an OTP login in that app. */
  phoneVerified: boolean;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  gender: string | null;
  city: string | null;
  /** Best signal of when the person last used the app. Null when the app has none. */
  lastActiveAt: Date | null;
  updatedAt: Date | null;
  createdAt: Date | null;
  isActive: boolean | null;
  /** Observations made while extracting, such as "synthetic_email_dropped". */
  notes: string[];
}

export interface Source {
  name: string;
  appKey: AppKey;
  /** Environment variable that holds this app's read-only connection string. */
  envVar: string;
  /** A single SELECT. Run inside a READ ONLY transaction. */
  sql: string;
  map(row: Record<string, unknown>): SourceRecord;
}

export type Severity = "info" | "warning" | "error";

export interface Issue {
  severity: Severity;
  type: string;
  appKey: AppKey | "";
  appUserId: string;
  /** The phone, or the raw value when it could not be normalized. */
  phone: string;
  detail: string;
}

export interface Conflict {
  field: "name" | "email";
  chosen: string;
  values: { value: string; appKey: AppKey; appUserId: string }[];
}

export interface MergedApp {
  appKey: AppKey;
  appUserId: string;
  appRole: string;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

export interface MergedPerson {
  phone: string;
  /** True when any app proved the number by OTP. */
  phoneVerified: boolean;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  gender: string | null;
  city: string | null;
  firstApp: AppKey | null;
  lastLoginAt: Date | null;
  apps: MergedApp[];
  conflicts: Conflict[];
}

export interface AppStats {
  records: number;
  valid: number;
  invalid: number;
}

export interface MergeStats {
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  people: number;
  peopleInMultipleApps: number;
  perApp: Partial<Record<AppKey, AppStats>>;
  overlaps: Record<string, number>;
  conflictsByField: { name: number; email: number };
  unverifiedOnlyPeople: number;
  nonIndianPhones: number;
  invalidByReason: Record<string, number>;
}

export interface MergeResult {
  people: MergedPerson[];
  issues: Issue[];
  stats: MergeStats;
}
