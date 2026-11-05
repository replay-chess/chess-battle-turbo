"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

const LIGHT = "#FAF9F6";
const DARK = "#000000";

function apply(dark: boolean) {
  const color = dark ? DARK : LIGHT;
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (metas.length === 0) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = color;
    document.head.append(meta);
    return;
  }
  for (const meta of metas) meta.content = color;
}

/**
 * Keeps <meta name="theme-color"> on the app theme (SPEC 5.2, H3): #000000 in
 * dark, #FAF9F6 in light. It follows next-themes and also the `.dark` class on
 * <html> directly, so a class toggled by anything else stays in sync. Renders null.
 */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const root = document.documentElement;
    apply(resolvedTheme === "dark" || root.classList.contains("dark"));
    const observer = new MutationObserver(() => apply(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [resolvedTheme]);

  return null;
}
