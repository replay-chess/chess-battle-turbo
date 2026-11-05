// JSON serialisation for route() responses (plan §7.2 step 9).
//
// - Date → ISO string (Date#toJSON); undefined object fields are dropped; null is kept.
// - BigInt (Prisma ids) → throws in dev/test so the DTO gets fixed; in production it becomes a string and a Sentry
//   warning is sent, so a missed id never takes a page down.
// - Decimal-like objects (Prisma Decimal / decimal.js), Map and Set → throw in dev/test (they would silently become a
//   string or {}); in production Decimal becomes its string and Map/Set are left to JSON (an empty object).

type Env = Readonly<Record<string, string | undefined>>;

export class SerializeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SerializeError";
  }
}

export type SerializeMode = "strict" | "lenient";

/** Strict everywhere except a production build serving production. */
export function serializeModeFor(env: Env = process.env): SerializeMode {
  if (env.NEXT_PUBLIC_APP_ENV === "dev" || env.NEXT_PUBLIC_APP_ENV === "test") return "strict";
  return env.NODE_ENV === "production" ? "lenient" : "strict";
}

export type SerializeOptions = {
  mode?: SerializeMode;
  /** Called once per serialisation that had to coerce a value in lenient mode (Sentry warning). */
  onCoerce?: (kind: "bigint" | "decimal", path: string) => void;
};

function isDecimalLike(value: object): boolean {
  const v = value as { d?: unknown; e?: unknown; s?: unknown; toFixed?: unknown };
  return Array.isArray(v.d) && typeof v.e === "number" && typeof v.s === "number" && typeof v.toFixed === "function";
}

function pathOf(stack: string[], key: string): string {
  return [...stack, key].filter(Boolean).join(".") || "(root)";
}

/** JSON.stringify with the rules above. */
export function serialize(value: unknown, options: SerializeOptions = {}): string {
  const mode = options.mode ?? serializeModeFor();
  let coerced: { kind: "bigint" | "decimal"; path: string } | null = null;
  const parents = new WeakMap<object, string>();

  const json = JSON.stringify(value, function replacer(this: unknown, key: string, current: unknown) {
    // `this[key]` is the value before toJSON ran (Decimal#toJSON would already have turned it into a string).
    const holder = this as Record<string, unknown> | null;
    const raw = holder && typeof holder === "object" ? holder[key] : current;
    const parentPath = holder && typeof holder === "object" ? (parents.get(holder) ?? "") : "";
    const here = key === "" ? "" : pathOf(parentPath ? [parentPath] : [], key);

    if (typeof raw === "bigint") {
      if (mode === "strict") throw new SerializeError(`BigInt at ${here || "(root)"}: map ids to strings in the DTO`);
      coerced ??= { kind: "bigint", path: here };
      return raw.toString();
    }
    if (raw && typeof raw === "object") {
      if (raw instanceof Map || raw instanceof Set) {
        if (mode === "strict") throw new SerializeError(`${raw instanceof Map ? "Map" : "Set"} at ${here || "(root)"} is not JSON`);
        return current;
      }
      if (!(raw instanceof Date) && isDecimalLike(raw)) {
        if (mode === "strict") throw new SerializeError(`Decimal at ${here || "(root)"}: convert it to a number or string in the DTO`);
        coerced ??= { kind: "decimal", path: here };
        return String(raw);
      }
    }
    if (current && typeof current === "object") parents.set(current as object, here);
    return current;
  });

  if (coerced && options.onCoerce) {
    const { kind, path } = coerced;
    options.onCoerce(kind, path);
  }
  return json;
}
