"use client";
// Share mutations (phase-03 plan §5.4, §7.2 A10–A11). Keys only from `qk.review.share(ref)` (seeded by the share page
// from `getActiveShare`) and `qk.review.detail(ref)` (whose `share` block the review menu reads). Every write is
// `no-store`; 402 goes to /pricing and 429 to the inline countdown through the QueryProvider / the caller.
//
// - Create (A10) runs once from the share page's effect, never on render or prefetch. Its `Idempotency-Key` is kept in
//   sessionStorage per game (`rc:share:<ref>`), so a reload or a double mount replays the same answer instead of making
//   a second link. Storage may be unavailable (private mode): a fresh key per call is then still correct, because the
//   server reuses an identical live link anyway.
// - The username toggle (A11 PATCH) is optimistic and rolls back on error; the answer carries the bumped image URL.
// - Stop Sharing (A11 DELETE) is optimistic (`null` = no live link) and rolls back on error.
import type { ReviewDTO } from "@repo/contracts/http/review";
import type { ShareCreateInput, ShareDTO } from "@repo/contracts/http/share";
import { ShareDTO as ShareSchema } from "@repo/contracts/http/share";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../client";
import { endpoints } from "../endpoints";
import { qk } from "../keys";

export const SHARE_KEY_PREFIX = "rc:share:";

type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function sessionStore(): KeyStore | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function newKey(): string {
  return globalThis.crypto.randomUUID();
}

/** The create request's Idempotency-Key for a game: stored per tab session, a fresh UUID v4 when storage fails. */
export function shareIdempotencyKey(ref: string, store: KeyStore | null = sessionStore()): string {
  const name = `${SHARE_KEY_PREFIX}${ref}`;
  try {
    const existing = store?.getItem(name);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const key = newKey();
    store?.setItem(name, key);
    return key;
  } catch {
    return newKey();
  }
}

/** Forgets the stored key (after Stop Sharing, so Create a New Link makes a new link instead of a replay). */
export function forgetShareIdempotencyKey(ref: string, store: KeyStore | null = sessionStore()): void {
  try {
    store?.removeItem(`${SHARE_KEY_PREFIX}${ref}`);
  } catch {
    // storage unavailable: nothing was stored either
  }
}

const sharePath = (code: string) => endpoints.share.replace("{code}", encodeURIComponent(code));
const shareCreatePath = (ref: string) => endpoints.shareCreate.replace("{ref}", encodeURIComponent(ref));

/** A10: 201 a new link, 200 the identical live one. */
export async function createShareRequest(ref: string, body: ShareCreateInput, idempotencyKey: string): Promise<ShareDTO> {
  const { data } = await api(shareCreatePath(ref), {
    method: "POST",
    body,
    idempotencyKey,
    schema: process.env.NODE_ENV === "production" ? undefined : ShareSchema,
  });
  return data as ShareDTO;
}

/** A11 PATCH: the username toggle; the answer has the bumped `imageUrl`. */
export async function updateShareRequest(code: string, showUsername: boolean): Promise<ShareDTO> {
  const { data } = await api(sharePath(code), {
    method: "PATCH",
    body: { showUsername },
    schema: process.env.NODE_ENV === "production" ? undefined : ShareSchema,
  });
  return data as ShareDTO;
}

/** A11 DELETE: Stop Sharing (204; a repeat is 204 too). */
export async function revokeShareRequest(code: string): Promise<void> {
  await api(sharePath(code), { method: "DELETE" });
}

/** Writes the live link (or none) into both caches that show it. */
export function writeShareCaches(qc: QueryClient, ref: string, share: ShareDTO | null): void {
  qc.setQueryData<ShareDTO | null>(qk.review.share(ref), share);
  qc.setQueryData<ReviewDTO>(qk.review.detail(ref), (d) =>
    d
      ? {
          ...d,
          share: share ? { code: share.code, url: share.url, expiresAt: share.expiresAt, showUsername: share.showUsername } : null,
        }
      : d,
  );
}

/** A10 from the share page's mount effect (or Create a New Link / Try Again). */
export function useCreateShare(ref: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ShareCreateInput = {}) => createShareRequest(ref, body, shareIdempotencyKey(ref)),
    onSuccess: (share) => writeShareCaches(qc, ref, share),
  });
}

/** A11 PATCH with an optimistic toggle (the preview re-renders at once) and a rollback on error. */
export function useToggleShareUsername(ref: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { code: string; showUsername: boolean }) => updateShareRequest(input.code, input.showUsername),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: qk.review.share(ref), exact: true });
      const previous = qc.getQueryData<ShareDTO | null>(qk.review.share(ref)) ?? null;
      if (previous) writeShareCaches(qc, ref, { ...previous, showUsername: input.showUsername });
      return { previous };
    },
    onError: (_err, _input, context) => writeShareCaches(qc, ref, context?.previous ?? null),
    onSuccess: (share) => writeShareCaches(qc, ref, share),
  });
}

/** A11 DELETE with an optimistic `revoked` state (no live link) and a rollback on error. */
export function useRevokeShare(ref: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => revokeShareRequest(code),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: qk.review.share(ref), exact: true });
      const previous = qc.getQueryData<ShareDTO | null>(qk.review.share(ref)) ?? null;
      writeShareCaches(qc, ref, null);
      return { previous };
    },
    onError: (_err, _code, context) => writeShareCaches(qc, ref, context?.previous ?? null),
    onSuccess: () => forgetShareIdempotencyKey(ref),
  });
}
