// /train/weakness/** layout (phase-06 plan §4.1, §7.8): the train gate (sign-in, onboarding, membership, `train`), then
// the `weakness` flag (off → /train: the page does not exist for that viewer yet), and the realtime boot with a socket
// token minted in this render (the profile's `weakness:progress` / `weakness:ready` need no GET /api/socket-token).
// The redirects run HERE, before the page renders (P2 FIX-A, T17: never a redirect after anything streamed).
import type { Metadata } from "next";
import { serverBuildId } from "@/lib/api/context";
import { RealtimeBoot } from "@/lib/realtime/RealtimeBoot";
import { createMetadata } from "@/lib/seo";
import { trainSocketToken } from "../gate";
import { weaknessGate } from "./load";

export const metadata: Metadata = createMetadata({
  title: "Weakness profile",
  description: "The patterns that keep costing you points, measured against players at your level, each with a drill.",
  path: "/train/weakness",
  noIndex: true,
});

export default async function WeaknessLayout({ children }: { children: React.ReactNode }) {
  const viewer = await weaknessGate();
  const token = await trainSocketToken(viewer);
  return (
    <>
      <RealtimeBoot token={token} buildId={serverBuildId()} />
      {children}
    </>
  );
}
