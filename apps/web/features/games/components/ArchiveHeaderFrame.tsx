// The /games header (DR/V3GamesArchive.dc.html `header`): the overline "Review", the serif h1 "My games", the search
// field and the Filter button. Server-compatible: loading.tsx renders it with placeholders of the same size, so the
// header does not move when the screen hydrates.
import { Skeleton } from "@/components/ui/skeleton";

export function ArchiveHeaderFrame({ search, filter }: { search?: React.ReactNode; filter?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-3.5 tabbar:gap-2.5" data-testid="games-header">
      <div className="flex min-w-0 flex-auto flex-col gap-1 tabbar:basis-full">
        <p className="text-overline">Review</p>
        <h1 className="m-0 font-serif text-[2.75rem]/[1.02] font-normal tracking-[-0.01em] text-cb-text vh700:text-[2.25rem]/[1.02] tabbar:text-[2rem]/[1.05]">
          My games
        </h1>
      </div>
      <div className="w-60 tabbar:min-w-0 tabbar:flex-1">{search ?? <Skeleton className="h-11 w-full" />}</div>
      <div className="shrink-0">{filter ?? <Skeleton className="h-11 w-[104px]" />}</div>
    </header>
  );
}
