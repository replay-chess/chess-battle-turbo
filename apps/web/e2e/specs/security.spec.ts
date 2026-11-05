import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "../fixtures";

// Hotfix lane checks (phase-01 plan §12.3, 1B·H): admin content APIs (H1), socket-only game
// writes (H2), PII routes (H3), the game-by-ref projection (H4), and the edge checks that land
// with 1B·F1 (health), 1B·F4c (scanner paths) and 1B·F4a + F4c (cross-site mutation).
//
// Shared members A, B and C only gain data here (one friend game between B and C), as the
// user registry allows. Nothing asserts absolute counts.

type Reply = { status: number; body: unknown; headers: Record<string, string> };

/** fetch() from inside the signed-in page, so Clerk's session cookie is fresh. */
async function pageFetch(
  page: Page,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Reply> {
  return page.evaluate(
    async ({ path, method, body }) => {
      const res = await fetch(path, {
        method: method ?? "GET",
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // not JSON
      }
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return { status: res.status, body: parsed, headers };
    },
    { path, method: init.method, body: init.body },
  );
}

/** The signed-in user's reference id: `GET /api/me` once 1B·F4a lands, else the legacy sync. */
async function myRef(page: Page): Promise<string> {
  const me = await pageFetch(page, "/api/me");
  if (me.status === 200) {
    const ref = (me.body as { data?: { user?: { ref?: string } } }).data?.user?.ref;
    if (ref) return ref;
  }
  const sync = await pageFetch(page, "/api/user/sync", { method: "POST" });
  const ref = (sync.body as { user?: { referenceId?: string } }).user?.referenceId;
  if (!ref) throw new Error(`could not read the user's reference id (sync ${sync.status})`);
  return ref;
}

/** B creates a friend game and C joins it: an IN_PROGRESS game that A is not part of. */
async function createFriendGame(creator: Page, joiner: Page): Promise<string> {
  const creatorRef = await myRef(creator);
  const created = await pageFetch(creator, "/api/chess/create-game", {
    method: "POST",
    body: {
      userReferenceId: creatorRef,
      initialTimeSeconds: 600,
      incrementSeconds: 0,
      gameMode: "friend",
      playAsLegend: false,
      selectedLegend: null,
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const gameRef = (created.body as { data: { game: { referenceId: string } } }).data.game.referenceId;

  const joined = await pageFetch(joiner, "/api/chess/join", {
    method: "POST",
    body: { gameReferenceId: gameRef },
  });
  expect(joined.status, JSON.stringify(joined.body)).toBe(200);
  return gameRef;
}

const GAME_OVER_BODY = (gameReferenceId: string) => ({
  gameReferenceId,
  result: "DRAW",
  method: "draw_agreement",
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  whiteTime: 600_000,
  blackTime: 600_000,
});

/** The admin content API calls of plan A10/A11, with ids that need not exist (auth runs first). */
const ADMIN_CALLS: { method: "GET" | "POST" | "PUT" | "DELETE"; path: string }[] = [
  { method: "POST", path: "/api/legends/create" },
  { method: "PUT", path: "/api/legends/e2e-no-such-legend" },
  { method: "DELETE", path: "/api/legends/e2e-no-such-legend" },
  { method: "POST", path: "/api/chess-positions/create" },
  { method: "PUT", path: "/api/chess-positions/e2e-no-such-position" },
  { method: "DELETE", path: "/api/chess-positions/e2e-no-such-position" },
  { method: "GET", path: "/api/chess-positions" },
  { method: "GET", path: "/api/chess-positions/e2e-no-such-position" },
];

const INTERNAL_CALLS = ["/api/chess/move", "/api/chess/game-over", "/api/chess/game-state"];

async function call(request: APIRequestContext, method: string, path: string, data?: unknown) {
  return request.fetch(path, {
    method,
    data: data ?? (method === "GET" || method === "DELETE" ? undefined : {}),
    failOnStatusCode: false,
    maxRedirects: 0,
  });
}

function errorCode(body: unknown): string | undefined {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
}

test.describe("security: signed out @p1 @smoke @public", () => {
  test("admin content APIs answer 401", async ({ request }) => {
    for (const { method, path } of ADMIN_CALLS) {
      const res = await call(request, method, path);
      expect(res.status(), `${method} ${path}`).toBe(401);
      const body = await res.json();
      expect(errorCode(body), `${method} ${path}`).toBe("unauthorized");
      expect(res.headers()["cache-control"]).toContain("no-store");
    }
  });

  test("socket-only game writes answer 401", async ({ request }) => {
    for (const path of INTERNAL_CALLS) {
      const res = await call(request, "POST", path, GAME_OVER_BODY("e2e-no-such-game"));
      expect(res.status(), path).toBe(401);
    }
  });

  test("PII routes answer 404", async ({ request }) => {
    const email = encodeURIComponent(process.env.E2E_USER_A_EMAIL ?? "anything@example.com");
    expect((await call(request, "GET", `/api/user/email/${email}`)).status()).toBe(404);
    expect((await call(request, "GET", "/api/user/email/anything%40x.com")).status()).toBe(404);
    expect((await call(request, "GET", "/api/user/e2e-some-ref")).status()).toBe(404);
  });

  test("health endpoints", async ({ request }) => {
    const legacy = await call(request, "GET", "/api/healthcheck");
    expect(legacy.status()).toBe(200);
    // GET /api/health arrives with 1B·F1.
    const health = await call(request, "GET", "/api/health");
    expect(health.status()).toBe(200);
    expect(((await health.json()) as { data?: { ok?: boolean } }).data?.ok).toBe(true);
  });

  test("scanner paths are 404 without Clerk work", async ({ request }) => {
    // The middleware short-circuit arrives with 1B·F4c.
    const res = await call(request, "GET", "/wp-login.php");
    expect(res.status()).toBe(404);
    const clerkHeaders = Object.keys(res.headers()).filter((h) => h.startsWith("x-clerk-"));
    expect(clerkHeaders).toEqual([]);
  });
});

test.describe("security: signed in @p1 @smoke", () => {
  test("a member is not an admin: admin content APIs answer 403", async ({ playerA }) => {
    for (const { method, path } of ADMIN_CALLS) {
      const res = await pageFetch(playerA.page, path, {
        method,
        body: method === "GET" || method === "DELETE" ? undefined : {},
      });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(errorCode(res.body), `${method} ${path}`).toBe("forbidden");
    }
  });

  test("game writes are socket-only and game-by-ref hides other people's games", async ({
    playerA,
    playerB,
    playerC,
    request,
  }) => {
    const gameRef = await createFriendGame(playerB.page, playerC.page);

    // H2: a signed-in browser cannot end, move or re-clock someone else's game.
    for (const path of INTERNAL_CALLS) {
      const res = await pageFetch(playerA.page, path, { method: "POST", body: GAME_OVER_BODY(gameRef) });
      expect(res.status, path).toBe(403);
      expect(errorCode(res.body), path).toBe("forbidden");
    }
    // Not even a participant.
    const own = await pageFetch(playerB.page, "/api/chess/game-over", {
      method: "POST",
      body: GAME_OVER_BODY(gameRef),
    });
    expect(own.status).toBe(403);

    // The game is unchanged.
    const asB = await pageFetch(playerB.page, `/api/chess/game-by-ref/${gameRef}`);
    expect(asB.status).toBe(200);
    const full = (asB.body as { data: Record<string, unknown> }).data;
    expect(full.status).toBe("IN_PROGRESS");
    // H4: the participant gets the full body.
    expect(full.creatorTimeRemaining).not.toBeNull();
    expect(full.opponentTimeRemaining).not.toBeNull();
    expect((full.gameData as Record<string, unknown>).gameMode).toBe("friend");

    // H4: A (not a participant) gets the invite projection.
    const asA = await pageFetch(playerA.page, `/api/chess/game-by-ref/${gameRef}`);
    expect(asA.status).toBe(200);
    const projected = (asA.body as { data: Record<string, unknown> }).data;
    const gameData = (projected.gameData ?? {}) as Record<string, unknown>;
    for (const hidden of ["moveHistory", "traceContext", "fen", "playerReferenceId"]) {
      expect(gameData, hidden).not.toHaveProperty(hidden);
    }
    expect(projected.creatorTimeRemaining).toBeNull();
    expect(projected.opponentTimeRemaining).toBeNull();
    expect(projected.status).toBe("IN_PROGRESS");

    // Signed out: the same projection.
    const anon = await call(request, "GET", `/api/chess/game-by-ref/${gameRef}`);
    expect(anon.status()).toBe(200);
    const anonData = ((await anon.json()) as { data: Record<string, unknown> }).data;
    expect(anonData.gameData ?? {}).not.toHaveProperty("traceContext");
    expect(anonData.creatorTimeRemaining).toBeNull();

    // H2 + §8.7: the socket's token ends the game once; a second call is a 409 and counts
    // nothing twice. Needs the web app's INTERNAL_API_SECRET in the test environment.
    const secret = process.env.INTERNAL_API_SECRET;
    if (secret) {
      const headers = { "x-internal-token": secret };
      const first = await request.post("/api/chess/game-over", {
        headers,
        data: GAME_OVER_BODY(gameRef),
        failOnStatusCode: false,
      });
      expect(first.status()).toBe(200);
      const second = await request.post("/api/chess/game-over", {
        headers,
        data: GAME_OVER_BODY(gameRef),
        failOnStatusCode: false,
      });
      expect(second.status()).toBe(409);
      expect(errorCode(await second.json())).toBe("conflict");
    }
  });

  test("the email route only ever answers about the caller", async ({ playerA, playerB }) => {
    const emailA = process.env.E2E_USER_A_EMAIL!;
    // B asking about A: the same 404 as an unknown address.
    const crossed = await pageFetch(playerB.page, `/api/user/email/${encodeURIComponent(emailA)}`);
    expect(crossed.status).toBe(404);
    // A about themself (until 1B·F4d deletes the route): no date of birth, no role.
    const own = await pageFetch(playerA.page, `/api/user/email/${encodeURIComponent(emailA)}`);
    if (own.status === 200) {
      const user = (own.body as { data: { user: Record<string, unknown> } }).data.user;
      expect(user).not.toHaveProperty("dateOfBirth");
      expect(user).not.toHaveProperty("role");
    } else {
      expect(own.status).toBe(404);
    }
  });

  test("a cookie-authenticated mutation from another site is refused", async ({ playerA }) => {
    // Needs 1B·F4a (POST /api/billing/refresh) and the 1B·F4c Origin check.
    const res = await playerA.page.request.post("/api/billing/refresh", {
      headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(403);
  });
});
