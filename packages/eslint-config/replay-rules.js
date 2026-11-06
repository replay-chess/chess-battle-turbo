// Replay Chess custom ESLint rules (phase-02 plan §7.4.3, §7.5.1), plugin name `replay`.
//
// They are custom rules rather than `no-restricted-syntax` / `no-restricted-imports` entries on purpose: ESLint
// replaces (does not merge) a rule's options when two config objects set it for the same file, and apps/web's
// eslint.config.js sets both rules for app/, components/ and lib/. A shared `no-restricted-syntax` ban would
// silently disappear in exactly the files that need it.

const ROOM_PREFIX = /^(user|game|spectate|tournament):/;
/** A bare prefix ("game:") used in concatenation or startsWith. */
const BARE_PREFIX = /^(user|game|spectate|tournament):$/;
/** A literal room with an id: a cuid or a slug-like id with a digit or dash ("game:cm3k…", "tournament:fri-arena"). */
const LITERAL_ROOM = /^(user|game|spectate|tournament):(c[a-z0-9]{20,31}|[A-Za-z0-9_]*[0-9-][A-Za-z0-9_-]*)$/;

/** @type {import("eslint").Rule.RuleModule} */
const noRoomLiteral = {
  meta: {
    type: "problem",
    docs: { description: "Room names are built only by ROOM in @repo/contracts/socket/rooms (phase-02 plan §7.4.3)." },
    messages: {
      room: 'Build room names with ROOM from "@repo/contracts/socket/rooms" instead of a string ("{{text}}").',
    },
    schema: [],
  },
  create(context) {
    const report = (node, text) => context.report({ node, messageId: "room", data: { text: text.slice(0, 40) } });
    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        if (BARE_PREFIX.test(node.value) || LITERAL_ROOM.test(node.value)) report(node, node.value);
      },
      TemplateLiteral(node) {
        if (node.expressions.length === 0) {
          const text = node.quasis[0]?.value.cooked ?? "";
          if (BARE_PREFIX.test(text) || LITERAL_ROOM.test(text)) report(node, text);
          return;
        }
        const head = node.quasis[0]?.value.cooked ?? "";
        // `game:${ref}` and friends; event names never interpolate.
        if (ROOM_PREFIX.test(head)) report(node, `${head}\${…}`);
      },
    };
  },
};

const INTERNAL_AUTH = /^@repo\/contracts\/internal(\/|$)|(^|\/)contracts\/src\/internal\//;

function hasUseClient(program) {
  for (const stmt of program.body) {
    if (stmt.type !== "ExpressionStatement" || typeof stmt.directive !== "string") break;
    if (stmt.directive === "use client") return true;
  }
  return false;
}

/** @type {import("eslint").Rule.RuleModule} */
const noInternalAuthInClient = {
  meta: {
    type: "problem",
    docs: { description: "@repo/contracts/internal/* holds service keys and HMAC signing: server code only (§7.5.1)." },
    messages: {
      client: "@repo/contracts/internal is server-only (HMAC with service keys); it must never reach client code.",
    },
    schema: [
      {
        type: "object",
        properties: { always: { type: "boolean" } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const always = context.options[0]?.always === true;
    let client = always;
    const check = (node, source) => {
      if (client && typeof source === "string" && INTERNAL_AUTH.test(source)) context.report({ node, messageId: "client" });
    };
    return {
      Program(node) {
        client = always || hasUseClient(node);
      },
      ImportDeclaration(node) {
        check(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        check(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") check(node, node.source.value);
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "require" && node.arguments[0]?.type === "Literal") {
          check(node, node.arguments[0].value);
        }
      },
    };
  },
};

export const replayPlugin = {
  meta: { name: "replay" },
  rules: {
    "no-room-literal": noRoomLiteral,
    "no-internal-auth-in-client": noInternalAuthInClient,
  },
};

/** Files that may spell room names: the builder and the event registry. Legacy v1 socket code until the gate. */
export const ROOM_LITERAL_EXEMPT = ["**/contracts/src/socket/rooms.ts", "**/contracts/src/socket/registry.ts", "**/src/v1/**"];
