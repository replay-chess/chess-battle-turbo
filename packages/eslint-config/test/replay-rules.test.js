// RuleTester cases for the `replay` plugin (phase-02 plan §7.4.3 room literals, §7.5.1 internal auth in client code).
import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { replayPlugin } from "../replay-rules.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: "module" } });

tester.run("replay/no-room-literal", replayPlugin.rules["no-room-literal"], {
  valid: [
    'socket.on("game:move", h)',
    'socket.emit("game:join", { ref })',
    'emit("move:applied", p)',
    'emit("session:hello", p)',
    'emit("user:noop")',
    "io.to(ROOM.game(ref)).emit(name, p)",
    'const label = "game over";',
    "const t = `study:${n}`;",
  ],
  invalid: [
    { code: "io.to(`game:${ref}`)", errors: [{ messageId: "room" }] },
    { code: "socket.join(`user:${sub}`)", errors: [{ messageId: "room" }] },
    { code: "socket.leave(`tournament:${slug}`)", errors: [{ messageId: "room" }] },
    { code: "io.to(`spectate:${ref}`)", errors: [{ messageId: "room" }] },
    { code: 'io.to("game:" + ref)', errors: [{ messageId: "room" }] },
    { code: 'name.startsWith("user:")', errors: [{ messageId: "room" }] },
    { code: 'io.to("game:cm3k9x2p10007slzpqa8hd4fe")', errors: [{ messageId: "room" }] },
    { code: 'io.to("tournament:friday-opera-arena")', errors: [{ messageId: "room" }] },
    { code: "io.to(`user:`)", errors: [{ messageId: "room" }] },
  ],
});

tester.run("replay/no-internal-auth-in-client", replayPlugin.rules["no-internal-auth-in-client"], {
  valid: [
    'import { signInternal } from "@repo/contracts/internal/auth";',
    '"use server"; import { signInternal } from "@repo/contracts/internal/auth";',
    '"use client"; import { ROOM } from "@repo/contracts/socket/rooms";',
    { code: 'import { x } from "@repo/contracts/http/games";', options: [{ always: true }] },
  ],
  invalid: [
    { code: '"use client"; import { signInternal } from "@repo/contracts/internal/auth";', errors: [{ messageId: "client" }] },
    { code: '"use client"; export { verifyInternal } from "@repo/contracts/internal/auth";', errors: [{ messageId: "client" }] },
    { code: '"use client"; const m = import("@repo/contracts/internal/auth");', errors: [{ messageId: "client" }] },
    { code: '"use client"; import x from "../../packages/contracts/src/internal/auth";', errors: [{ messageId: "client" }] },
    { code: 'import { signInternal } from "@repo/contracts/internal/auth";', options: [{ always: true }], errors: [{ messageId: "client" }] },
  ],
});
