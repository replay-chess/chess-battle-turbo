// The query-key factory `qk` (plan §5.3, CDL §3.3). One file per domain in this directory; a phase adds keys by
// editing its own domain file, and a new domain adds one file plus one import and one spread line here.
// No client-only imports: server components and the client build the same keys.
//
// Rules: the first segment is the domain (so a prefix invalidates a whole domain); ids are refs or slugs, never DB
// ids; filters are one normalised object at the end (`norm`); viewer-scoped keys carry no user id (the cache is
// per tab and cleared on sign-out). Queries are declared once with `queryOptions()` in `lib/api/queries/<domain>.ts`.
import { accountKeys } from "./account";
import { adminKeys } from "./admin";
import { billingKeys } from "./billing";
import { catalogKeys } from "./catalog";
import { coachKeys } from "./coach";
import { gameKeys } from "./game";
import { learnKeys } from "./learn";
import { meKeys } from "./me";
import { playKeys } from "./play";
import { reviewKeys } from "./review";
import { systemKeys } from "./system";
import { tournamentKeys } from "./tournament";
import { trainKeys } from "./train";

/** Each file's fragment, by file name (keys.test.ts checks domains and duplicates through this). */
export const KEY_FILES = {
  account: accountKeys,
  admin: adminKeys,
  billing: billingKeys,
  catalog: catalogKeys,
  coach: coachKeys,
  game: gameKeys,
  learn: learnKeys,
  me: meKeys,
  play: playKeys,
  review: reviewKeys,
  system: systemKeys,
  tournament: tournamentKeys,
  train: trainKeys,
} as const;

export const qk = {
  ...meKeys,
  ...catalogKeys,
  ...billingKeys,
  ...gameKeys,
  ...reviewKeys,
  ...trainKeys,
  ...coachKeys,
  ...learnKeys,
  ...playKeys,
  ...accountKeys,
  ...tournamentKeys,
  ...adminKeys,
  ...systemKeys,
} as const;

export type QueryKeys = typeof qk;

export { norm, type Filters, type FilterValue } from "./norm";
export type { GamesFilter } from "./game";
export type { BankFilter } from "./train";
