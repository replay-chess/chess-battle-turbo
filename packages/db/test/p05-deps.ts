// Test stand-ins for the domain functions the P5 persona writer takes (seed/p05-persona-states.ts TrainingDeps). The
// real ones are @repo/chess-analysis/epd (WP-C) and @repo/chess-training/{items,day,release,mastery} (WP-B), wired by
// the web's persona tool; these follow the same documented rules (plan 8.1 step 6, 8.4, 8.8) closely enough for the
// writer's tests, which check structure and idempotency, not the codecs themselves.
import type { CardStateDb, TrainingDeps } from "../seed/p05-persona-states";

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = (1n << 64n) - 1n;

/** fnv1a-64 of the EPD (FEN fields 1–4), as a signed int64. */
export function testEpdHash(fen: string): bigint {
  const epd = fen.split(" ").slice(0, 4).join(" ");
  let h = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(epd)) h = ((h ^ BigInt(byte)) * FNV_PRIME) & MASK;
  return BigInt.asIntN(64, h);
}

function parts(at: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute) };
}

function offsetMs(at: Date, tz: string): number {
  const p = parts(at, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(at.getTime() / 60_000) * 60_000;
}

function zonedToUtc(y: number, m: number, d: number, h: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h);
  const o1 = offsetMs(new Date(guess), tz);
  const t = guess - o1;
  const o2 = offsetMs(new Date(t), tz);
  return new Date(o1 === o2 ? t : guess - o2);
}

export const TEST_DEPS: TrainingDeps = {
  epdHash: testEpdHash,
  mistakeItemKey: (h) => `m_${BigInt.asUintN(64, h).toString(36)}`,
  dayKey: (now, tz, dayStartHour) => {
    const p = parts(new Date(now.getTime() - dayStartHour * 3_600_000), tz);
    return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  },
  nextRelease: (now, tz, releaseHour) => {
    const p = parts(now, tz);
    const today = zonedToUtc(p.y, p.m, p.d, releaseHour, tz);
    if (today.getTime() > now.getTime()) return today;
    const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
    return zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), releaseHour, tz);
  },
  masteryOf: (state: CardStateDb, s: number) => {
    if (state !== "REVIEW") return 0;
    return s < 4 ? 1 : s < 10 ? 2 : s < 30 ? 3 : s < 90 ? 4 : 5;
  },
};
