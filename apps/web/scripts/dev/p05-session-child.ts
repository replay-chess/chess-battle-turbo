// The persona tool's way to run ./p05-session.ts (dev-perfect's session through W2 → W1 → W4): in a tsx child on the
// same target URL. The train services import the route context, which imports `next/server`; Playwright's loader
// (leasePersona → resetPersona) cannot resolve that, so this file imports none of them.
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PersonaSessionInput } from "@repo/db/seed/p05-personas";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** A `P05WriteOptions.session` that completes the session in a tsx child against `url` (the reset's target). */
export function personaSessionInChild(url: string) {
  return (_db: unknown, input: PersonaSessionInput): Promise<{ attempts: number }> =>
    new Promise((resolve, reject) => {
      execFile(
        path.join(WEB_DIR, "node_modules/.bin/tsx"),
        ["scripts/dev/p05-session.ts", input.userId.toString(), input.userRef, input.persona, input.now.toISOString()],
        { cwd: WEB_DIR, env: { ...process.env, PERSONA_SESSION_DATABASE_URL: url, DATABASE_URL: url, DIRECT_URL: url }, timeout: 120_000 },
        (err, stdout, stderr) => {
          if (err) return reject(new Error(`[personas] ${input.persona} session failed: ${stderr.trim().split("\n").slice(-3).join(" | ") || err.message}`));
          const line = stdout.trim().split("\n").pop() ?? "";
          try {
            resolve(JSON.parse(line) as { attempts: number });
          } catch {
            reject(new Error(`[personas] ${input.persona} session: unexpected output`));
          }
        },
      );
    });
}
