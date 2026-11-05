# @repo/contracts

The HTTP contracts for Replay Chess: zod 4 schemas, the error-code ledger and the endpoint registry. The phase-01 plan describes them in §7.1–§7.3.

Import the subpaths directly, for example `@repo/contracts/http/me` or `@repo/contracts/http/codes`. There is no barrel file. Client code imports types only from `@repo/contracts/http/registry`. Schemas reach the browser only through `devSchema()` in `lib/api/schema.ts`. The package has no Prisma types and no Node built-ins in `src/` (tests and scripts may use them).

| File | What it holds |
|---|---|
| `src/http/codes.ts` | `ERROR_STATUS` (each code maps to one status), `ALLOWED_STATUSES`, and the reason registries `SUBSCRIPTION_REASONS`, `CONFLICT_REASONS` and `FORBIDDEN_REASONS`. Entries are only ever appended. |
| `src/http/envelope.ts` | `ErrorBody`, `ErrorEnvelope`, `PageMeta`, `OkMeta`, `ok(schema)`, `ValidationIssue` |
| `src/http/endpoint.ts` | `EndpointDef`, `defineEndpoint()` (throws when an invariant is broken), `expectedErrorCodes()`, `fillPath()`, and the `Endpoint*` inference types |
| `src/http/cursor.ts` | `encodeCursor` / `decodeCursor` (keyset cursors; anything malformed decodes to `null`) |
| `src/http/common.ts` | `Ref`, `IsoDateTime`, `Limit`, `CursorParam`, `Uci`, `Color`, `FenLoose` |
| `src/http/<area>.ts` | Request and response schemas, one file per area |
| `src/http/registry/<area>.ts` | One `defineEndpoint` entry per route; `index.ts` collects them into `HTTP_ENDPOINTS` |
| `scripts/openapi.ts` | Generates `docs/api/openapi.json` (OpenAPI 3.1) |

## Adding an endpoint

1. Add the schemas to `src/http/<area>.ts`. If the area is new, also add the module to `SCHEMA_MODULES` in `scripts/openapi.ts`.
2. Add a `defineEndpoint({ id, method, path, auth, … })` entry to `src/http/registry/<area>.ts`. If the area is new, create that file and add it to `REGISTRY_AREAS` in `registry/index.ts`. Write dynamic path segments as `{name}`.
3. Run `pnpm --filter @repo/contracts openapi`, then `pnpm --filter @repo/contracts test`. CI regenerates the OpenAPI file and fails when it differs from the committed one.

## Adding an error code or reason

Append it to `codes.ts` in the phase that first produces it. Never remove or remap an entry. Update the pinned list in `codes.test.ts` in the same change.
