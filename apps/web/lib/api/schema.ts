// devSchema (plan §7.12, CA AP-12): response schemas are parsed in dev and test builds only.
//
// Measured by 1B·F7's bundle budget (apps/web/scripts/check-bundle-budgets.mjs): passing a schema through this
// function does NOT keep zod out of production chunks. webpack decides which imports are used before the minifier
// inlines the call, so `devSchema(MeData)` still marks MeData as used, and the contract module (top-level z.object()
// calls, which no bundler may drop) ships zod to every page. In client code, write the check at the call site instead:
//
//   const schema = process.env.NODE_ENV === "production" ? undefined : MeData;
//   const { data } = await api(endpoints.me, { schema, signal });
//
// webpack folds the literal condition while parsing, the MeData import becomes unused, and `"sideEffects": false` in
// @repo/contracts lets it skip the module. This helper stays for dev-only pages (/dev/**) and tests.

export function devSchema<T>(schema: T): T | undefined {
  return process.env.NODE_ENV === "production" ? undefined : schema;
}
