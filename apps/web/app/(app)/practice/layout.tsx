// /practice layout: noindex metadata and the gate (sign-in, membership, `review-v3`), outside the segment's
// loading.tsx Suspense boundary so its redirects never run after the skeleton streamed (P2 FIX-A, T17). Practice
// needs no socket: the engine is the browser's and nothing is written on the server.
import type { Metadata } from "next";
import { createMetadata } from "@/lib/seo";
import { practiceGate } from "./gate";

export const metadata: Metadata = createMetadata({
  title: "Practice",
  description: "Play on from any position against the engine, untimed and unrated.",
  path: "/practice",
  noIndex: true,
});

export default async function PracticeLayout({ children }: { children: React.ReactNode }) {
  await practiceGate();
  return children;
}
