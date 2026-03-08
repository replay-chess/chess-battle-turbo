import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";

export interface StoreUser {
  referenceId: string;
  code: string;
  email: string;
  name: string;
  profilePictureUrl: string | null;
  onboarded: boolean;
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
  customerId?: string;
  subscription?: {
    id: string;
    status: string;
    productId: string;
    nextBillingDate: string;
  };
}

interface UserState {
  user: StoreUser | null;
  subscription: StoreSubscription | null;
  isSyncing: boolean;
  lastSyncedAt: number | null;

  setUser: (user: StoreUser | null) => void;
  setSubscription: (subscription: StoreSubscription | null) => void;
  clearStore: () => void;
  fetchSubscription: () => Promise<void>;
  fetchUserByEmail: (email: string) => Promise<void>;
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
            localStorage.removeItem(STORAGE_KEY);
          }
        },

        fetchSubscription: async () => {
          try {
            set({ isSyncing: true });
            const res = await fetch("/api/subscription");
            if (!res.ok) {
              set({ subscription: { plan: null }, isSyncing: false });
              return;
            }
            const data = await res.json();
            set({ subscription: data, isSyncing: false });
          } catch {
            set({ subscription: { plan: null }, isSyncing: false });
          }
        },

        fetchUserByEmail: async (email: string) => {
          if (get().isSyncing) return;
          try {
            set({ isSyncing: true });
            const res = await fetch(
              `/api/user/email/${encodeURIComponent(email)}`
            );
            if (!res.ok) {
              set({ isSyncing: false });
              return;
            }
            const data = await res.json();
            if (data.success && data.data?.user) {
              const u = data.data.user;
              set({
                user: {
                  referenceId: u.referenceId,
                  code: u.code,
                  email: u.email,
                  name: u.name,
                  profilePictureUrl: u.profilePictureUrl,
                  onboarded: u.onboarded ?? true,
                  role: u.role ?? "USER",
                  clerkUserId: u.clerkUserId ?? "",
                  stats: data.data.stats ?? null,
                  chessComProfile: u.chessComProfile ?? null,
                },
                lastSyncedAt: Date.now(),
                isSyncing: false,
              });
            } else {
              set({ isSyncing: false });
            }
          } catch {
            set({ isSyncing: false });
          }
        },
      }),
      {
        name: STORAGE_KEY,
        partialize: (state) => ({
          user: state.user,
          subscription: state.subscription,
          lastSyncedAt: state.lastSyncedAt,
        }),
      }
    ),
    { name: "UserStore" }
  )
);
