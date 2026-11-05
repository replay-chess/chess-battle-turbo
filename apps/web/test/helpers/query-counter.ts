// Query-budget harness (plan §12.2): counts the SQL statements (and writes) a piece of server code runs, through the
// same AsyncLocalStorage store the Prisma timing extension (lib/prisma.ts) feeds for route().
//
//   const { statements } = await countQueries(() => getViewerRecord());          // plain server code
//   const n = routeStatements(recorded);                                          // a route() call: its "api" log line
import { createRequestStore, runWithRequestStore, type RequestStore } from "@/lib/api/timing";
import type { Recorded } from "./route-harness";

export type QueryCount<T> = { result: T; statements: number; writes: number; dbMs: number; writeOps: string[] };

/** Runs fn in a fresh request store and reports what the Prisma extension recorded. */
export async function countQueries<T>(fn: () => Promise<T>): Promise<QueryCount<T>> {
  const store: RequestStore = createRequestStore();
  // `async () => await fn()`: a PrismaPromise runs on .then(), which must happen inside the store.
  const result = await runWithRequestStore(store, async () => await fn());
  return { result, statements: store.dbStatements, writes: store.writes, dbMs: store.dbMs, writeOps: [...store.writeOps] };
}

/**
 * Statements of the last route() call recorded by the harness (route() opens its own store per request and logs
 * dbStatements on its "api" line).
 */
export function routeStatements(recorded: Recorded): number {
  const line = [...recorded.logs].reverse().find((l) => l.message === "api");
  if (!line) throw new Error("no route() log line recorded");
  return Number(line.context.dbStatements);
}
