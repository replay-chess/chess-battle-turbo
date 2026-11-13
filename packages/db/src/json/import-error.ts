// JSON column registry entry for linked_accounts."lastError" and import_runs.error (phase-04 plan 6.4, 8.11).
//
// `message` is for logs and support only (≤ 200 chars, never an upstream body, a URL with a token, or an email); the
// wire view (`ImportErrorView` in @repo/contracts/http/accounts) carries only code, at and retryAt. `token_revoked`
// was dropped with D4-21 (no Lichess token is ever stored).
import { IMPORT_ERROR_CODES } from "@repo/contracts/http/p04-plain";
import { z } from "zod";

/** One list for the wire and the column: the contracts' zod-free module is the source. */
export { IMPORT_ERROR_CODES };
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

export const IMPORT_ERROR_MESSAGE_MAX = 200;

export const ImportErrorV1 = z.object({
  v: z.literal(1),
  code: z.enum(IMPORT_ERROR_CODES),
  message: z.string().max(IMPORT_ERROR_MESSAGE_MAX),
  at: z.iso.datetime(),
  /** When the import may try again (a provider Retry-After or the job back-off). */
  retryAt: z.iso.datetime().optional(),
  /** The upstream status that caused it, when there was one. */
  httpStatus: z.number().int().min(100).max(599).optional(),
});
export type ImportErrorV1 = z.infer<typeof ImportErrorV1>;

/** Strips URLs, emails and control characters, then truncates (messages may quote an exception). */
export function sanitiseImportMessage(message: string): string {
  const cleaned = message
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "<email>")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim();
  return cleaned.length > IMPORT_ERROR_MESSAGE_MAX ? `${cleaned.slice(0, IMPORT_ERROR_MESSAGE_MAX - 1)}…` : cleaned;
}

/** Builds a valid value (sanitised message, ISO instants). */
export function importError(
  code: ImportErrorCode,
  message: string,
  at: Date,
  extra: { retryAt?: Date | null; httpStatus?: number | null } = {},
): ImportErrorV1 {
  return ImportErrorV1.parse({
    v: 1,
    code,
    message: sanitiseImportMessage(message),
    at: at.toISOString(),
    ...(extra.retryAt ? { retryAt: extra.retryAt.toISOString() } : {}),
    ...(extra.httpStatus ? { httpStatus: extra.httpStatus } : {}),
  });
}

/** Reads a stored value; null when absent or unreadable. */
export function parseImportError(value: unknown): ImportErrorV1 | null {
  const parsed = ImportErrorV1.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The wire view: `{code, at, retryAt}` (retryAt null when absent). */
export function importErrorView(value: ImportErrorV1): { code: ImportErrorCode; at: string; retryAt: string | null } {
  return { code: value.code, at: value.at, retryAt: value.retryAt ?? null };
}
