// /train/** layout: noindex metadata and the gate (sign-in, membership, the `train` flag), outside every child
// segment's loading.tsx Suspense boundary, so its redirects never run after a skeleton streamed (P2 FIX-A, T17). The
// runner segments keep their own layouts and session handling; this one adds nothing to their bundles (server only).
import type { Metadata } from "next";
import { createMetadata } from "@/lib/seo";
import { trainGate } from "./gate";

export const metadata: Metadata = createMetadata({
  title: "Train",
  description: "Your daily plan, the Mistake Bank and puzzles at your level.",
  path: "/train",
  noIndex: true,
});

export default async function TrainLayout({ children }: { children: React.ReactNode }) {
  await trainGate();
  return children;
}
