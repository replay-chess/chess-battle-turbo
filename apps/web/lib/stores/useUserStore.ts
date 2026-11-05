// The legacy user store (Phase 0 pages read it until their phase rebuilds them). Plan §3.2 / §5.2, 1B·F4d:
//
// - The user and the subscription mirror come from the viewer, `qk.me()` (seeded by the (app) layout after 1B·J,
//   otherwise one GET /api/me from UserSync). `applyMe` writes both.
// - `fetchSubscription` is the "after an action" read: POST /api/billing/refresh (a fresh Dodo read). It resolves
//   true when the server answered and false otherwise; a failure keeps the last known value (never a fake
//   `entitled: false`, AC #4).
// - Persisted as version 2 without `subscription`: entitlement is never taken from localStorage. Older snapshots
//   are migrated by `migrateUserStore` (lib/stores/user-store-rules.ts).
import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";
import { BillingRefreshData } from "@repo/contracts/http/billing";
import type { MeData } from "@repo/contracts/http/me";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import { meQuery, setMeEntitlement } from "@/lib/api/queries/me";
import { getQueryClient } from "@/lib/api/query-client";
import {
  USER_STORE_VERSION,
  legacySubscriptionOf,
  migrateUserStore,
  storeUserFromMe,
  subscriptionFromEntitlement,
  type PersistedUserState,
  type StoreSubscription,
  type StoreUser,
} from "./user-store-rules";

export type { StoreSubscription, StoreUser } from "./user-store-rules";

interface UserState {
  user: StoreUser | null;
  subscription: StoreSubscription | null;
  isSyncing: boolean;
  lastSyncedAt: number | null;

  setUser: (user: StoreUser | null) => void;
  setSubscription: (subscription: StoreSubscription | null) => void;
  clearStore: () => void;
  /** Writes the viewer (user + subscription mirror) into the store. */
  applyMe: (me: MeData, clerkUserId: string) => void;
  /**
   * The viewer from `qk.me()`: the cached value when there is one (no request), otherwise one GET /api/me.
   * `force` always asks the server. Resolves null on failure and leaves the store as it was.
   */
  loadViewer: (clerkUserId: string, options?: { force?: boolean }) => Promise<MeData | null>;
  /** POST /api/billing/refresh. True when the server answered; false keeps the last known value. */
  fetchSubscription: () => Promise<boolean>;
}

const STORAGE_KEY = "chess-user-store";

export const useUserStore = create<UserState>()(
  devtools(
    persist(
      (set, get) => ({
        user: null,
        subscription: null,
        isSyncing: false,
        lastSyncedAt: null,

        setUser: (user) => set({ user, lastSyncedAt: Date.now() }),

        setSubscription: (subscription) => set({ subscription }),

        clearStore: () => {
          set({
            user: null,
            subscription: null,
            lastSyncedAt: null,
          });
          if (typeof window !== "undefined") {
            try {
              localStorage.removeItem(STORAGE_KEY);
            } catch {
              // Storage blocked (private mode): the in-memory state is already cleared.
            }
          }
        },

        applyMe: (me, clerkUserId) =>
          set((state) => {
            // The mirror keeps ids the viewer does not carry, but only from the same user's value.
            const sameUser = state.user !== null && state.user.referenceId === me.user.ref;
            return {
              user: storeUserFromMe(me, clerkUserId, state.user),
              subscription: subscriptionFromEntitlement(me.entitlement, sameUser ? state.subscription : null),
              lastSyncedAt: Date.now(),
            };
          }),

        loadViewer: async (clerkUserId, options) => {
          const qc = getQueryClient();
          const cached = options?.force ? undefined : qc.getQueryData(meQuery.queryKey);
          if (cached) {
            get().applyMe(cached, clerkUserId);
            return cached;
          }
          set({ isSyncing: true });
          try {
            // fetchQuery dedupes with any in-flight `qk.me()` request, so concurrent callers share one GET.
            const me = await qc.fetchQuery(options?.force ? { ...meQuery, staleTime: 0 } : meQuery);
            get().applyMe(me, clerkUserId);
            return me;
          } catch {
            // 401 reaches the session guard through the query cache; everything else keeps the last known state.
            return null;
          } finally {
            set({ isSyncing: false });
          }
        },

        fetchSubscription: async () => {
          set({ isSyncing: true });
          try {
            const { data } = await api(endpoints.billingRefresh, {
              method: "POST",
              // devSchema written inline (lib/api/schema.ts), so zod stays out of production chunks.
              schema: process.env.NODE_ENV === "production" ? undefined : BillingRefreshData,
            });
            // Updating qk.me() first lets UserSync mirror it; the full legacy body below then wins.
            setMeEntitlement(getQueryClient(), data.entitlement);
            const legacy = legacySubscriptionOf(data.legacy);
            set((state) => ({
              subscription: legacy ?? subscriptionFromEntitlement(data.entitlement, state.subscription),
            }));
            return true;
          } catch (err) {
            if (isApiError(err) && err.code === "not_configured") {
              // No Dodo key on this deployment: the stored state through the viewer is the best answer.
              try {
                const me = await getQueryClient().fetchQuery({ ...meQuery, staleTime: 0 });
                set((state) => ({ subscription: subscriptionFromEntitlement(me.entitlement, state.subscription) }));
                return true;
              } catch {
                return false;
              }
            }
            // 429, 5xx, network: keep the last known value (plan §5.5).
            return false;
          } finally {
            set({ isSyncing: false });
          }
        },
      }),
      {
        name: STORAGE_KEY,
        version: USER_STORE_VERSION,
        partialize: (state): PersistedUserState => ({
          user: state.user,
          lastSyncedAt: state.lastSyncedAt,
        }),
        migrate: (persisted, version) => migrateUserStore(persisted, version),
      }
    ),
    { name: "UserStore" }
  )
);
