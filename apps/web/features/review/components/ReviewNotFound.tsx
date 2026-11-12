// A review that does not exist, or one the viewer did not play (plan §4.1, §11.1): the same answer, so a game's
// existence is never revealed. P1's EmptyState: "We Couldn't Find That Review" + Back to My Games.
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";

export function ReviewNotFound() {
  return (
    <div style={{ minHeight: "60dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} data-testid="review-not-found">
      <EmptyState
        title="We Couldn’t Find That Review"
        body="The link may be wrong, or this game isn’t one of yours."
        primary={
          <Link
            href="/games"
            className="inline-flex min-h-11 items-center justify-center bg-cb-accent px-4 text-sm font-medium text-cb-accent-fg hover:bg-cb-accent-hover"
          >
            Back to My Games
          </Link>
        }
      />
    </div>
  );
}
