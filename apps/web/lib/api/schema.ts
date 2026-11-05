// devSchema (plan §7.12, CA AP-12): response schemas are parsed in dev and test builds only.
//
//   api(endpoints.me, { schema: devSchema(MeData) })
//
// `process.env.NODE_ENV` is replaced with a literal at build time, so in production this returns `undefined`,
// the minifier drops the branch, and the schema module (and zod with it) leaves the production chunk. Always pass
// a schema through this function: a schema passed directly is referenced and ships to every user.

export function devSchema<T>(schema: T): T | undefined {
  return process.env.NODE_ENV === "production" ? undefined : schema;
}
