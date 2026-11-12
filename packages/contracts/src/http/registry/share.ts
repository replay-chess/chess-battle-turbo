import { defineEndpoint } from "../endpoint";
import { ReviewRefParams } from "../review";
import { ShareCodeParams, ShareCreateBody, ShareDTO, ShareUpdateBody } from "../share";

/** `share-create` (A10): 5 / 60 s per user. The durable 20-per-day cap is counted from `shares` (plan §7.2, AP-11). */
export const SHARE_CREATE_LIMIT = { bucket: "share-create", limit: 5, windowSec: 60, by: "user" } as const;
/** `share-edit` (A11 PATCH and DELETE): 10 / 60 s per user. */
export const SHARE_EDIT_LIMIT = { bucket: "share-edit", limit: 10, windowSec: 60, by: "user" } as const;

/**
 * Phase-03 plan §7.2 A10–A11 (§5.4, §11.3). Handlers: WEB/app/api/review/[ref]/share/route.ts and
 * WEB/app/api/share/[code]/route.ts (WP-D).
 *
 * A10 is member + player and flagged `review-share` (404 while the flag is off); it never runs on a GET, so a
 * prefetch of the share page cannot create a link (§11.2 rule 3). A11 is the owner only (`shares.ownerId`, else 404)
 * and is not flagged, so an owner can always turn a link off. The public page `/r/<code>` and its image are not API
 * routes (A12, WP-G).
 */
export const shareEndpoints = {
  /** A10. 201 a new link, 200 an identical live link reused; `Idempotency-Key` optional (sessionStorage key). */
  create: defineEndpoint({
    id: "share.create",
    method: "POST",
    path: "/api/review/{ref}/share",
    auth: "member",
    class: "W2",
    cache: "no-store",
    rateLimit: SHARE_CREATE_LIMIT,
    params: ReviewRefParams,
    body: ShareCreateBody,
    response: ShareDTO,
    status: 201,
    errors: ["conflict", "idempotency_key_reused", "in_flight"],
    maxBodyBytes: 1_024,
    summary: "Creates (or reuses) a public link to the review of one of the viewer's games",
  }),
  /**
   * A11 PATCH. The username toggle: the snapshot's names are recomputed and the image version bumps. `auth: "user"`,
   * not member (FIX-1): an owner whose membership lapsed must still be able to anonymise or stop a public page of
   * their game (§11.3 privacy); the handler's owner check (404) is the gate.
   */
  update: defineEndpoint({
    id: "share.update",
    method: "PATCH",
    path: "/api/share/{code}",
    auth: "user",
    class: "W1",
    cache: "no-store",
    rateLimit: SHARE_EDIT_LIMIT,
    params: ShareCodeParams,
    body: ShareUpdateBody,
    response: ShareDTO,
    errors: ["gone"],
    maxBodyBytes: 1_024,
    summary: "Shows or hides the sharer's username on a public review link",
  }),
  /** A11 DELETE. Stop Sharing: `revokedAt` once; a repeat is 204 too. Owner only, any signed-in owner (see PATCH). */
  revoke: defineEndpoint({
    id: "share.revoke",
    method: "DELETE",
    path: "/api/share/{code}",
    auth: "user",
    class: "W1",
    cache: "no-store",
    rateLimit: SHARE_EDIT_LIMIT,
    params: ShareCodeParams,
    status: 204,
    summary: "Turns a public review link off",
  }),
} as const;
