// The version rule behind the Train nav dot (phase-06 plan §8.16, D-P6-12): a READY write bumps
// `training_profiles."weaknessVersion"` when it is the first READY profile, the top pattern changed, or a pattern
// entered the top 3. Reordering inside the top 3, weekly rolls and ordinary updates do not bump, so the dot means
// "something new to look at", not "recomputed". The dot shows while weaknessVersion > lastWeaknessSeenVersion.
import type { SnapshotStatus } from "./types";

export function weaknessBumped(i: {
  status: SnapshotStatus;
  hadReady: boolean;
  prevTop: readonly string[] | null;
  topKeys: readonly string[];
}): boolean {
  if (i.status !== "READY") return false;
  if (!i.hadReady || !i.prevTop) return true;
  if (i.topKeys.length > 0 && i.prevTop[0] !== i.topKeys[0]) return true;
  return i.topKeys.some((k) => !i.prevTop!.includes(k));
}
