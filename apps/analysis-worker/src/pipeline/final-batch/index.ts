// The extensions of the final batch, in the order they run (types.ts has the contract). Phase 3 writes no extension
// statement; P5 adds its file and one line here.
import type { FinalBatchContext, FinalBatchExtension } from "./types";

export const FINAL_BATCH_EXTENSIONS: readonly FinalBatchExtension[] = [];

/** Every extension's statements for one game, in order. */
export function extensionStatements(extensions: readonly FinalBatchExtension[], ctx: FinalBatchContext) {
  return extensions.flatMap((e) => e.statements(ctx));
}

export type { FinalBatchContext, FinalBatchExtension } from "./types";
