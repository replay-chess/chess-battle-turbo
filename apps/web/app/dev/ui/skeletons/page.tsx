import type { Metadata } from "next";
import { RouteSkeleton, ROUTE_SKELETON_VARIANTS, type RouteSkeletonVariant } from "@/components/layout/RouteSkeletons";
import { AppShellView } from "@/components/shell/AppShellView";
import type { DestinationKey } from "@/lib/shell/types";
import { DEMO_USERS } from "../shell/demo-users";

export const metadata: Metadata = { title: "Skeletons Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The nav item V3Skeletons marks current for each variant. `game` keeps none, like `/dev/ui/stage?layout=game`,
 * so no SubNav row takes height from the board on short screens.
 */
const CURRENT: Record<RouteSkeletonVariant, DestinationKey | null> = {
  game: null,
  review: "review",
  profile: "profile",
  list: "review",
};

/**
 * `/dev/ui/skeletons?variant=game|review|profile|list` (plan §4.6, 1A·P7): the four V3Skeletons route
 * compositions inside the real shell with a demo member. `game` is lock mode and hides the phone tab bar
 * (the control bar replaces it, as on the game itself); the others are flow pages. The route hairline
 * runs here continuously so the loading state reads as it will on a real navigation.
 */
export default async function SkeletonsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const raw = one(params.variant);
  const variant: RouteSkeletonVariant = ROUTE_SKELETON_VARIANTS.includes(raw as RouteSkeletonVariant)
    ? (raw as RouteSkeletonVariant)
    : "game";

  return (
    <AppShellView user={DEMO_USERS.member} demo currentKey={CURRENT[variant]} hideTabBar={variant === "game"}>
      <div
        aria-hidden="true"
        data-testid="skeleton-hairline"
        className="pointer-events-none fixed top-[var(--safe-top)] right-0 left-[var(--rc-nav-w,0px)] z-50 h-0.5 animate-rc-hair bg-cb-accent tabbar:top-[calc(var(--safe-top)+var(--rc-top-bar))] motion-reduce:w-[70%] motion-reduce:animate-none"
      />
      <RouteSkeleton variant={variant} />
    </AppShellView>
  );
}
