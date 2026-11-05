import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";
import { logger } from "@/lib/logger";

export interface StoreLegend {
  id: string;
  name: string;
  era: string;
  profilePhotoUrl: string | null;
  description: string;
  playingStyle: string | null;
}

export interface StoreOpening {
  id: string;
  eco: string;
  name: string;
}

interface DataState {
  legends: StoreLegend[];
  openings: StoreOpening[];
  legendsFetchedAt: number | null;
  openingsFetchedAt: number | null;
  legendsLoading: boolean;
  openingsLoading: boolean;

  fetchLegends: (force?: boolean) => Promise<void>;
  fetchOpenings: (force?: boolean) => Promise<void>;
}

const STORAGE_KEY = "chess-data-store";
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function isStale(fetchedAt: number | null): boolean {
  if (!fetchedAt) return true;
  return Date.now() - fetchedAt > TTL_MS;
}

export const useDataStore = create<DataState>()(
  devtools(
    persist(
      (set, get) => ({
        legends: [],
        openings: [],
        legendsFetchedAt: null,
        openingsFetchedAt: null,
        legendsLoading: false,
        openingsLoading: false,

        fetchLegends: async (force = false) => {
          const state = get();
          if (!force && !isStale(state.legendsFetchedAt) && state.legends.length > 0) {
            return;
          }
          if (state.legendsLoading) return;

          set({ legendsLoading: true });
          try {
            const res = await fetch("/api/legends?isVisible=true&isActive=true");
            // Legacy `{ success, data: { legends } }` today; the `{ data }` envelope once the route moves to route().
            const json = (await res.json().catch(() => null)) as { data?: { legends?: StoreLegend[] } } | null;
            const legends = res.ok ? json?.data?.legends : undefined;
            if (legends) {
              set({
                legends,
                legendsFetchedAt: Date.now(),
                legendsLoading: false,
              });
            } else {
              set({ legendsLoading: false });
            }
          } catch (err) {
            logger.error("Failed to fetch legends", err);
            set({ legendsLoading: false });
          }
        },

        fetchOpenings: async (force = false) => {
          const state = get();
          if (!force && !isStale(state.openingsFetchedAt) && state.openings.length > 0) {
            return;
          }
          if (state.openingsLoading) return;

          set({ openingsLoading: true });
          try {
            // `{ data: { openings } }` envelope (public, CDN-cached; plan §7.4 A4).
            const res = await fetch("/api/openings");
            const json = (await res.json().catch(() => null)) as { data?: { openings?: StoreOpening[] } } | null;
            const openings = res.ok ? json?.data?.openings : undefined;
            if (openings) {
              set({
                openings,
                openingsFetchedAt: Date.now(),
                openingsLoading: false,
              });
            } else {
              set({ openingsLoading: false });
            }
          } catch (err) {
            logger.error("Failed to fetch openings", err);
            set({ openingsLoading: false });
          }
        },
      }),
      {
        name: STORAGE_KEY,
        partialize: (state) => ({
          legends: state.legends,
          openings: state.openings,
          legendsFetchedAt: state.legendsFetchedAt,
          openingsFetchedAt: state.openingsFetchedAt,
        }),
      }
    ),
    { name: "DataStore" }
  )
);
