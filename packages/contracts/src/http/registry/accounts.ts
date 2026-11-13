import { defineEndpoint } from "../endpoint";
import {
  ACCOUNT_LINK_LIMIT,
  ACCOUNT_LOOKUP_LIMITS,
  ACCOUNT_SETTINGS_LIMIT,
  AccountsData,
  LichessCallbackQuery,
  LichessStartQuery,
  LinkChessComBody,
  LinkData,
  LinkedAccountView,
  LookupBody,
  LookupData,
  PatchAccountBody,
  ProviderParams,
  SyncBody,
  SyncData,
  UnlinkData,
  UnlinkQuery,
} from "../accounts";

/**
 * Phase-04 plan §7.0 ACC-1…ACC-6, OAU-1/2 (D4-01: `/api/accounts/*`). Handlers: WEB/app/api/accounts/** (WP-C).
 * `import-v3` off → every route answers 404 (§7.10). The P1 maintenance notice with `affects: ["import"]` → 503.
 *
 * Rate limits the wrapper applies are on the entries. ACC-4 sync is limited per user AND provider
 * (ACCOUNT_SYNC_LIMIT in ../accounts.ts), which the wrapper cannot key, so its handler applies it with
 * `scopedRateSubject(clerkUserId, provider)`; the entry lists `rate_limited` in `errors` instead.
 */
export const accountsEndpoints = {
  /** ACC-1. Both providers' links with their newest run; ETag over the body. */
  list: defineEndpoint({
    id: "accounts.list",
    method: "GET",
    path: "/api/accounts",
    auth: "user",
    class: "R1",
    cache: "private-etag",
    response: AccountsData,
    errors: ["maintenance"],
    summary: "The viewer's linked Chess.com and Lichess accounts",
  }),
  /** ACC-2. Cached 600 s server-side (`not_found` too); web first, worker fallback on an upstream 429/403 (D4-23). */
  lookup: defineEndpoint({
    id: "accounts.chesscom.lookup",
    method: "POST",
    path: "/api/accounts/chesscom/lookup",
    auth: "user",
    class: "X",
    cache: "no-store",
    rateLimit: [...ACCOUNT_LOOKUP_LIMITS],
    body: LookupBody,
    response: LookupData,
    errors: ["not_found", "conflict", "upstream_unavailable", "maintenance"],
    maxBodyBytes: 1_024,
    summary: "Looks up a Chess.com profile and its ratings",
  }),
  /** ACC-3. Idempotency-Key required (scope `link-chesscom`); 201 new link, 200 the same account again. */
  linkChessCom: defineEndpoint({
    id: "accounts.chesscom.link",
    method: "POST",
    path: "/api/accounts/chesscom",
    auth: "user",
    class: "X",
    cache: "no-store",
    rateLimit: ACCOUNT_LINK_LIMIT,
    body: LinkChessComBody,
    response: LinkData,
    status: 201,
    errors: ["not_found", "conflict", "upstream_unavailable", "idempotency_key_reused", "maintenance"],
    maxBodyBytes: 1_024,
    summary: "Links a Chess.com account and creates its first import run",
  }),
  /** OAU-1. 302 to Lichess's consent page with PKCE S256, no scopes; sets the signed `rc_lichess_pkce` cookie. */
  lichessStart: defineEndpoint({
    id: "accounts.lichess.start",
    method: "GET",
    path: "/api/accounts/lichess/start",
    auth: "optional",
    cache: "no-store",
    rateLimit: ACCOUNT_LINK_LIMIT,
    query: LichessStartQuery,
    status: 302,
    summary: "Starts the Lichess OAuth link (redirect); signed out → the sign-in page",
  }),
  /**
   * OAU-2. Exchanges the code, reads /api/account (the ownership proof) and revokes the token in a `finally` before
   * it responds (D4-21); every outcome is a 302 to `returnTo?lichess=…`.
   */
  lichessCallback: defineEndpoint({
    id: "accounts.lichess.callback",
    method: "GET",
    path: "/api/accounts/lichess/callback",
    auth: "optional",
    class: "X",
    cache: "no-store",
    query: LichessCallbackQuery,
    status: 302,
    sideEffects: ["oauth_link"],
    summary: "Completes the Lichess OAuth link (redirect)",
  }),
  /** ACC-4. Member. 202 with the queued run; 409 `sync_running`; 429 from the scoped limit or `nextAllowedSyncAt`. */
  sync: defineEndpoint({
    id: "accounts.sync",
    method: "POST",
    path: "/api/accounts/{provider}/sync",
    auth: "member",
    class: "W2",
    cache: "no-store",
    params: ProviderParams,
    body: SyncBody,
    response: SyncData,
    status: 202,
    errors: ["conflict", "rate_limited", "maintenance"],
    maxBodyBytes: 1_024,
    summary: "Starts a manual sync of one linked account",
  }),
  /** ACC-5. The daily auto-import switch (and the viewer's zone, which sets the daily hour). */
  update: defineEndpoint({
    id: "accounts.update",
    method: "PATCH",
    path: "/api/accounts/{provider}",
    auth: "user",
    class: "W1",
    cache: "no-store",
    rateLimit: ACCOUNT_SETTINGS_LIMIT,
    params: ProviderParams,
    body: PatchAccountBody,
    response: LinkedAccountView,
    errors: ["maintenance"],
    maxBodyBytes: 1_024,
    summary: "Turns the daily import of one linked account on or off",
  }),
  /** ACC-6. Unlinks; `deleteGames=1` also queues IMPORT_PURGE for that provider's imported games. */
  unlink: defineEndpoint({
    id: "accounts.unlink",
    method: "DELETE",
    path: "/api/accounts/{provider}",
    auth: "user",
    class: "W2",
    cache: "no-store",
    rateLimit: ACCOUNT_LINK_LIMIT,
    params: ProviderParams,
    query: UnlinkQuery,
    response: UnlinkData,
    errors: ["maintenance"],
    summary: "Unlinks one provider, optionally deleting its imported games",
  }),
} as const;
