"use client";

// /settings/connected loading state: the real frame (header, intro, panel) with two card placeholders of the
// linked card's height, announced once as "Loading your linked accounts…".
//
// The frame gets the same profile link as the loaded page (FIX-2, UI review round 2): the (app) layout seeds the
// viewer query (qk.me()) before this fallback renders, so the profile ref is read from the cache (never fetched here).
// Without it no ShellBackOverride was registered while loading: the tab-bar top bar showed the logo and the title
// (which overlapped at iPhone 125 %), then switched to "‹ Profile" when the data landed.
import { useQueryClient } from "@tanstack/react-query";
import type { MeData } from "@repo/contracts/http/me";
import { Skeleton } from "@/components/ui/skeleton";
import { qk } from "@/lib/api/keys";
import { ConnectedFrame } from "./ConnectedFrame";

function CardPlaceholder() {
  return (
    <div className="flex flex-col gap-3 border border-cb-border bg-cb-surface p-4 tabbar:p-3.5" aria-hidden="true">
      <div className="flex items-center gap-3">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-4 flex-1" />
        <Skeleton className="h-6 w-16" />
      </div>
      <div className="flex items-center gap-3.5">
        <Skeleton shape="circle" className="size-10" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-2.5 w-2/3" />
        </div>
      </div>
      <Skeleton className="h-14 w-full" />
      <div className="flex gap-2">
        <Skeleton className="h-11 w-28" />
        <Skeleton className="h-11 w-24" />
      </div>
    </div>
  );
}

/** The loaded page's profile link (ConnectedScreen: `/profile/<ref>` from qk.me()), from the cached viewer only. */
export function skeletonProfileHref(me: Pick<MeData, "user"> | undefined): string | null {
  return me?.user.ref ? `/profile/${me.user.ref}` : null;
}

export function ConnectedSkeleton({ chrome, profileHref }: { chrome?: "shell" | "marketing"; profileHref?: string | null }) {
  const qc = useQueryClient();
  const href = profileHref !== undefined ? profileHref : skeletonProfileHref(qc.getQueryData<MeData>(qk.me()));
  return (
    <ConnectedFrame saved={false} profileHref={href} boardState="loading" chrome={chrome}>
      <span className="sr-only" role="status">
        Loading your linked accounts…
      </span>
      <CardPlaceholder />
      <CardPlaceholder />
    </ConnectedFrame>
  );
}
