import { createMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = createMetadata({
  title: "Future Careers at ReplayChess",
  description:
    "Learn how ReplayChess is being built and where to send a note if you would like to hear about future roles when the team begins to grow.",
  path: "/careers",
  noIndex: true,
  noFollow: false,
});

export default function CareersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
