import { createMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = createMetadata({
  title: "Contact ReplayChess Support and Partnerships",
  description:
    "Contact ReplayChess for product support, billing questions, chess content corrections, partnerships, press requests, or thoughtful feedback about the platform.",
  path: "/contact",
});

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
