// /train/puzzles layout (phase-05 plan §4.5, §11): the sign-in and membership redirects run HERE, before anything
// renders (FIX-A, T17: a redirect() thrown by a page after a loading.tsx skeleton had streamed crashed the dev router).
// The page repeats the gate (same React-cached viewer, no extra query) because soft navigations skip layouts, and it
// handles the `train` flag and the session itself. The segment has no loading.tsx: the runner and its interactive board
// are in the document's shell, never a streamed Suspense segment (a hidden second copy of the board stayed in the
// document after a reload on WebKit when React client-rendered such a boundary first; train-document.spec.ts).
import type { Metadata } from "next";
import { requireMemberPage } from "@/lib/auth/require-member-page";

export const metadata: Metadata = { title: "Puzzles", robots: { index: false, follow: false } };

export default async function PuzzlesLayout({ children }: { children: React.ReactNode }) {
  await requireMemberPage({ returnTo: "/train/puzzles" });
  return children;
}
