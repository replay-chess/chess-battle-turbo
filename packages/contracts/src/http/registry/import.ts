import { defineEndpoint } from "../endpoint";
import { ImportStatusData, RetryImportBody, RetryImportData, RunRefParams } from "../import";

/**
 * Phase-04 plan §7.0 ACC-7, ACC-8, §7.4. Handlers: WEB/app/api/import/** (WP-C). `import-v3` off → 404.
 * ACC-8 is limited per user AND run (IMPORT_RETRY_LIMIT in ../accounts.ts), applied by its handler with
 * `scopedRateSubject(clerkUserId, ref)`.
 */
export const importEndpoints = {
  /** ACC-7. One query; ETag over the runs and the first review. Never enqueues: only the kick CAS (D4-31). */
  status: defineEndpoint({
    id: "import.status",
    method: "GET",
    path: "/api/import/status",
    auth: "user",
    class: "R1",
    cache: "private-etag",
    sideEffects: ["kick_cas", "release_waiting"],
    response: ImportStatusData,
    errors: ["maintenance"],
    summary: "The viewer's newest import runs and the first imported review",
  }),
  /** ACC-8. Member. FAILED → QUEUED (trigger RETRY); 404 another user's ref; 409 `not_failed` / `sync_running`. */
  retry: defineEndpoint({
    id: "import.retry",
    method: "POST",
    path: "/api/import/{ref}/retry",
    auth: "member",
    class: "W2",
    cache: "no-store",
    params: RunRefParams,
    body: RetryImportBody,
    response: RetryImportData,
    status: 202,
    errors: ["conflict", "rate_limited", "maintenance"],
    maxBodyBytes: 1_024,
    summary: "Retries a failed import run",
  }),
} as const;
