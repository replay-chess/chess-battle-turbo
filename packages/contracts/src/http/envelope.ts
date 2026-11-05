import { z } from "zod";
import { ERROR_CODES } from "./codes";

/** The error body every 4xx/5xx carries (plan §7.1). Unknown codes from a newer server degrade to "internal". */
export const ErrorBody = z.object({
  code: z.enum(ERROR_CODES).catch("internal"),
  /** One safe English sentence; never an exception message. */
  message: z.string(),
  /** validation_failed: path → message. */
  fields: z.record(z.string(), z.string()).optional(),
  /** { reason }, { issues }, { provider }, { upgradeUrl }, { retryAt }, { bucket }, … */
  details: z.record(z.string(), z.unknown()).optional(),
  retryAfterSec: z.number().int().nonnegative().optional(),
  /** Equals the x-request-id header and the Sentry tag request_id. */
  requestId: z.string(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export const ErrorEnvelope = z.object({ error: ErrorBody });
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export const PageMeta = z.object({ nextCursor: z.string().nullable(), total: z.number().int().optional() });
export type PageMeta = z.infer<typeof PageMeta>;

/** `meta` on a success envelope: list endpoints fill nextCursor (and total on the first page). */
export const OkMeta = PageMeta.partial();
export type OkMeta = z.infer<typeof OkMeta>;

/** The success envelope `{ data, meta? }` around a payload schema. */
export const ok = <T extends z.ZodType>(data: T) => z.object({ data, meta: OkMeta.optional() });
export type Ok<T> = { data: T; meta?: OkMeta };

/** One entry of details.issues on validation_failed. */
export const ValidationIssue = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;
