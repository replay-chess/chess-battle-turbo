import { NextResponse } from "next/server";

/**
 * Error envelope for legacy route handlers changed by the hotfix lane (1B·H).
 *
 * The body matches `ErrorEnvelope` from `@repo/contracts/http/envelope` (plan §7.1):
 * `{ error: { code, message, details?, requestId } }`, with `Cache-Control: private, no-store`
 * and `x-request-id` on the response. It is self-contained so the `main` cherry-pick does not
 * depend on the contracts package; once a route moves to `route()` (1B·F1) it throws
 * `ApiError` instead and this helper is no longer needed there.
 */
export const HOTFIX_ERROR_STATUS = {
  invalid_json: 400,
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  internal: 500,
} as const;

export type HotfixErrorCode = keyof typeof HOTFIX_ERROR_STATUS;

export type ErrorResponseInit = {
  /** Echoed when the caller (middleware or socket) sent one; otherwise generated. */
  requestId?: string | null;
  details?: Record<string, unknown>;
  fields?: Record<string, string>;
};

export function errorResponse(
  code: HotfixErrorCode,
  message: string,
  init: ErrorResponseInit = {},
): NextResponse {
  const requestId = init.requestId || crypto.randomUUID();
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(init.fields ? { fields: init.fields } : {}),
        ...(init.details ? { details: init.details } : {}),
        requestId,
      },
    },
    {
      status: HOTFIX_ERROR_STATUS[code],
      headers: { "Cache-Control": "private, no-store", "x-request-id": requestId },
    },
  );
}

/** The request id a caller sent, if any (`x-request-id`). */
export function requestIdOf(request: { headers: Headers }): string | null {
  return request.headers.get("x-request-id");
}

type IssueLike = { path: PropertyKey[]; code: string; message: string };

/** 400 `validation_failed` from zod issues: `fields` maps `path.join(".")` → message (plan §7.1). */
export function validationErrorResponse(
  issues: readonly IssueLike[],
  requestId?: string | null,
): NextResponse {
  const fields: Record<string, string> = {};
  const list = issues.map((issue) => {
    const path = issue.path.map(String);
    fields[path.join(".")] ??= issue.message;
    return { path, code: issue.code, message: issue.message };
  });
  return errorResponse("validation_failed", "Some fields are invalid.", {
    requestId,
    fields,
    details: { issues: list },
  });
}
