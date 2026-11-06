import { z } from "zod";

/** GET /api/socket-token. Until the legacy mirror goes, the body also carries top-level token and expiresAt. */
export const SocketTokenData = z.object({
  token: z.string(),
  /** Unix seconds (P1's wire shape; the web route sends `claims.exp`). */
  expiresAt: z.number().int(),
});
export type SocketTokenData = z.infer<typeof SocketTokenData>;
