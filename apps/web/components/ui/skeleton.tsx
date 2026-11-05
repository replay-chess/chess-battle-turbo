// Skeletons (SPEC 3.5, 6.2; 02 §5.15, 03 §11). Every skeleton is aria-hidden; the
// region around them carries aria-busy and one sr-only "Loading…". Never a spinner alone.
import { cn } from "@/lib/utils";

export type SkeletonProps = React.ComponentProps<"span"> & { shape?: "rect" | "circle" };

/**
 * One shimmer block (`.sk`). Size it with classes (`h-3 w-1/3`, `size-11`).
 * Under reduced motion the shimmer is static (the sweep is hidden).
 */
export function Skeleton({ shape = "rect", className, ...props }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      data-shape={shape}
      className={cn(
        "relative block overflow-hidden bg-cb-fill",
        "after:absolute after:inset-0 after:bg-linear-to-r after:from-transparent after:via-cb-skeleton-shine after:to-transparent after:animate-rc-shimmer motion-reduce:after:hidden",
        shape === "circle" && "rounded-full",
        className,
      )}
      {...props}
    />
  );
}

/** Text lines, 10px tall; the last one is shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <Skeleton key={i} className={cn("h-2.5", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")} />
      ))}
    </span>
  );
}

/** A list row (V3Skeletons `list`): 44px thumb, two lines, a 56×22 tag; 56px tall. */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex min-h-14 items-center gap-3 px-4", className)}>
      <Skeleton className="size-11 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-3 w-[34%]" />
        <Skeleton className="h-2.5 w-[22%]" />
      </span>
      <Skeleton className="h-[22px] w-14 shrink-0" />
    </span>
  );
}

/** A square board placeholder that fills its width. */
export function SkeletonBoard({ className }: { className?: string }) {
  return <Skeleton className={cn("aspect-square w-full", className)} />;
}

/** A player bar (V3Skeletons `game`): 32px avatar, two lines, an 84×34 clock; 48px tall. */
export function SkeletonPlayerBar({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex min-h-12 items-center gap-3", className)}>
      <Skeleton shape="circle" className="size-8 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-2.5 w-[30%]" />
        <Skeleton className="h-2 w-[18%]" />
      </span>
      <Skeleton className="h-[34px] w-[84px] shrink-0" />
    </span>
  );
}

/** aria-busy plus one sr-only "Loading…". */
export function SkeletonRegion({
  label = "Loading…",
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
