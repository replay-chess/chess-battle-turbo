"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

const noopSubscribe = () => () => {};

export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();
  // Mounted guard: the theme is unknown on the server.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <div data-testid="gallery-theme-toggle" role="group" aria-label="Theme" className="flex gap-2">
      <Button
        variant="secondary"
        size="sm"
        pressed={mounted ? !dark : undefined}
        onClick={() => setTheme("light")}
        data-testid="gallery-theme-light"
      >
        Light
      </Button>
      <Button
        variant="secondary"
        size="sm"
        pressed={mounted ? dark : undefined}
        onClick={() => setTheme("dark")}
        data-testid="gallery-theme-dark"
      >
        Dark
      </Button>
    </div>
  );
}
