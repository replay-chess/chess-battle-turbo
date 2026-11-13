// The extensions of the final batch, in the order they run (types.ts has the contract). Phase 3 writes no extension
// statement; P4 adds the import run's `analysed` count and the eval source (p04-import.ts); P5 adds its file and one
// line here.
import { p04ImportExtension } from "./p04-import";
import type { Row, Statement } from "../../db/client";
import type { FinalBatchContext, FinalBatchExtension, FinalBatchSink } from "./types";

export const FINAL_BATCH_EXTENSIONS: readonly FinalBatchExtension[] = [p04ImportExtension];

/** Every extension's statements for one game, in order. */
export function extensionStatements(extensions: readonly FinalBatchExtension[], ctx: FinalBatchContext) {
  return extensions.flatMap((e) => e.statements(ctx));
}

/** The statements per extension (the analysis hands each one its own rows back after the commit). */
export interface ExtensionPlan {
  ctx: FinalBatchContext;
  groups: { extension: FinalBatchExtension; statements: Statement[] }[];
  statements: Statement[];
}

export function planExtensions(extensions: readonly FinalBatchExtension[], ctx: FinalBatchContext): ExtensionPlan {
  const groups = extensions.map((extension) => ({ extension, statements: extension.statements(ctx) }));
  return { ctx, groups, statements: groups.flatMap((g) => g.statements) };
}

/** After the commit: each extension's `committed` with its own rows (`rows` = every extension statement's, in order). */
export function reportCommitted(plan: ExtensionPlan, rows: readonly Row[][] | null, sink: FinalBatchSink): void {
  if (!rows) return;
  let at = 0;
  for (const g of plan.groups) {
    const mine = rows.slice(at, at + g.statements.length);
    at += g.statements.length;
    try {
      g.extension.committed?.(plan.ctx, mine, sink);
    } catch {
      // Telemetry never fails an analysis that has committed.
    }
  }
}

export type { FinalBatchContext, FinalBatchExtension, FinalBatchSink } from "./types";
