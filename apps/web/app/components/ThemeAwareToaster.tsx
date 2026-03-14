"use client";

import { Toaster } from "sonner";
import { useTheme } from "next-themes";

export function ThemeAwareToaster() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Toaster
      theme={isDark ? "dark" : "light"}
      position="top-center"
      toastOptions={{
        style: {
          background: isDark ? '#0a0a0a' : '#FFFFFF',
          border: isDark
            ? '1px solid rgba(255, 255, 255, 0.1)'
            : '1px solid rgba(0, 0, 0, 0.08)',
          color: isDark ? '#ffffff' : '#1A1A1A',
          borderRadius: '0px',
        },
      }}
    />
  );
}
