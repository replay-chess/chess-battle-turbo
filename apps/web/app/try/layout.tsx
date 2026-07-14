import type { Metadata } from "next";
import { createMetadata } from "@/lib/seo";

export const metadata: Metadata = createMetadata({
  title: "Play Legendary Chess Positions Free",
  description:
    "Play famous chess positions against the engine without creating an account. Find the plan, test your calculation, and review the decisions behind each move.",
  path: "/try",
});

export default function TryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
