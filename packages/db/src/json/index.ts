// @repo/db/json: the JSON column registry (data-model §2.6). One file per JSON column shape.
export * from "./game-meta";
// M3 (P3, phase-03 plan 6.6): player_reviews.content/progress and game_analyses.lines, legend_comparisons.facts,
// shares.snapshot.
export * from "./review";
export * from "./legend";
export * from "./share";
// M4 (P4, phase-04 plan 6.4): linked_accounts.ratings / "lastError", import_runs.error, import_cursors.archives, and
// the P4 job payloads (re-exported from @repo/contracts/internal/jobs).
export * from "./ratings";
export * from "./import-error";
export * from "./import-cursor";
export * from "./jobs";
