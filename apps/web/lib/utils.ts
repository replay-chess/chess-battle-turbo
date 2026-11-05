import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge must know the custom type, shadow and animation utilities from
// app/globals.css, or it drops `text-ui` next to a colour class (SPEC 5.2, F B1).
const twMerge = extendTailwindMerge<"rc-type">({
  extend: {
    classGroups: {
      "font-size": [{ text: ["2xs", "label", "ui", "body", "heading", "title", "wordmark"] }],
      "rc-type": ["text-overline", "text-eyebrow"],
      shadow: [{ shadow: ["pop", "toast", "dialog", "modal", "board", "square-light", "square-dark", "badge", "mq", "promo"] }],
      animate: [{ animate: [(v: string) => v.startsWith("rc-")] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format seconds into MM:SS display format
 */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/**
 * Get initials from a name (up to 2 characters)
 */
export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
