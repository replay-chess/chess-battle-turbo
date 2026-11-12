// Route loading for /games (plan §4.9 `loading`; V3Skeletons `list`): the header, 9 ghost rows and the aside
// placeholder, laid out by the same classes as the screen, so the first page replaces it without a shift.
import { ArchiveSkeleton } from "@/features/games/components/ArchiveSkeleton";

export default function GamesLoading() {
  return <ArchiveSkeleton />;
}
