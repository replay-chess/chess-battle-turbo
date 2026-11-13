// /checkout/activating loading state (phase-04 plan 4.9): the two cards as one skeleton region (client-data-layer 8.2
// rule 4: one layer only), inside the layout's frame.
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

export default function CheckoutActivatingLoading() {
  return (
    <main className="flex min-h-0 flex-1 overflow-y-auto px-8 py-6 max-[600px]:px-4">
      <SkeletonRegion label="Loading your checkout" className="m-auto grid w-[min(1000px,100%)] grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-6 max-[900px]:grid-cols-1">
        <div className="flex flex-col gap-[18px] border border-cb-border bg-cb-surface p-10 max-[600px]:p-5">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-11 w-4/5" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-1 w-full" />
        </div>
        <div className="flex flex-col gap-3.5 border border-cb-border bg-cb-surface p-8 max-[600px]:p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </SkeletonRegion>
    </main>
  );
}
