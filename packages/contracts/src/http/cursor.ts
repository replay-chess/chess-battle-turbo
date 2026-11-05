// Keyset cursors (API §2.7): base64url(JSON.stringify([1, ...parts])), where 1 is the cursor format version.
// Opaque to clients and not signed: every list query is already scoped by the viewer.
// No Node built-ins (Buffer): this module may run in the browser and on the edge.

export type CursorPart = string | number | null;

const VERSION = 1;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string | null {
  if (!BASE64URL.test(encoded) || encoded.length % 4 === 1) return null;
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((encoded.length + 3) % 4);
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isPart(value: unknown): value is CursorPart {
  return value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

/** Encodes the sort-key tuple of the last row (ending with its unique id). */
export function encodeCursor(parts: readonly CursorPart[]): string {
  return toBase64Url(JSON.stringify([VERSION, ...parts]));
}

/**
 * Decodes a cursor into exactly `arity` parts. Anything else (bad base64, bad JSON, wrong version, wrong arity,
 * non-scalar parts) returns null; the route answers 400 validation_failed with path ["cursor"].
 */
export function decodeCursor<T extends CursorPart[] = CursorPart[]>(c: string | null | undefined, arity: number): T | null {
  if (typeof c !== "string" || c.length === 0 || c.length > 256) return null;
  const json = fromBase64Url(c);
  if (json === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length !== arity + 1 || value[0] !== VERSION) return null;
  const parts = value.slice(1);
  if (!parts.every(isPart)) return null;
  return parts as T;
}
