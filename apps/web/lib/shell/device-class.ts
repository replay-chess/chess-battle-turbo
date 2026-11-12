// The viewer's device class from the viewport (review_opened.device, the Sentry metric review.first_badge_render_ms):
// phone ≤ 600 px, tablet ≤ 1100 px or a coarse pointer without hover, else desktop. "desktop" on the server.
export type DeviceClass = "phone" | "tablet" | "desktop";

export function deviceClass(): DeviceClass {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  const coarse = window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false;
  if (w <= 600) return "phone";
  if (coarse || w <= 1100) return "tablet";
  return "desktop";
}
