// Legacy response adapter (plan §7.1, CDL §4.1). Lets new client code read routes that have not moved to the
// `{ data, meta? }` envelope yet. Deleted after the last route migrates (tracked by the Sentry tag
// `legacy_envelope`). Error bodies (`{ error: string, code? }`, `{ success: false }`) are read by
// `toApiError` in errors.ts, which maps the status to a code when the body has none.
import type { OkMeta } from "@repo/contracts/http/envelope";

export type LegacyShape = "envelope" | "success" | "raw";

export type Unwrapped =
  | { ok: true; shape: LegacyShape; data: unknown; meta?: OkMeta }
  /** `{ success: false, … }` sent with a 2xx status: the caller turns it into an ApiError. */
  | { ok: false; shape: "success"; body: Record<string, unknown> };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readMeta(v: unknown): OkMeta | undefined {
  if (!isRecord(v)) return undefined;
  const meta: OkMeta = {};
  if (typeof v.nextCursor === "string" || v.nextCursor === null) meta.nextCursor = v.nextCursor;
  if (typeof v.total === "number") meta.total = v.total;
  return meta;
}

/**
 * Reads the three success shapes:
 * - the envelope `{ data, meta? }` (extra top-level keys, such as socket-token's legacy `token` mirror, are ignored);
 * - legacy `{ success: true, data }` (or `{ success: true, ...fields }` without `data`);
 * - a raw object or value (the billing `SubscriptionResponse`), returned whole.
 */
export function unwrapLegacy(json: unknown): Unwrapped {
  if (!isRecord(json)) return { ok: true, shape: "raw", data: json };

  if (typeof json.success === "boolean") {
    if (!json.success) return { ok: false, shape: "success", body: json };
    if ("data" in json) return { ok: true, shape: "success", data: json.data, meta: readMeta(json.meta) };
    const rest = { ...json };
    delete rest.success;
    return { ok: true, shape: "success", data: rest };
  }

  if ("data" in json) return { ok: true, shape: "envelope", data: json.data, meta: readMeta(json.meta) };

  return { ok: true, shape: "raw", data: json };
}
