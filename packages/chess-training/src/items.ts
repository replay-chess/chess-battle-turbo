// Card item keys, the API ref of a training card (phase-05 plan §6.2, §8.1 step 8; interface check §0.14). Browser-safe
// (the /items subpath).
//
//   m_<sqid>   a Mistake: sqids of its epdHash as an unsigned 64-bit number split into two uint32 halves [hi, lo]
//              (sqids 0.3.0 only encodes numbers up to Number.MAX_SAFE_INTEGER). The worker knows epdHash before the
//              mistake row exists, so its HTTP batch needs no RETURNING; unique per user because epdHash is.
//   p_<id>     a Lichess puzzle id (5–8 alphanumerics).
//   o_<sqid>   an opening line (P8): sqids of the opening id.
//
// The alphabet and an empty blocklist are pinned here, so a sqids release that changed its defaults could not change
// a stored key. The keys are opaque, not secret. Decoding is strict: a key decodes only if re-encoding gives back the
// same string, so every value has exactly one key.
import Sqids from "sqids";

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const sqids = new Sqids({ alphabet: ALPHABET, minLength: 0, blocklist: new Set<string>() });

const UINT32 = 0xffffffffn;
const SQID_RE = /^[A-Za-z0-9]{1,24}$/;
const PUZZLE_ID_RE = /^[A-Za-z0-9]{5,8}$/;

export type ItemPrefix = "m" | "p" | "o";
export type ParsedItemKey = { kind: "mistake"; epdHash: bigint } | { kind: "puzzle"; puzzleId: string } | { kind: "opening"; openingId: number };

/** `m_` + sqids of the epdHash (signed int64) as two uint32 halves. */
export function mistakeItemKey(epdHash: bigint): string {
  if (epdHash < -(1n << 63n) || epdHash >= 1n << 63n) throw new RangeError("epdHash must be a signed 64-bit integer");
  const u = BigInt.asUintN(64, epdHash);
  return `m_${sqids.encode([Number(u >> 32n), Number(u & UINT32)])}`;
}

function decodeExact(body: string, count: number): number[] | null {
  if (!SQID_RE.test(body)) return null;
  const nums = sqids.decode(body);
  if (nums.length !== count) return null;
  if (sqids.encode(nums) !== body) return null;
  return nums;
}

/** The epdHash (signed int64) of an `m_` key, or null for anything else (another prefix, a non-canonical body). */
export function decodeMistakeItemKey(key: string): bigint | null {
  if (!key.startsWith("m_")) return null;
  const nums = decodeExact(key.slice(2), 2);
  if (!nums) return null;
  const [hi, lo] = nums as [number, number];
  if (hi > 0xffffffff || lo > 0xffffffff) return null;
  return BigInt.asIntN(64, (BigInt(hi) << 32n) | BigInt(lo));
}

/** `p_` + the Lichess puzzle id. */
export function puzzleItemKey(puzzleId: string): string {
  if (!PUZZLE_ID_RE.test(puzzleId)) throw new RangeError(`not a Lichess puzzle id: ${puzzleId}`);
  return `p_${puzzleId}`;
}

/** The puzzle id of a `p_` key, or null. */
export function decodePuzzleItemKey(key: string): string | null {
  if (!key.startsWith("p_")) return null;
  const id = key.slice(2);
  return PUZZLE_ID_RE.test(id) ? id : null;
}

/** `o_` + sqids of an opening id (P8). */
export function openingItemKey(openingId: number | bigint): string {
  const n = typeof openingId === "bigint" ? Number(openingId) : openingId;
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("openingId must be a non-negative safe integer");
  return `o_${sqids.encode([n])}`;
}

/** The opening id of an `o_` key, or null. */
export function decodeOpeningItemKey(key: string): number | null {
  if (!key.startsWith("o_")) return null;
  const nums = decodeExact(key.slice(2), 1);
  return nums ? nums[0]! : null;
}

/** Any item key, decoded; null for a malformed key or a foreign prefix. */
export function parseItemKey(key: string): ParsedItemKey | null {
  const epdHash = decodeMistakeItemKey(key);
  if (epdHash !== null) return { kind: "mistake", epdHash };
  const puzzleId = decodePuzzleItemKey(key);
  if (puzzleId !== null) return { kind: "puzzle", puzzleId };
  const openingId = decodeOpeningItemKey(key);
  if (openingId !== null) return { kind: "opening", openingId };
  return null;
}

/** True for a well-formed key of any kind. */
export function isItemKey(key: string): boolean {
  return parseItemKey(key) !== null;
}
