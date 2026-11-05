// Pure rules behind the legacy user store (lib/stores/useUserStore.ts, plan §3.2 / §5.2, 1B·F4d).
//
//   storeUserFromMe(me, clerkUserId, prev)        MeData.user → StoreUser (the legacy pages' shape)
//   subscriptionFromEntitlement(e, current)       MeData.entitlement → the StoreSubscription mirror
//   migrateUserStore(persisted, version)          persisted v0/v1 snapshot → v2 (no subscription)
//
// No React, zustand, network or storage access, so node:test can import it.
import type { Entitlement, MeData } from "@repo/contracts/http/me";

export interface StoreUser {
  referenceId: string;
  code: string;
  email: string;
  name: string;
  profilePictureUrl: string | null;
  onboarded: boolean;
  /** Prisma Role: "USER" | "ADMIN". */
  role: string;
  clerkUserId: string;
  stats: {
    referenceId: string;
    totalGamesPlayed: number;
    gamesWon: number;
    gamesLost: number;
    gamesDrawn: number;
    currentWinStreak: number;
    longestWinStreak: number;
    averageGameDuration: number | null;
    lastPlayedAt: string | null;
  } | null;
  chessComProfile: {
    referenceId: string;
    chessComHandle: string;
    rapidRating: number | null;
    blitzRating: number | null;
  } | null;
}

export interface StoreSubscription {
  plan: string | null;
  /** True when the user may play. Mirrors the server; never trust it alone. */
  entitled?: boolean;
  /** False when the server paywall is switched off. */
  paywall?: boolean;
  status?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  subscriptionId?: string | null;
  customerId?: string;
  /** True when the next checkout includes the 7-day free trial. */
  trialEligible?: boolean;
  trial?: { active: boolean; used: boolean; endsAt: string | null; daysLeft: number };
  subscription?: {
    id: string;
    status: string;
    productId: string;
    nextBillingDate: string;
    /** "monthly" | "yearly" for current products, "legacy" for the original $8 plan. */
    planKey?: "monthly" | "yearly" | "legacy" | null;
    interval?: "month" | "year" | null;
    priceCents?: number | null;
  };
}

/** The persisted part of the store. Version 2 dropped `subscription` (plan §3.2). */
export type PersistedUserState = { user: StoreUser | null; lastSyncedAt: number | null };

export const USER_STORE_VERSION = 2;

/**
 * MeData.user → StoreUser. MeData carries no stats or chess.com profile; nothing reads them from the store any more,
 * so the previous values are kept only while they belong to the same user, otherwise null.
 */
export function storeUserFromMe(me: MeData, clerkUserId: string, prev: StoreUser | null): StoreUser {
  const same = prev !== null && prev.referenceId === me.user.ref;
  return {
    referenceId: me.user.ref,
    code: me.user.code,
    email: me.user.email,
    name: me.user.name,
    profilePictureUrl: me.user.avatarUrl,
    onboarded: me.user.onboarded,
    role: me.user.role === "admin" ? "ADMIN" : "USER",
    clerkUserId,
    stats: same ? prev.stats : null,
    chessComProfile: same ? prev.chessComProfile : null,
  };
}

/**
 * The legacy subscription mirror of a viewer's entitlement. Fields MeData does not carry (subscription id, customer
 * id, product id) are kept from `current`, which callers pass only when it belongs to the same user. With no current
 * value they stay empty: no client code reads them except Navbar's `subscriptionId || entitled`.
 */
export function subscriptionFromEntitlement(
  e: Entitlement,
  current: StoreSubscription | null,
): StoreSubscription {
  const nested = e.status
    ? {
        id: current?.subscription?.id ?? "",
        status: e.status,
        productId: current?.subscription?.productId ?? "",
        nextBillingDate: e.currentPeriodEnd ?? "",
        planKey: e.planKey,
        interval: e.interval,
        priceCents: e.priceCents,
      }
    : undefined;
  return {
    ...current,
    plan: e.entitled ? "player" : null,
    entitled: e.entitled,
    paywall: e.paywall,
    status: e.status,
    currentPeriodEnd: e.currentPeriodEnd,
    cancelAtPeriodEnd: e.cancelAtPeriodEnd,
    trialEligible: e.trial.eligible,
    trial: {
      active: e.trial.active,
      used: e.trial.used,
      endsAt: e.trial.endsAt,
      daysLeft: e.trial.daysLeft ?? 0,
    },
    subscription: nested,
  };
}

/** The legacy `SubscriptionResponse` (BillingRefreshData.legacy), or null when the value is not one. */
export function legacySubscriptionOf(value: unknown): StoreSubscription | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.entitled !== "boolean") return null;
  if (v.plan !== null && typeof v.plan !== "string") return null;
  return value as StoreSubscription;
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

/** A persisted user is reused only when it is complete and tied to a Clerk user id. */
function persistedUserOf(value: unknown): StoreUser | null {
  if (typeof value !== "object" || value === null) return null;
  const u = value as Record<string, unknown>;
  if (!isString(u.referenceId) || !u.referenceId) return null;
  if (!isString(u.code) || !isString(u.email) || !isString(u.name)) return null;
  // fetchUserByEmail (removed) stored clerkUserId "", so the row cannot be matched to the signed-in Clerk user.
  if (!isString(u.clerkUserId) || !u.clerkUserId) return null;
  return {
    referenceId: u.referenceId,
    code: u.code,
    email: u.email,
    name: u.name,
    profilePictureUrl: isString(u.profilePictureUrl) ? u.profilePictureUrl : null,
    onboarded: u.onboarded === true,
    role: u.role === "ADMIN" ? "ADMIN" : "USER",
    clerkUserId: u.clerkUserId,
    stats: (u.stats as StoreUser["stats"]) ?? null,
    chessComProfile: (u.chessComProfile as StoreUser["chessComProfile"]) ?? null,
  };
}

/**
 * zustand `persist` migrate (stored version → 2). Phase 0 snapshots (version 0, written as "v1" in the plan) kept
 * `subscription`, which could be the `{ plan: null, entitled: false }` a failed fetch wrote (AC #4); a member with
 * that snapshot was bounced to /pricing. Version 2 drops it, so entitlement always comes from a fresh server answer.
 */
export function migrateUserStore(persisted: unknown, version: number): PersistedUserState {
  const p = (typeof persisted === "object" && persisted !== null ? persisted : {}) as Record<string, unknown>;
  const lastSyncedAt = typeof p.lastSyncedAt === "number" ? p.lastSyncedAt : null;
  if (version > USER_STORE_VERSION) return { user: null, lastSyncedAt: null };
  return { user: persistedUserOf(p.user), lastSyncedAt };
}
