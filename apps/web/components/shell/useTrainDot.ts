"use client";

// The Train nav dot (phase-06 plan §7.1.5 ME-2, §8.16; interface check §4.1 "Train nav dot"). It means "your weakness
// profile has something new to look at": `badges.weaknessReady` of the viewer payload (`qk.me()`), which the server
// sends only while the `weakness` flag is on (`weaknessVersion > lastWeaknessSeenVersion`). The bank's due count is
// not a dot (P5 D-11: no nav due badge), so `trainDot` (bank due || weakness ready) is not what this reads.
//
// Kept fresh without a fetch of its own: the `weakness:ready {bumped}` event patches `qk.me()` (useWeaknessEvents,
// mounted on Home, the hub, the bank and the profile), the profile's TR-13 clears it, and `qk.me()`'s focus refetch
// (5 min stale) is the fallback for pages without a socket. Reads the query cache like useFlag (deferred
// subscription: a boolean snapshot, so unrelated cache events never re-render the shell).
import { useContext, useSyncExternalStore } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import type { MeData } from "@repo/contracts/http/me";
import { qk } from "@/lib/api/keys";
import { subscribeDeferred } from "@/lib/flags/client";

const noopUnsubscribe = () => {};

/** True when the dot shows: the `weakness` flag is on and the viewer payload says a new profile is waiting. */
export function trainDotOf(me: Pick<MeData, "badges"> | null | undefined, weaknessOn: boolean): boolean {
  return weaknessOn && me?.badges?.weaknessReady === true;
}

export function useTrainDot(weaknessOn: boolean): boolean {
  const client = useContext(QueryClientContext);
  const subscribe = (onChange: () => void) => (client ? subscribeDeferred(client, onChange) : noopUnsubscribe);
  const read = () => trainDotOf(client?.getQueryData<MeData>(qk.me()), weaknessOn);
  // Server and hydration read the same seeded payload (the (app) layout seeds `qk.me()`), as useFlag does.
  return useSyncExternalStore(subscribe, read, read);
}
