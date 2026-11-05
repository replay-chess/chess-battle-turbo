// Clerk session claims (plan phase-01 §7.6, §8.4). The Clerk session token template
// `{"md": "{{user.public_metadata}}"}` (owner action Q-06) copies publicMetadata into the JWT, so
// `auth().sessionClaims.md` is typed here. Middleware treats a missing claim as "unknown" and lets
// the page decide; every API decides from the database.
import type { RcPublicMetadata } from "@/lib/auth/claims";

declare global {
  interface CustomJwtSessionClaims {
    md?: RcPublicMetadata;
  }
}

export {};
