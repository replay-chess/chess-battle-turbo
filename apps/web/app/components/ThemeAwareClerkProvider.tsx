"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { useTheme } from "next-themes";
import { getClerkAppearance } from "@/lib/clerk-theme";

export function ThemeAwareClerkProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { resolvedTheme } = useTheme();

  return (
    <ClerkProvider appearance={getClerkAppearance(resolvedTheme)}>
      {children}
    </ClerkProvider>
  );
}
