// The trial ledger (phase-04 plan 8.4; data-model D15, consistency R-09): one free trial per person, surviving account
// deletion. The table holds hashes only, never an email or a username:
//
//   emailHash    = sha256hex(HASH_PEPPER + "\n" + normaliseEmail(email))
//   handleHashes = ("v:" verified | "u:" unverified) + sha256hex(HASH_PEPPER + "\n" + provider + ":" + usernameLower)
//
// Eligibility (8.4.3) asks the ledger only about the email and the VERIFIED handles (D4-10: an unverified Chess.com
// handle is written but never used to deny a trial, so a squatter cannot burn the real owner's trial). The write
// (8.4.4, on the first trialing snapshot) records every linked handle, verified or not, merged into the existing row.
//
// HASH_PEPPER is read at call time (the backfill B9 and the persona tool set it after importing this module) and is
// never rotated: rotating it would forget every trial. P10's account-deletion path calls the same
// trialLedgerEmailHash(), so the hash must stay byte-for-byte stable (trial-ledger.test.ts pins a vector).
//
// Plain Node: node:crypto only, no Next or Prisma import, so scripts (B9, personas) load it under tsx.
import { createHash } from "node:crypto";

export type LedgerProvider = "chesscom" | "lichess";

/** One linked account as the ledger sees it. */
export type LedgerHandle = { provider: LedgerProvider; usernameLower: string; verified: boolean };

export class HashPepperMissingError extends Error {
  constructor() {
    super("HASH_PEPPER is not set: the trial ledger cannot hash emails or handles");
    this.name = "HashPepperMissingError";
  }
}

/**
 * The shortest pepper accepted (FIX-1, plan §11.3): emails and handles are low-entropy, so anyone who reads
 * `trial_ledger` could reverse a short or guessable pepper with a dictionary. 32 characters is what
 * `openssl rand -hex 32` (64) and `-base64 32` (44) comfortably exceed, the same floor as SIGNED_COOKIE_SECRET.
 */
export const HASH_PEPPER_MIN_LENGTH = 32;

export class HashPepperWeakError extends Error {
  constructor() {
    super(`HASH_PEPPER is shorter than ${HASH_PEPPER_MIN_LENGTH} characters: generate one with \`openssl rand -hex 32\``);
    this.name = "HashPepperWeakError";
  }
}

function pepperOf(pepper: string | undefined): string {
  const value = pepper ?? process.env.HASH_PEPPER;
  if (!value) throw new HashPepperMissingError();
  if (value.length < HASH_PEPPER_MIN_LENGTH) throw new HashPepperWeakError();
  return value;
}

function sha256hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Domains whose mailbox ignores dots in the local part (Gmail and its old alias). */
const DOTLESS_DOMAINS: ReadonlySet<string> = new Set(["gmail.com"]);

/**
 * Plan 8.4.1: trim, lowercase; split at the LAST "@"; googlemail.com → gmail.com; for gmail.com drop every "." of the
 * local part; for every domain drop a "+tag" suffix of the local part. A string without "@" is returned trimmed and
 * lowercased (it still hashes; it can never collide with a real address).
 */
export function normaliseEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at <= 0 || at === lower.length - 1) return lower;
  let local = lower.slice(0, at);
  let domain = lower.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (DOTLESS_DOMAINS.has(domain)) local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

/** sha256hex(HASH_PEPPER + "\n" + normaliseEmail(email)): 64 lower-case hex characters (the table's CHAR(64) key). */
export function trialLedgerEmailHash(email: string, pepper?: string): string {
  return sha256hex(`${pepperOf(pepper)}\n${normaliseEmail(email)}`);
}

/** ("v:" | "u:") + sha256hex(HASH_PEPPER + "\n" + provider + ":" + usernameLower). The username is lowercased again. */
export function handleHash(provider: LedgerProvider, usernameLower: string, verified: boolean, pepper?: string): string {
  return `${verified ? "v:" : "u:"}${sha256hex(`${pepperOf(pepper)}\n${provider}:${usernameLower.trim().toLowerCase()}`)}`;
}

/** The hashes eligibility checks: the email and the verified handles only (D4-10). */
export function enforcedHashes(email: string, handles: readonly LedgerHandle[], pepper?: string): { emailHash: string; handleHashes: string[] } {
  return {
    emailHash: trialLedgerEmailHash(email, pepper),
    handleHashes: handles.filter((h) => h.verified).map((h) => handleHash(h.provider, h.usernameLower, true, pepper)),
  };
}

/** The hashes the write records: the email and every linked handle, verified or not, deduplicated and sorted. */
export function recordedHashes(email: string, handles: readonly LedgerHandle[], pepper?: string): { emailHash: string; handleHashes: string[] } {
  const all = new Set(handles.map((h) => handleHash(h.provider, h.usernameLower, h.verified, pepper)));
  return { emailHash: trialLedgerEmailHash(email, pepper), handleHashes: [...all].sort() };
}

/** Anything that runs one parameterised statement: the Prisma client, a transaction client, a test fake. */
export type LedgerDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): PromiseLike<T>;
};

/**
 * Plan 8.4.3 probe (index `trial_ledger_pkey` for the email; the array overlap scans a table with one row per trial
 * ever). An email match wins over a handle match, so the fraud signal names the stronger key.
 */
export const LEDGER_PROBE_SQL = `SELECT CASE WHEN "emailHash" = $1 THEN 'email' ELSE 'handle' END AS kind
FROM trial_ledger
WHERE "emailHash" = $1 OR "handleHashes" && $2::text[]
ORDER BY ("emailHash" = $1) DESC
LIMIT 1`;

/**
 * Plan 8.4.4 write: insert, or merge the handles into the existing row. `firstTrialAt` keeps the first trial (the
 * column default on insert; never moved by a merge). Idempotent: a repeat changes nothing.
 */
export const LEDGER_WRITE_SQL = `INSERT INTO trial_ledger ("emailHash", "handleHashes", "firstTrialAt")
VALUES ($1, $2::text[], COALESCE($3::timestamp(3), (now() AT TIME ZONE 'UTC')))
ON CONFLICT ("emailHash") DO UPDATE
  SET "handleHashes" = ARRAY(SELECT DISTINCT h FROM unnest(trial_ledger."handleHashes" || EXCLUDED."handleHashes") AS h ORDER BY h)
RETURNING (xmax = 0) AS inserted`;

export type LedgerHit = { hit: false; kind: null } | { hit: true; kind: "email" | "handle" };

/** Is this person's trial already used (by the email or a verified handle)? */
export async function checkTrialLedger(
  db: LedgerDb,
  input: { email: string; handles: readonly LedgerHandle[] },
  pepper?: string,
): Promise<LedgerHit> {
  const { emailHash, handleHashes } = enforcedHashes(input.email, input.handles, pepper);
  const rows = await db.$queryRawUnsafe<{ kind: "email" | "handle" }[]>(LEDGER_PROBE_SQL, emailHash, handleHashes);
  const kind = rows[0]?.kind;
  return kind ? { hit: true, kind } : { hit: false, kind: null };
}

/** Records a started trial (every linked handle). Returns true when a new row was inserted. */
export async function recordTrialLedger(
  db: LedgerDb,
  input: { email: string; handles: readonly LedgerHandle[]; firstTrialAt?: Date | null },
  pepper?: string,
): Promise<boolean> {
  const { emailHash, handleHashes } = recordedHashes(input.email, input.handles, pepper);
  const at = input.firstTrialAt && !Number.isNaN(input.firstTrialAt.getTime()) ? input.firstTrialAt.toISOString() : null;
  const rows = await db.$queryRawUnsafe<{ inserted: boolean }[]>(LEDGER_WRITE_SQL, emailHash, handleHashes, at);
  return rows[0]?.inserted === true;
}
