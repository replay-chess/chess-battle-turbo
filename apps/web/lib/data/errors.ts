// The server-only data layer's error (phase-03 plan §5.2, CDL): `WEB/lib/data/*` and the services behind them throw
// `DataError("not_found")` for a missing game and for a non-player (404 masking), `DataError("conflict", …)` for a
// state conflict. It is an ApiError, so route() answers it with the code's status and the envelope; an RSC page
// turns `not_found` into notFound() with `isNotFound`.
import { ApiError, type ApiErrorInit } from "@/lib/api/api-error";
import type { ErrorCode } from "@repo/contracts/http/codes";

export class DataError extends ApiError {
  constructor(code: ErrorCode, init: ApiErrorInit = {}) {
    super(code, init);
    this.name = "DataError";
  }
}

/** True for a not-found from the data layer (or any ApiError not_found). */
export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.code === "not_found";
}
