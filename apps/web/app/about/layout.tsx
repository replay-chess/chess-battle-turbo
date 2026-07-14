import { createMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = createMetadata({
  title: "About the ReplayChess Learning Platform",
  description:
    "Meet the maker behind ReplayChess and learn why the platform turns famous chess positions into interactive lessons, calculation challenges, and playable history.",
  path: "/about",
});

export default function AboutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
