"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const isDark = theme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="flex items-center gap-3 px-4 py-3 border border-cb-border hover:bg-cb-hover transition-colors duration-200 w-full"
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
    >
      <div className="w-5 h-5 flex items-center justify-center">
        {isDark ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-cb-text-secondary"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="m4.93 4.93 1.41 1.41" />
            <path d="m17.66 17.66 1.41 1.41" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="m6.34 17.66-1.41 1.41" />
            <path d="m19.07 4.93-1.41 1.41" />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-cb-text-secondary"
          >
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
          </svg>
        )}
      </div>
      <div className="flex flex-col items-start">
        <span className="text-[11px] tracking-[0.1em] uppercase font-medium text-cb-text-secondary">
          Theme
        </span>
        <span className="text-[13px] text-cb-text">
          {isDark ? "Dark" : "Light"} Mode
        </span>
      </div>
      <div className="ml-auto">
        <div
          className="w-10 h-5 border border-cb-border-strong relative transition-colors duration-200 bg-cb-surface-elevated"
        >
          <div
            className="w-3.5 h-3.5 bg-cb-text absolute top-[2px] transition-all duration-200"
            style={{
              left: isDark ? "2px" : "20px",
            }}
          />
        </div>
      </div>
    </button>
  );
}
