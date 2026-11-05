// Route skeletons (V3Skeletons `game` | `review` | `profile` | `list`; plan §4.6, 1A·P7).
// Compositions of the 1A·P1 Skeleton* parts and the 1A·P5 BoardStage. Each one is a SkeletonRegion
// (aria-busy="true" plus one sr-only "Loading…"); the blocks themselves are aria-hidden. Real
// `loading.tsx` files adopt them in the phase that rebuilds each route: game (P2), review (P3),
// profile (P10), list (P3 games archive, P12 tournaments). Server component.
import { Chess } from "chess.js";
import ChessBoard from "@/app/components/ChessBoard";
import { BoardStage } from "@/components/layout/BoardStage";
import { Skeleton, SkeletonBoard, SkeletonPlayerBar, SkeletonRegion, SkeletonRow } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type RouteSkeletonVariant = "game" | "review" | "profile" | "list";
export const ROUTE_SKELETON_VARIANTS: readonly RouteSkeletonVariant[] = ["game", "review", "profile", "list"];

/** Plan §4.6: the board the game skeleton shows before the game itself has loaded. */
export const SKELETON_GAME_FEN = "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 9";

/** Flow-mode page frame shared by review, profile and list (V3Skeletons: 24px 32px, max 1180px). */
const PAGE = "mx-auto flex w-full max-w-[1180px] flex-col px-4 py-6 sm:px-8";
const CARD = "border border-cb-border bg-cb-surface";

function times<T>(n: number, fn: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => fn(i));
}

/**
 * `game` (lock mode): the real board from a FEN, skeleton player bars, a 300–360px aside of move rows and,
 * on phones, a control-bar placeholder. Put it in an AppShellView with `hideTabBar`, like the game itself.
 */
export function GameSkeleton({ fen = SKELETON_GAME_FEN, label = "Loading game…" }: { fen?: string; label?: string }) {
  const board = new Chess(fen).board();
  return (
    <SkeletonRegion label={label} className="grid min-h-0 [grid-template:minmax(0,1fr)/minmax(0,1fr)]">
      <BoardStage
        label="Board"
        top={<SkeletonPlayerBar className="h-full min-h-0 w-full" />}
        bottom={<SkeletonPlayerBar className="h-full min-h-0 w-full" />}
        board={<ChessBoard squareSize="fill" board={board} isInteractive={false} />}
        aside={
          <div aria-hidden="true" className={cn(CARD, "flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-3.5")}>
            <Skeleton className="h-3 w-3/5 shrink-0" />
            {times(9, (i) => (
              <span key={i} className="grid h-[30px] shrink-0 grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2.5">
                <Skeleton className="h-2.5 w-5" />
                <Skeleton className="h-2.5 w-3/5" />
                <Skeleton className="h-2.5 w-[55%]" />
              </span>
            ))}
          </div>
        }
        footer={
          <div aria-hidden="true" className="flex flex-1 items-center justify-around border-t border-cb-border bg-cb-surface">
            {times(4, (i) => (
              <Skeleton key={i} className="size-6" />
            ))}
          </div>
        }
      />
    </SkeletonRegion>
  );
}

/** `review` (flow): title and tag, the board, the summary and graded-moves cards, and the analysis progress line. */
export function ReviewSkeleton({
  progress = "Analysing · 14 of 38 moves",
  label = "Loading review…",
}: {
  progress?: string;
  label?: string;
}) {
  return (
    <SkeletonRegion label={label} className={cn(PAGE, "gap-4")}>
      <span aria-hidden="true" className="flex items-center gap-3">
        <Skeleton className="h-[34px] w-[260px] max-w-[60%]" />
        <Skeleton className="h-[26px] w-[90px] shrink-0" />
      </span>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <SkeletonBoard className="mx-auto max-w-[max(220px,calc(100dvh-180px))]" />
        <div className="flex min-w-0 flex-col gap-3">
          <div aria-hidden="true" className={cn(CARD, "flex flex-col gap-2.5 p-3.5")}>
            <Skeleton className="h-2.5 w-2/5" />
            <Skeleton className="h-24 w-full" />
            <span className="grid grid-cols-3 gap-2.5">
              {times(3, (i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </span>
          </div>
          <div aria-hidden="true" className={cn(CARD, "flex flex-col gap-2.5 p-3.5")}>
            <Skeleton className="h-2.5 w-[30%]" />
            {times(4, (i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
          <p data-testid="route-skeleton-progress" className="flex items-center gap-2 text-overline text-cb-text-soft">
            <Spinner size="sm" />
            {progress}
          </p>
        </div>
      </div>
    </SkeletonRegion>
  );
}

/** `profile` (flow): 72px avatar header, tab row, four stat cards and six game rows. */
export function ProfileSkeleton({ label = "Loading profile…" }: { label?: string }) {
  return (
    <SkeletonRegion label={label} className={cn(PAGE, "gap-[18px]")}>
      <span aria-hidden="true" className="flex items-center gap-4">
        <Skeleton shape="circle" className="size-[72px] shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-7 w-[240px] max-w-full" />
          <Skeleton className="h-3 w-[160px] max-w-[80%]" />
        </span>
        <Skeleton className="hidden h-11 w-[120px] shrink-0 sm:block" />
      </span>
      <span aria-hidden="true" className="flex gap-6 overflow-hidden border-b border-cb-border pb-2.5">
        {times(4, (i) => (
          <Skeleton key={i} className="h-3 w-20 shrink-0" />
        ))}
      </span>
      <span aria-hidden="true" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {times(4, (i) => (
          <span key={i} className={cn(CARD, "flex flex-col gap-2 p-3.5")}>
            <Skeleton className="h-2.5 w-1/2" />
            <Skeleton className="h-6 w-2/5" />
          </span>
        ))}
      </span>
      <div aria-hidden="true" className={cn(CARD, "flex flex-col gap-2.5 p-3.5")}>
        <Skeleton className="h-2.5 w-1/5" />
        {times(6, (i) => (
          <span key={i} className="flex min-h-12 items-center gap-3 border-b border-cb-border last:border-b-0">
            <Skeleton className="h-[22px] w-12 shrink-0" />
            <Skeleton className="h-3 w-[35%]" />
            <span className="flex-1" />
            <Skeleton className="h-3 w-10 shrink-0" />
          </span>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** `list` (flow): page header and nine ghost rows, never a spinner alone. */
export function ListSkeleton({ label = "Loading list…" }: { label?: string }) {
  return (
    <SkeletonRegion label={label} className={cn(PAGE, "gap-3.5")}>
      <span aria-hidden="true" className="flex items-center justify-between gap-4">
        <Skeleton className="h-[34px] w-[220px] max-w-[60%]" />
        <Skeleton className="h-11 w-[110px] shrink-0" />
      </span>
      <div aria-hidden="true" className={cn(CARD, "flex flex-col")}>
        {times(9, (i) => (
          <SkeletonRow key={i} className="border-b border-cb-border last:border-b-0" />
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** One of the four compositions by name (the /dev/ui/skeletons demo and loading.tsx files). */
export function RouteSkeleton({ variant }: { variant: RouteSkeletonVariant }) {
  switch (variant) {
    case "game":
      return <GameSkeleton />;
    case "review":
      return <ReviewSkeleton />;
    case "profile":
      return <ProfileSkeleton />;
    case "list":
      return <ListSkeleton />;
  }
}
