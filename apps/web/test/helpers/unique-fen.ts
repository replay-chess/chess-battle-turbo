// chess_positions.fen is unique, and the integration suites run in parallel against one database (CI and local
// Docker), each creating "its own" copy of the same legend position. Only the halfmove clock is free to vary (the
// legend comparison matches placement and side to move; the fullmove number names the moves), and it has 100
// values, so a random pick collided between parallel files and with rows a crashed run left behind
// (regression: int-unique-fen: "Unique constraint failed on the fields: (`fen`)" in share.contract.int.test.ts).
import { randomInt } from "node:crypto";

/** The FEN with its halfmove clock (field 5) set to `halfmove`. */
export function withHalfmove(fen: string, halfmove: number): string {
  const f = fen.trim().split(/\s+/);
  if (f.length !== 6) throw new Error(`not a six-field FEN: ${fen}`);
  f[4] = String(halfmove);
  return f.join(" ");
}

function isUniqueFenViolation(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } } | null;
  return e?.code === "P2002" && JSON.stringify(e.meta?.target ?? "").includes("fen");
}

/**
 * Runs `create` with the FEN at a random free halfmove clock (0–99), trying another value on a unique-`fen` conflict.
 * Throws after `tries` conflicts (the 100 values are then nearly all taken by leftovers: clean the test database).
 */
export async function createWithFreeFen<T>(fen: string, create: (fen: string) => Promise<T>, tries = 60): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await create(withHalfmove(fen, randomInt(0, 100)));
    } catch (err) {
      if (!isUniqueFenViolation(err) || i + 1 >= tries) throw err;
    }
  }
}
