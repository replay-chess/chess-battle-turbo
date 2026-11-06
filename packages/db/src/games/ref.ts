// Game reference ids for raw-SQL inserts. Prisma's `@default(cuid())` runs in the client, so statements that
// insert games without the model API (createLiveGame, createRematch) need their own id. The shape matches the
// wire `Ref` (`^c[a-z0-9]{20,31}$`, @repo/contracts/http/common): "c" + 8 time chars + 4 counter chars + 12 random.
import { randomBytes } from "node:crypto";

let counter = Math.floor(Math.random() * 36 ** 4);

export function newGameRef(now: number = Date.now()): string {
  counter = (counter + 1) % 36 ** 4;
  const time = now.toString(36).padStart(8, "0").slice(-8);
  const count = counter.toString(36).padStart(4, "0");
  const bytes = randomBytes(12);
  let random = "";
  for (const b of bytes) random += (b % 36).toString(36);
  return `c${time}${count}${random}`;
}
