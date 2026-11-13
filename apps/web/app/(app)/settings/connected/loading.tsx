// Route loading for /settings/connected: the same frame with two card-sized placeholders, so the cards replace it
// without a shift.
import { ConnectedSkeleton } from "@/components/accounts/ConnectedSkeleton";

export default function ConnectedLoading() {
  return <ConnectedSkeleton />;
}
