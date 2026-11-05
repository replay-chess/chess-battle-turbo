// PII guard patterns (phase-01 plan §10.1, CT X6). Used by the e2e telemetry
// fixture on every captured event, and by the registry tests.

/** Property names no event may declare: they invite free text or personal data. */
export const FORBIDDEN_PROPERTY_NAMES = ["email", "q", "query", "fen", "pgn", "name"] as const;

export const PII_PATTERNS = {
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /** Seven ranks of a FEN board followed by a slash. */
  fen: /^([prnbqkPRNBQK1-8]{1,8}\/){7}/,
  /** A move-number run such as "1. e4", "12...Nf6" or "3.Bxf7+". */
  pgn: /\b\d+\.(\.\.)?\s?[KQRBNO]?[a-h1-8x=+#-]{2,}/,
} as const;

export type PiiFinding = { path: string; kind: "email" | "fen" | "pgn" | "forbidden"; value: string };

/**
 * Walks a property bag and reports every string value that looks like PII.
 * `forbidden` holds exact texts (the test user's name and email, text the spec
 * typed); a value containing one of them, case-insensitively, is a finding.
 */
export function findPii(props: unknown, forbidden: readonly string[] = [], path = "props"): PiiFinding[] {
  const findings: PiiFinding[] = [];
  const needles = forbidden.map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 3);
  const visit = (value: unknown, at: string) => {
    if (typeof value === "string") {
      for (const kind of ["email", "fen", "pgn"] as const) {
        if (PII_PATTERNS[kind].test(value)) findings.push({ path: at, kind, value });
      }
      const lower = value.toLowerCase();
      if (needles.some((n) => lower.includes(n))) findings.push({ path: at, kind: "forbidden", value });
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, `${at}[${i}]`));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) visit(v, `${at}.${k}`);
    }
  };
  visit(props, path);
  return findings;
}
