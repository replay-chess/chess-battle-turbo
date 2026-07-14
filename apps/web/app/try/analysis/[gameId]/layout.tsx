import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Demo Game Analysis",
  description: "Analysis for a temporary ReplayChess demo game.",
  robots: { index: false, follow: false },
};

export default function TryAnalysisLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
