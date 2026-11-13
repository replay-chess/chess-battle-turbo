// @repo/chess-import's NDJSON splitter (src/lichess/ndjson.ts) names the WHATWG `ReadableWritablePair` type, which
// TypeScript declares only in lib.dom. The worker compiles with lib es2022 + @types/node (no DOM), where the same
// type lives in `node:stream/web`; this declaration makes the name resolve to Node's identical definition so the
// worker can type-check the Lichess client it bundles. Types only: nothing is emitted.
import type { ReadableWritablePair as NodeReadableWritablePair } from "node:stream/web";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type ReadableWritablePair<R = any, W = any> = NodeReadableWritablePair<R, W>;
}

export {};
