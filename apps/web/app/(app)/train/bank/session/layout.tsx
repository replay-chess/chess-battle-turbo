// /train/bank/session layout (phase-05 plan §4.4, §11): the sign-in and membership redirects run HERE, outside this
// segment's loading.tsx Suspense boundary (FIX-A, T17: a redirect() thrown by a page after its skeleton streamed
// crashed the dev router). The page repeats the gate (same React-cached viewer, no extra query) because soft
// navigations skip layouts, and it handles the `train` flag and the session itself.
import type { Metadata } from "next";
import { requireMemberPage } from "@/lib/auth/require-member-page";

export const metadata: Metadata = { title: "Mistake Bank Drill", robots: { index: false, follow: false } };

export default async function BankSessionLayout({ children }: { children: React.ReactNode }) {
  await requireMemberPage({ returnTo: "/train/bank/session" });
  return children;
}
