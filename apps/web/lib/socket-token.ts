// Socket token v2 minting (phase-02 plan §7.1.7, §7.4.2). Server-only (node:crypto through the contracts helper).
//
// The claims, the wire format and verification live in `@repo/contracts/socket/token` (one copy for web and the
// socket server). This file decides the web side only:
//   - which key ring signs: SOCKET_TOKEN_SECRET ("kid:base64[,kid:base64]", the first entry signs). The fallback to
//     the old shared INTERNAL_API_SECRET exists ONLY outside production (dev/test/local) during the WP-D rollout and
//     is removed before the P2 DoD; production never has it (architecture X16);
//   - the claims: `ent` (entitled-until, unix s) from the verified Clerk session claims when they carry it, else
//     from the viewer the request already loaded (no extra statement), `env`, `role`, `name`, optional `e2eRun`
//     (APP_ENV=test only; the e2e fixtures mint with it, never the browser).
//
// `expiresAt` on the wire stays unix SECONDS (P1's shape, read by lib/hooks/useSocketToken.ts and RealtimeBoot).
import { DISPLAY_NAME_MAX, SOCKET_TOKEN_TTL_SEC } from "@repo/contracts/socket/limits";
import {
  type KeyRing,
  type SocketTokenClaims,
  type SocketTokenEnv,
  mintSocketToken,
  parseSocketKeyRing,
} from "@repo/contracts/socket/token";

export const SOCKET_TOKEN_TTL_SECONDS = SOCKET_TOKEN_TTL_SEC;

/** `ent` for a member whose entitlement has no usable end (admin, paywall off, grace): re-minted every 15 min. */
export const OPEN_ENDED_ENT_SEC = 24 * 60 * 60;

type Env = Readonly<Record<string, string | undefined>>;

export type SocketKeySource = "socket_token_secret" | "dev_fallback";

export class SocketTokenConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocketTokenConfigError";
  }
}

/** The app env a token is minted for (the socket compares it with its own APP_ENV). */
export function tokenEnvOf(env: Env = process.env): SocketTokenEnv {
  const value = env.NEXT_PUBLIC_APP_ENV;
  return value === "dev" || value === "test" || value === "production" ? value : "local";
}

/** True where the INTERNAL_API_SECRET fallback may sign user tokens: an explicit dev/test app, or a non-production build. */
export function devFallbackAllowed(env: Env = process.env): boolean {
  const app = env.NEXT_PUBLIC_APP_ENV;
  if (app === "production") return false;
  if (app === "dev" || app === "test") return true;
  return env.NODE_ENV !== "production";
}

/**
 * The signing ring, or null when socket auth is not configured. Throws SocketTokenConfigError for a malformed value
 * (the message never contains key material).
 */
export function socketTokenKeyRing(env: Env = process.env): { ring: KeyRing; source: SocketKeySource } | null {
  const primary = env.SOCKET_TOKEN_SECRET?.trim();
  try {
    if (primary) return { ring: parseSocketKeyRing(primary), source: "socket_token_secret" };
    const legacy = env.INTERNAL_API_SECRET?.trim();
    if (legacy && devFallbackAllowed(env)) return { ring: parseSocketKeyRing(legacy), source: "dev_fallback" };
  } catch (err) {
    throw new SocketTokenConfigError(err instanceof Error ? err.message : "invalid socket token key ring");
  }
  return null;
}

/** The subset of the viewer the claims need (lib/auth/viewer.ts Viewer satisfies it). */
export type TokenViewer = {
  ref: string;
  role: "user" | "admin";
  user: { name: string };
  entitlement: {
    member: boolean;
    entitled: boolean;
    currentPeriodEnd: string | null;
    trial: { active: boolean; endsAt: string | null };
  };
};

const toSec = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

/**
 * Entitled-until (unix s) from the viewer: 0 when not a member; the later of the trial end and the paid period end
 * when that is still ahead; otherwise (admin, paywall off, grace, legacy plans without an end) now + 24 h. The socket
 * only compares `ent > now`, and tokens are re-minted every 15 minutes, so the open-ended value never outlives a change.
 */
export function entitledUntilSec(viewer: TokenViewer, nowMs: number): number {
  if (!viewer.entitlement.member) return 0;
  const nowSec = Math.floor(nowMs / 1000);
  const ends = [
    viewer.entitlement.entitled ? toSec(viewer.entitlement.currentPeriodEnd) : null,
    viewer.entitlement.trial.active ? toSec(viewer.entitlement.trial.endsAt) : null,
  ].filter((v): v is number => v !== null);
  const latest = ends.length ? Math.max(...ends) : 0;
  return latest > nowSec + SOCKET_TOKEN_TTL_SEC ? latest : nowSec + OPEN_ENDED_ENT_SEC;
}

/**
 * Entitled-until from the verified Clerk session claims (`sessionClaims.md`, written by syncClerkClaims) when they
 * carry both `entitled` and `entUntil` (unix s), so a mint outside route() (RealtimeBoot) needs no DB read. Null when
 * the claims do not say (P1's claims have no `entUntil` yet: the caller falls back to the viewer).
 */
export function entFromSessionClaims(md: unknown, nowMs: number): number | null {
  if (!md || typeof md !== "object") return null;
  const { entitled, entUntil } = md as { entitled?: unknown; entUntil?: unknown };
  if (typeof entitled !== "boolean" || typeof entUntil !== "number" || !Number.isFinite(entUntil)) return null;
  if (!entitled) return 0;
  const nowSec = Math.floor(nowMs / 1000);
  return entUntil > nowSec ? Math.floor(entUntil) : 0;
}

/** Display name for the claim: trimmed, at most 40 characters (PlayerView without a DB read). */
export function claimName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > DISPLAY_NAME_MAX ? trimmed.slice(0, DISPLAY_NAME_MAX) : trimmed;
}

export type MintOptions = {
  nowMs: number;
  env?: Env;
  /** `ent` from the session claims when known (entFromSessionClaims); else the viewer decides. */
  ent?: number | null;
  /** APP_ENV=test only (e2e fixtures): isolates the legacy matchmaking pool per Playwright test. */
  e2eRun?: string;
};

export type MintedSocketToken = {
  token: string;
  /** Unix seconds (wire shape of GET /api/socket-token). */
  expiresAt: number;
  claims: SocketTokenClaims;
  source: SocketKeySource;
};

/** Mints a v2 token for the viewer. Throws SocketTokenConfigError when no ring is configured. */
export function mintSocketTokenForViewer(viewer: TokenViewer, options: MintOptions): MintedSocketToken {
  const env = options.env ?? process.env;
  const keys = socketTokenKeyRing(env);
  if (!keys) throw new SocketTokenConfigError("SOCKET_TOKEN_SECRET is not set");
  const tokenEnv = tokenEnvOf(env);
  if (options.e2eRun !== undefined && tokenEnv !== "test") {
    throw new SocketTokenConfigError("e2eRun is for APP_ENV=test only");
  }
  const ent = options.ent ?? entitledUntilSec(viewer, options.nowMs);
  const minted = mintSocketToken(
    {
      sub: viewer.ref,
      env: tokenEnv,
      ent,
      role: viewer.role,
      name: claimName(viewer.user.name),
      ...(options.e2eRun !== undefined ? { e2eRun: options.e2eRun } : {}),
    },
    keys.ring,
    options.nowMs,
  );
  return { token: minted.token, expiresAt: minted.claims.exp, claims: minted.claims, source: keys.source };
}
