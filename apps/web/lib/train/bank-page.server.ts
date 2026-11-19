// The Mistake Bank page read (R2 page 1 and the RSC seed) with the primary button's session (FIX-5 item A,
// docs/decisions.md D-P6-FIX5-1): `listBank` plus `bankButtonStart`, which decides resume vs new exactly as W2 does, so
// the button names the session its click opens. Kept apart from bank.server.ts, which the session service imports.
import { listBank, type BankFilterQuery, type BankListPage } from "./bank.server";
import { trainDeps, type TrainDeps } from "./db.server";
import { bankButtonStart } from "./sessions.server";
import type { Viewer } from "@/lib/auth/viewer";

export function listBankPage(viewer: Viewer, filter: BankFilterQuery, cursor: string | null, now: Date, deps: TrainDeps = trainDeps()): Promise<BankListPage> {
  return listBank(viewer, filter, cursor, now, deps, { start: bankButtonStart });
}
