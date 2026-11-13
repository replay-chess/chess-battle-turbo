// Access matrix after P1 (plan §11.1), encoded against the auth of every registry entry, the legacy rows, and (once
// 1B·F4c lands lib/auth/route-classes) the page/API classes from classify(). A change to who may call what has to
// change this table on purpose.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import type { AuthMode, EndpointDef } from "@repo/contracts/http/endpoint";
import { HTTP_ENDPOINTS } from "@repo/contracts/http/registry";
import { INTERNAL_ROUTE_IDS } from "@/lib/auth/internal";
import { WEB } from "../helpers/route-modules";
import { LEGACY_ROUTES } from "./legacy-routes";

const byKey = new Map((HTTP_ENDPOINTS as readonly EndpointDef[]).map((e) => [`${e.method} ${e.path}`, e]));

/** §11.1 API rows that are registry entries: method + path → auth mode. */
const REGISTRY_ROWS: [string, AuthMode][] = [
  ["GET /api/openings", "public"],
  ["GET /api/health", "public"],
  ["GET /api/healthcheck", "public"],
  ["POST /api/session/clear", "optional"],
  ["GET /api/me", "user"],
  ["GET /api/socket-token", "user"],
  ["GET /api/subscription", "user"],
  ["POST /api/billing/refresh", "user"],
  ["POST /api/webhook/dodo-payments", "webhook"],
  ["POST /api/webhook/clerk", "webhook"],
  ["GET /api/cron/daily", "cron"],
  // Phase 2 (§11.1 of the P2 plan).
  ["POST /api/games", "member"],
  ["GET /api/games/{ref}", "user"],
  ["POST /api/games/{ref}/checkpoint", "user"],
  ["POST /api/games/{ref}/complete", "user"],
  ["GET /api/games/{ref}/pgn", "member"],
  // Phase 3 (§11.1 of the P3 plan): reads answer 402 from the handler (review-lapsed-read), writes are member.
  ["GET /api/review/{ref}", "user"],
  ["GET /api/review/{ref}/status", "user"],
  ["POST /api/review/{ref}/analyse", "member"],
  ["POST /api/review/{ref}/retry", "member"],
  ["PATCH /api/review/{ref}/progress", "member"],
  ["PATCH /api/review/{ref}/moments/{ply}", "member"],
  ["POST /api/review/{ref}/complete", "member"],
  ["GET /api/review/{ref}/pgn", "user"],
  ["GET /api/review/{ref}/legend", "user"],
  ["POST /api/review/{ref}/legend/compute", "member"],
  // A10 (member), A11 (user: any signed-in owner can anonymise or stop a link, even after the membership lapsed;
  // owner-scoped in the statement → 404, FIX-1), G1 (handler 402, review-lapsed-read), PR1 (member).
  ["POST /api/review/{ref}/share", "member"],
  ["PATCH /api/share/{code}", "user"],
  ["DELETE /api/share/{code}", "user"],
  ["GET /api/me/games", "user"],
  ["GET /api/practice/context", "member"],
  // Phase 4 (§7.0, §11.1 of the P4 plan): sync and retry are member (402 renders inline); everything a non-member
  // needs to link, onboard, check out and wait for activation is user; the Lichess OAuth hops are optional (the
  // handler redirects a signed-out browser to sign-in instead of answering 401).
  ["GET /api/accounts", "user"],
  ["POST /api/accounts/chesscom/lookup", "user"],
  ["POST /api/accounts/chesscom", "user"],
  ["GET /api/accounts/lichess/start", "optional"],
  ["GET /api/accounts/lichess/callback", "optional"],
  ["POST /api/accounts/{provider}/sync", "member"],
  ["PATCH /api/accounts/{provider}", "user"],
  ["DELETE /api/accounts/{provider}", "user"],
  ["GET /api/import/status", "user"],
  ["POST /api/import/{ref}/retry", "member"],
  ["PATCH /api/me/onboarding", "user"],
  ["POST /api/checkout", "user"],
  ["GET /api/billing/activation", "user"],
];

/** §11.1 rows still served by legacy handlers: file + method → signed out / signed in non-admin. */
const LEGACY_ROWS: [string, string, number, number | undefined][] = [
  // Admin content APIs (A10, A11): 401 / 403.
  ["app/api/legends/create/route.ts", "POST", 401, 403],
  ["app/api/legends/[id]/route.ts", "PUT", 401, 403],
  ["app/api/legends/[id]/route.ts", "DELETE", 401, 403],
  ["app/api/chess-positions/create/route.ts", "POST", 401, 403],
  ["app/api/chess-positions/[id]/route.ts", "PUT", 401, 403],
  ["app/api/chess-positions/[id]/route.ts", "DELETE", 401, 403],
  ["app/api/chess-positions/[id]/route.ts", "GET", 401, 403],
  ["app/api/chess-positions/route.ts", "GET", 401, 403],
  // Socket-only routes (A12): 401 signed out, 403 signed in, 200 with the internal token.
  ["app/api/chess/move/route.ts", "POST", 401, 403],
  ["app/api/chess/game-over/route.ts", "POST", 401, 403],
  ["app/api/chess/game-state/route.ts", "POST", 401, 403],
];

describe("access matrix (plan §11.1)", () => {
  it("registry rows have the auth the matrix says", () => {
    for (const [key, auth] of REGISTRY_ROWS) {
      const entry = byKey.get(key);
      assert.ok(entry, `${key} is missing from the registry`);
      assert.equal(entry.auth, auth, key);
    }
  });

  it("no registry entry is admin, member or internal except where the matrix says", () => {
    const listed = new Map(REGISTRY_ROWS);
    for (const e of HTTP_ENDPOINTS as readonly EndpointDef[]) {
      if (!["admin", "member", "internal", "owner"].includes(e.auth)) continue;
      assert.equal(listed.get(`${e.method} ${e.path}`), e.auth, `${e.id} is ${e.auth}; add it to the matrix`);
    }
  });

  it("legacy rows match the matrix", () => {
    for (const [file, method, anonymous, signedIn] of LEGACY_ROWS) {
      const row = LEGACY_ROUTES.find((r) => r.file === file && r.method === method);
      assert.ok(row, `${method} ${file} has no legacy row (moved to route()? then move it to REGISTRY_ROWS)`);
      assert.equal(row.anonymous, anonymous, `${method} ${file} anonymous`);
      if (signedIn !== undefined) assert.equal(row.signedInNonAdmin, signedIn, `${method} ${file} signed in`);
    }
  });

  it("the removed /api/user/[referenceId] route stays removed (H3)", () => {
    assert.equal(existsSync(path.join(WEB, "app/api/user/[referenceId]/route.ts")), false);
  });

  it("the removed /api/user/email/[email] route stays removed (A15, 1B·F4d)", () => {
    assert.equal(existsSync(path.join(WEB, "app/api/user/email/[email]/route.ts")), false);
  });

  it("the internal token is honoured only on the socket routes and the game read", () => {
    assert.deepEqual([...INTERNAL_ROUTE_IDS].sort(), ["chess.game-by-ref", "chess.game-over", "chess.game-state", "chess.move"]);
  });

  it("page and API classes from classify() (1B·F4c)", async (t) => {
    const modPath = path.join(WEB, "lib/auth/route-classes/index.ts");
    if (!existsSync(modPath)) {
      t.skip("lib/auth/route-classes arrives with 1B·F4c");
      return;
    }
    const mod = (await import(pathToFileURL(modPath).href)) as { classify?: (p: string) => unknown };
    assert.equal(typeof mod.classify, "function");
    const classOf = (p: string) => {
      const c = mod.classify!(p);
      return typeof c === "string" ? c : (c as { kind?: string; class?: string }).kind ?? (c as { class?: string }).class;
    };
    const rows: [string, string][] = [
      ["/", "public"],
      ["/pricing", "public"],
      ["/play", "member"],
      ["/game/x", "member"],
      ["/tournaments", "member"],
      ["/join-tournament/x", "member"],
      ["/onboarding", "signed_in"],
      ["/admin", "signed_in"],
      ["/api/openings", "api_no_clerk"],
      ["/api/webhook/dodo-payments", "api_no_clerk"],
      ["/wp-login.php", "scanner"],
      ["/x/.env", "scanner"],
    ];
    for (const [p, expected] of rows) assert.equal(classOf(p), expected, p);
  });
});
