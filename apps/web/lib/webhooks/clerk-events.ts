/**
 * Clerk user lifecycle events (plan phase-01 §7.7, A7). The route verifies the Svix signature and
 * claims the event in `webhook_events` (payload stored as NULL); this module applies it.
 *
 * | Event          | Action |
 * |----------------|--------|
 * | `user.created` | provision the row: existing googleId → nothing; a row with the same verified primary email → relink; else create user + stats. Claims: defaults for a new row, a sync otherwise |
 * | `user.updated` | name and picture; email only when the new primary is verified and no other row uses it (else Sentry warning `email_conflict`) |
 * | `user.deleted` | `isActive = false` (soft; hard deletion is P10) |
 * | other          | `ignored` |
 *
 * Provisioning follows plan §8.5 (verified primary email only, 6-character code from [A-Z0-9] with up
 * to 5 retries, P2002 on googleId/email → re-read). 1B·F4a's `provisionUser()` is the request-path
 * twin; see the hand-back for merging the two.
 */
import { randomInt } from "node:crypto";
import type { WebhookOutcome } from "./record";

/** The fields of a Clerk `UserJSON` this module reads. */
export interface ClerkUserPayload {
  id: string;
  email_addresses?: Array<{
    id: string;
    email_address: string;
    verification?: { status?: string | null } | null;
  }> | null;
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  image_url?: string | null;
}

export interface ClerkEvent {
  type: string;
  data: unknown;
}

/** What the route needs from an outcome: claims to write in after(), and the telemetry id. */
export type ClerkOutcome = WebhookOutcome & {
  userRef?: string | null;
  /** "new": write the default claims; "sync": syncClerkClaims; absent: nothing. */
  claims?: "new" | "sync";
  /** The Clerk user id the claims go to. */
  clerkUserId?: string;
};

export interface ClerkUserRow {
  id: bigint;
  referenceId: string;
  googleId: string;
  email: string;
  name: string;
  profilePictureUrl: string | null;
  isActive: boolean;
}

export interface NewUserInput {
  googleId: string;
  email: string;
  name: string;
  profilePictureUrl: string | null;
}

export interface ClerkUserStore {
  findByGoogleId(googleId: string): Promise<ClerkUserRow | null>;
  findByEmail(email: string): Promise<ClerkUserRow | null>;
  /** Creates the user and its stats row in one transaction, with the given code. */
  create(input: NewUserInput, code: string): Promise<ClerkUserRow>;
  update(id: bigint, data: Partial<Pick<ClerkUserRow, "googleId" | "email" | "name" | "profilePictureUrl" | "isActive">>): Promise<void>;
  /** Soft delete by Clerk id; returns the row's id and ref, or null when no row matched. */
  deactivate(googleId: string): Promise<{ id: bigint; referenceId: string } | null>;
  /** Sentry warning without PII. */
  warn(message: string, context: Record<string, string>): void;
}

export const USER_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const USER_CODE_LENGTH = 6;
export const USER_CODE_ATTEMPTS = 5;

export function generateUserCode(rand: (max: number) => number = randomInt): string {
  let code = "";
  for (let i = 0; i < USER_CODE_LENGTH; i++) code += USER_CODE_ALPHABET[rand(USER_CODE_ALPHABET.length)];
  return code;
}

/** The primary email, trimmed and lower-cased, only when Clerk marks it verified. */
export function primaryVerifiedEmail(user: ClerkUserPayload): string | null {
  const primary = user.email_addresses?.find((e) => e.id === user.primary_email_address_id);
  if (!primary || primary.verification?.status !== "verified") return null;
  const email = primary.email_address.trim().toLowerCase();
  return email || null;
}

export function displayName(user: ClerkUserPayload): string {
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return full || user.username?.trim() || "Anonymous User";
}

function isUserPayload(data: unknown): data is ClerkUserPayload {
  return !!data && typeof data === "object" && typeof (data as { id?: unknown }).id === "string" && (data as { id: string }).id !== "";
}

/** Prisma unique violation on one of `fields`. */
export function isUniqueViolation(err: unknown, ...fields: string[]): boolean {
  if (!err || typeof err !== "object" || (err as { code?: unknown }).code !== "P2002") return false;
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  const text = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return fields.length === 0 || fields.some((f) => text.includes(f));
}

async function provision(user: ClerkUserPayload, store: ClerkUserStore): Promise<ClerkOutcome> {
  const existing = await store.findByGoogleId(user.id);
  if (existing) {
    return { status: "applied", changed: false, userId: existing.id, userRef: existing.referenceId, claims: "sync", clerkUserId: user.id };
  }

  const email = primaryVerifiedEmail(user);
  if (!email) {
    // §8.5 step 6: never create a row from an unverified address. The first request after
    // verification provisions the user (F4a).
    return { status: "ignored", changed: false, error: "unverified_email" };
  }

  const byEmail = await store.findByEmail(email);
  if (byEmail) {
    // AA F-23: relink only on a verified primary email.
    await store.update(byEmail.id, { googleId: user.id, isActive: true });
    store.warn("user.relinked", { user: String(byEmail.id) });
    return { status: "applied", changed: true, userId: byEmail.id, userRef: byEmail.referenceId, claims: "sync", clerkUserId: user.id };
  }

  const input: NewUserInput = { googleId: user.id, email, name: displayName(user), profilePictureUrl: user.image_url ?? null };
  for (let attempt = 0; attempt < USER_CODE_ATTEMPTS; attempt++) {
    try {
      const created = await store.create(input, generateUserCode());
      return { status: "applied", changed: true, userId: created.id, userRef: created.referenceId, claims: "new", clerkUserId: user.id };
    } catch (err) {
      if (isUniqueViolation(err, "code")) continue;
      if (isUniqueViolation(err, "googleId", "email")) {
        // The request path (or a concurrent delivery) created the row first.
        const row = (await store.findByGoogleId(user.id)) ?? (await store.findByEmail(email));
        if (row) {
          return { status: "applied", changed: false, userId: row.id, userRef: row.referenceId, claims: "sync", clerkUserId: user.id };
        }
      }
      throw err;
    }
  }
  throw new Error("user code space exhausted");
}

async function updateProfile(user: ClerkUserPayload, store: ClerkUserStore): Promise<ClerkOutcome> {
  const row = await store.findByGoogleId(user.id);
  if (!row) return { status: "unmatched", changed: false };

  const data: Partial<Pick<ClerkUserRow, "email" | "name" | "profilePictureUrl">> = {};
  const name = displayName(user);
  if (name !== row.name) data.name = name;
  const picture = user.image_url ?? null;
  if (picture !== row.profilePictureUrl) data.profilePictureUrl = picture;

  const email = primaryVerifiedEmail(user);
  if (email && email !== row.email.trim().toLowerCase()) {
    const other = await store.findByEmail(email);
    if (other && other.id !== row.id) {
      store.warn("email_conflict", { user: String(row.id) });
    } else {
      data.email = email;
    }
  }

  if (Object.keys(data).length === 0) {
    return { status: "applied", changed: false, userId: row.id, userRef: row.referenceId };
  }
  await store.update(row.id, data);
  return { status: "applied", changed: true, userId: row.id, userRef: row.referenceId };
}

/** Applies one verified Clerk event. Database errors propagate (the route marks the event `error`, 500). */
export async function handleClerkEvent(event: ClerkEvent, store?: ClerkUserStore): Promise<ClerkOutcome> {
  if (event.type !== "user.created" && event.type !== "user.updated" && event.type !== "user.deleted") {
    return { status: "ignored", changed: false };
  }
  if (!isUserPayload(event.data)) return { status: "ignored", changed: false, error: "payload_missing_id" };
  const s = store ?? (await prismaClerkUserStore());
  const user = event.data;

  switch (event.type) {
    case "user.created":
      return provision(user, s);
    case "user.updated":
      return updateProfile(user, s);
    case "user.deleted": {
      const row = await s.deactivate(user.id);
      return row ? { status: "applied", changed: true, userId: row.id, userRef: row.referenceId } : { status: "unmatched", changed: false };
    }
  }
}

/** The event's time: Clerk's top-level `timestamp` (epoch ms) in the raw body, else `svix-timestamp` (seconds). */
export function clerkEventTime(rawBody: string, svixTimestamp: string | null): Date | null {
  try {
    const ts = (JSON.parse(rawBody) as { timestamp?: unknown }).timestamp;
    if (typeof ts === "number" && Number.isFinite(ts) && ts > 0) return new Date(ts);
  } catch {
    // fall through to the header
  }
  const seconds = Number(svixTimestamp);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}

const ROW_SELECT = {
  id: true,
  referenceId: true,
  googleId: true,
  email: true,
  name: true,
  profilePictureUrl: true,
  isActive: true,
} as const;

async function prismaClerkUserStore(): Promise<ClerkUserStore> {
  const [{ prisma }, Sentry] = await Promise.all([import("@/lib/prisma"), import("@sentry/nextjs")]);
  return {
    findByGoogleId: (googleId) => prisma.user.findUnique({ where: { googleId }, select: ROW_SELECT }),
    findByEmail: (email) => prisma.user.findUnique({ where: { email }, select: ROW_SELECT }),
    create: (input, code) =>
      prisma.$transaction(async (tx) => {
        const row = await tx.user.create({
          data: { ...input, code, isActive: true, onboarded: false },
          select: ROW_SELECT,
        });
        await tx.userStats.create({ data: { userId: row.id } });
        return row;
      }),
    async update(id, data) {
      await prisma.user.update({ where: { id }, data, select: { id: true } });
    },
    async deactivate(googleId) {
      const row = await prisma.user.findUnique({ where: { googleId }, select: { id: true, referenceId: true, isActive: true } });
      if (!row) return null;
      if (row.isActive) await prisma.user.update({ where: { id: row.id }, data: { isActive: false }, select: { id: true } });
      return { id: row.id, referenceId: row.referenceId };
    },
    warn(message, context) {
      if (message === "user.relinked") {
        Sentry.addBreadcrumb({ category: "auth", message, data: context, level: "info" });
      } else {
        Sentry.captureMessage(message, { level: "warning", tags: context });
      }
    },
  };
}
