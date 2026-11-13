// /review/<ref>/** not found, from the [ref] layout's check (a missing game or another member's game, HTTP 404): the
// same UI as review/[ref]/not-found.tsx (plan §11.1), which still serves the page's own notFound().
import { ReviewNotFound } from "@/features/review/components/ReviewNotFound";

export default function ReviewSegmentNotFound() {
  return <ReviewNotFound />;
}
