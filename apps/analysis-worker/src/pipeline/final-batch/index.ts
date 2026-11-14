// The extensions of the final batch, in the order they run (types.ts has the contract). Phase 3 writes no extension
// statement; P4 adds the import run's `analysed` count and the eval source (p04-import.ts); P5 the Mistake Bank
// statements (p05-bank.ts).
import { p04ImportExtension } from "./p04-import";
import { p05BankExtension } from "./p05-bank";
import type { Row, Statement } from "../../db/client";
import type { FinalBatchContext, FinalBatchExtension, FinalBatchSink } from "./types";

export const FINAL_BATCH_EXTENSIONS: readonly FinalBatchExtension[] = [p04ImportExtension, p05BankExtension];

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

/** One extension's own rows of a committed batch (`rows` = every extension statement's, in order), or null. */
export function extensionRowsOf(plan: ExtensionPlan, id: string, rows: readonly Row[][]): Row[][] | null {
  let at = 0;
  for (const g of plan.groups) {
    if (g.extension.id === id) return rows.slice(at, at + g.statements.length);
    at += g.statements.length;
  }
  return null;
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
