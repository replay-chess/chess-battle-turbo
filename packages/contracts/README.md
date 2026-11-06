# @repo/contracts

The contracts for Replay Chess: zod 4 schemas, the error-code ledger and the endpoint registry (phase-01 plan §7.1–§7.3), plus, from phase 2, socket protocol v2 (`src/socket`, phase-02 plan §7.4) and internal request signing (`src/internal`, §7.5.1).

Import the subpaths directly, for example `@repo/contracts/http/me` or `@repo/contracts/http/codes`. There is no barrel file. Client code imports types only from `@repo/contracts/http/registry`. Schemas reach the browser only through `devSchema()` in `lib/api/schema.ts`. The package has no Prisma types. Node built-ins appear only in the two server-only modules `src/internal/auth.ts` and `src/socket/token.ts` (`node:crypto`); tests and scripts may use them anywhere. ESLint (`replay/no-internal-auth-in-client`) keeps `@repo/contracts/internal/*` out of client code.

| File | What it holds |
|---|---|
| `src/http/codes.ts` | `ERROR_STATUS` (each code maps to one status), `ALLOWED_STATUSES`, and the reason registries `SUBSCRIPTION_REASONS`, `CONFLICT_REASONS` and `FORBIDDEN_REASONS`. Entries are only ever appended. |
| `src/http/envelope.ts` | `ErrorBody`, `ErrorEnvelope`, `PageMeta`, `OkMeta`, `ok(schema)`, `ValidationIssue` |
| `src/http/endpoint.ts` | `EndpointDef`, `defineEndpoint()` (throws when an invariant is broken), `expectedErrorCodes()`, `fillPath()`, and the `Endpoint*` inference types |
| `src/http/cursor.ts` | `encodeCursor` / `decodeCursor` (keyset cursors; anything malformed decodes to `null`) |
| `src/http/common.ts` | `Ref`, `IsoDateTime`, `Limit`, `CursorParam`, `Uci`, `Color`, `FenLoose` |
| `src/http/<area>.ts` | Request and response schemas, one file per area |
| `src/http/registry/<area>.ts` | One `defineEndpoint` entry per route; `index.ts` collects them into `HTTP_ENDPOINTS` |
| `src/http/games.ts` | Phase 2 games area: `GameStart`, `GameCreateBody`, `GameSnapshot`, checkpoint and complete bodies |
| `src/socket/game.ts` | Protocol v2 payloads: `GameState`, `Clocks`, `PlayerView`, `MoveApplied`, `MoveAck`, `LiveGameCard` |
| `src/socket/commands.ts` | Client → server commands (`COMMANDS`: payload, ack, error codes, per-command limit), `ClientToServerEvents` |
| `src/socket/events.ts` | Server → client game events (`GAME_EVENTS`) |
| `src/socket/registry.ts` | One name, one schema for every server event; `EMIT_EVENTS` (what `/internal/emit` may send), `ServerToClientEvents` |
| `src/socket/rooms.ts` | `ROOM.game/spectate/user/tournament`, `parseRoom`. Room strings are built nowhere else (ESLint `replay/no-room-literal`) |
| `src/socket/codes.ts`, `limits.ts` | Socket error and connect-error codes; protocol constants, abuse limits and payload budgets |
| `src/socket/token.ts` | Socket token v2: claims, `mintSocketToken`, `signSocketToken`, `verifySocketToken` (server-only) |
| `src/socket/internal.ts` | Bodies of the socket server's HTTP endpoints (`EmitBody` strict, broadcast, drain, metrics, ready) |
| `src/internal/auth.ts` | HMAC signing of every `/internal/*` hop: key rings, `signInternal`, `verifyInternal`, `ReplayGuard`, per-kid allow-lists (server-only) |
| `src/socket/test/transcript.ts` | Golden transcript format and the 55 design-state names; the files are in `@repo/chess-fixtures/socket/transcripts` |
| `scripts/openapi.ts` | Generates `docs/api/openapi.json` (OpenAPI 3.1) |

## Adding an endpoint

1. Add the schemas to `src/http/<area>.ts`. If the area is new, also add the module to `SCHEMA_MODULES` in `scripts/openapi.ts`.
2. Add a `defineEndpoint({ id, method, path, auth, … })` entry to `src/http/registry/<area>.ts`. If the area is new, create that file and add it to `REGISTRY_AREAS` in `registry/index.ts`. Write dynamic path segments as `{name}`.
3. Run `pnpm --filter @repo/contracts openapi`, then `pnpm --filter @repo/contracts test`. CI regenerates the OpenAPI file and fails when it differs from the committed one.

## Adding an error code or reason

Append it to `codes.ts` in the phase that first produces it. Never remove or remap an entry. Update the pinned list in `codes.test.ts` in the same change.
