"use client";

// QueryState (plan §5.7, CDL §8.2): one mapping from query status to UI for every client-read region.
//
//   <QueryState query={useQuery(openingsIndexQuery)} object="openings"
//     empty={<EmptyState title="No Openings Yet" />} isEmpty={(d) => d.openings.length === 0}>
//     {(d) => <OpeningList openings={d.openings} />}
//   </QueryState>
//
// | status                         | renders                                                          |
// | pending, no data               | `fallback` (default: SkeletonRegion with 3 SkeletonRows)          |
// | pending, paused (offline)      | ErrorState "offline"                                              |
// | error, no data, rate_limited   | ErrorState rate_limited: countdown + disabled retry, auto-retries once |
// | error, no data, other          | ErrorState inline (or throws to error.tsx with errorVariant="page") |
// | success, isEmpty(data)         | `empty`                                                           |
// | success                        | children(data); aria-busy while a background refetch runs         |
// A background error with data keeps the data (silent; reactToApiError decides on toasts).
import { SkeletonRegion, SkeletonRow } from "@/components/ui/skeleton";
import { ErrorState } from "./ErrorState";

/** The parts of UseQueryResult / UseInfiniteQueryResult QueryState reads. */
export type QueryLike<T> = {
  data: T | undefined;
  error: unknown;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  isPlaceholderData?: boolean;
  fetchStatus: "fetching" | "paused" | "idle";
  refetch: () => unknown;
};

export type QueryStateProps<T> = {
  query: QueryLike<T>;
  children: (data: T) => React.ReactNode;
  /** The region's designed skeleton. Never a spinner alone. */
  fallback?: React.ReactNode;
  /** Rendered when `isEmpty(data)` is true. */
  empty?: React.ReactNode;
  isEmpty?: (data: T) => boolean;
  /** What the region loads, lower case, for the error copy ("openings"). */
  object?: string;
  /** "page": throw the error to the nearest error.tsx instead of rendering inline. */
  errorVariant?: "inline" | "page";
  className?: string;
  "data-testid"?: string;
};

export function DefaultQueryFallback({ label }: { label?: string }) {
  return (
    <SkeletonRegion label={label}>
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </SkeletonRegion>
  );
}

export function QueryState<T>({
  query,
  children,
  fallback,
  empty,
  isEmpty,
  object,
  errorVariant = "inline",
  className,
  "data-testid": testId,
}: QueryStateProps<T>) {
  const retry = () => query.refetch();

  if (query.data === undefined) {
    if (query.isPending && query.fetchStatus === "paused") {
      return (
        <ErrorState variant="offline" error={query.error} object={object} className={className} data-testid={testId ? `${testId}-error` : undefined} />
      );
    }
    if (query.isError) {
      if (errorVariant === "page") throw query.error;
      return (
        <ErrorState
          error={query.error}
          onRetry={retry}
          retrying={query.isFetching}
          object={object}
          autoRetry
          className={className}
          data-testid={testId ? `${testId}-error` : undefined}
        />
      );
    }
    return <div data-testid={testId ? `${testId}-loading` : undefined} className={className}>{fallback ?? <DefaultQueryFallback />}</div>;
  }

  const data = query.data;
  if (empty !== undefined && isEmpty?.(data)) {
    return <div data-testid={testId ? `${testId}-empty` : undefined} className={className}>{empty}</div>;
  }
  return (
    <div
      data-testid={testId}
      aria-busy={query.isFetching ? true : undefined}
      data-stale={query.isPlaceholderData ? "" : undefined}
      className={className}
    >
      {children(data)}
    </div>
  );
}
