// Strong ETags (plan §7.2.1). The default tag is the FNV-1a 64-bit hash (hex) of the serialised `data`, so equal JSON
// gives an equal tag. Key order matters only through JSON.stringify: DTO builders emit keys in a fixed order.

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

const encoder = new TextEncoder();

/** FNV-1a 64 over the UTF-8 bytes, as 16 lowercase hex characters. */
export function fnv1a64(input: string): string {
  let hash = FNV_OFFSET;
  for (const byte of encoder.encode(input)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}

/** A quoted strong ETag for a serialised body or version string. */
export function strongEtag(input: string): string {
  return `"${fnv1a64(input)}"`;
}

/** Quotes a precomputed tag value unless it is already quoted. */
export function quoteEtag(tag: string): string {
  return /^(W\/)?".*"$/.test(tag) ? tag : `"${tag}"`;
}

/**
 * True when If-None-Match matches the tag (RFC 9110 §13.1.2: weak comparison, so W/"x" matches "x"; `*` matches any).
 */
export function ifNoneMatchHit(ifNoneMatch: string | null | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const value = ifNoneMatch.trim();
  if (value === "*") return true;
  const bare = (tag: string) => tag.trim().replace(/^W\//, "");
  const target = bare(etag);
  return value.split(",").some((candidate) => bare(candidate) === target);
}
