// The legacy /play page's entry params (phase-05 plan §4.1 Home "Play" links; FIX-2): Home links to a mode and, for
// Quick Match, a time control, and /play opens with them selected.
//
//   ?tab=quick | friend | bot   → Quick Match | Challenge a Friend | Play the Machine (anything else: the page default)
//   ?tc=<minutes>+<increment>   → that time control (e.g. "5+3", Home's "Quick Match · 5+3"); 1–180 min, 0–60 s
//
// Pure, so it is unit-tested; the page applies the result once from its search params.

export type PlayMode = "quick" | "friend" | "ai";

/** The selector's value shape (app/components/TimeControlSelector.tsx `TimeControlValue`). */
export type PlayTimeControl = { mode: string; control: string; time: number; increment: number };

const TAB_MODE: Record<string, PlayMode> = { quick: "quick", friend: "friend", bot: "ai" };

export function playModeOf(tab: string | null): PlayMode | null {
  return tab ? (TAB_MODE[tab] ?? null) : null;
}

/** "5+3" → Blitz 5 | 3 (300 s + 3 s). The family follows the selector's groups: < 3 min Bullet, < 10 min Blitz, else Rapid. */
export function timeControlOf(tc: string | null): PlayTimeControl | null {
  const m = tc ? /^(\d{1,3})\+(\d{1,2})$/.exec(tc.trim()) : null;
  if (!m) return null;
  const minutes = Number(m[1]);
  const increment = Number(m[2]);
  if (minutes < 1 || minutes > 180 || increment > 60) return null;
  const mode = minutes < 3 ? "Bullet" : minutes < 10 ? "Blitz" : "Rapid";
  return { mode, control: increment === 0 ? `${minutes} min` : `${minutes} | ${increment}`, time: minutes * 60, increment };
}
