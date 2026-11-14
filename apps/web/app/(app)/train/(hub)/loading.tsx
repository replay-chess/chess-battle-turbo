// Route loading for /train (phase-05 plan §4.2 `loading`; DR/V3TrainHubLoading): the hub's grid with ghost blocks.
import { HubSkeleton } from "@/components/train/hub/HubSkeleton";

export default function TrainLoading() {
  return <HubSkeleton />;
}
