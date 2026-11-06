// Internal request signing (phase-02 plan §7.5.1, §12.1): a valid signature passes; unknown kid, |now − ts| > 60 s,
// a changed method, path or body, and a replayed signature each fail; a bare legacy secret is read as kid `web`;
// the allow-list refuses `entitlement:changed` from kid `wk` and `/internal/broadcast` from kid `web`.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import {
  canonicalString,
  EMPTY_KEY_RING,
  HEADER_KID,
  HEADER_SIG,
  HEADER_TS,
  INTERNAL_KIDS,
  INTERNAL_PATHS,
  INTERNAL_POLICY,
  INTERNAL_REPLAY_WINDOW_MS,
  kidMayCall,
  kidMayEmit,
  parseKeyRing,
  ReplayGuard,
  restrictKeyRing,
  sha256Hex,
  signInternal,
  verifyInternal,
} from "../auth";

const web = randomBytes(32).toString("base64");
const ops = randomBytes(32).toString("base64");
const wk = randomBytes(32).toString("base64url");
const NOW = 1_793_563_200_000;
const BODY = JSON.stringify({ v: 1, targets: [{ userRef: "cm1a7s3c10003ls8dh2m7q5yt" }], event: "test:echo", data: { text: "hi" } });

/** The socket server's view: it accepts web and ops. */
const receiver = parseKeyRing(`web:${web},ops:${ops}`);
const webSender = parseKeyRing(`web:${web}`);
const opsSender = parseKeyRing(`ops:${ops}`);

function signed(over: { method?: string; path?: string; body?: string; nowMs?: number; keys?: typeof webSender } = {}) {
  return signInternal({
    keys: over.keys ?? webSender,
    method: over.method ?? "POST",
    path: over.path ?? "/internal/emit",
    body: over.body ?? BODY,
    nowMs: over.nowMs ?? NOW,
  });
}

function verify(headers: Record<string, string>, over: { method?: string; path?: string; body?: string; nowMs?: number; replay?: ReplayGuard } = {}) {
  return verifyInternal({
    headers,
    method: over.method ?? "POST",
    path: over.path ?? "/internal/emit",
    body: over.body ?? BODY,
    keys: receiver,
    nowMs: over.nowMs ?? NOW,
    replay: over.replay,
  });
}

describe("internal auth: key rings", () => {
  it("parses kid:base64 lists; the first entry signs", () => {
    const ring = parseKeyRing(` web:${web} , ops:${ops} `);
    assert.equal(ring.signingKid, "web");
    assert.deepEqual([...ring.keys.keys()], ["web", "ops"]);
    assert.equal(ring.keys.get("web")?.length, 32);
    assert.equal(parseKeyRing(`wk:${wk}`).keys.get("wk")?.length, 32, "base64url is accepted too");
  });

  it("reads a bare legacy secret as kid web", () => {
    const ring = parseKeyRing("0f3a9c1b2d4e5f60718293a4b5c6d7e8f9");
    assert.equal(ring.signingKid, "web");
    assert.deepEqual(ring.keys.get("web"), Buffer.from("0f3a9c1b2d4e5f60718293a4b5c6d7e8f9", "utf8"));
    const headers = signInternal({ keys: ring, method: "POST", path: "/internal/emit", body: BODY, nowMs: NOW });
    assert.equal(headers[HEADER_KID], "web");
    assert.deepEqual(verifyInternal({ headers, method: "POST", path: "/internal/emit", body: BODY, keys: ring, nowMs: NOW }), {
      ok: true,
      kid: "web",
    });
  });

  it("unset or blank is an empty ring: signing throws, verifying refuses", () => {
    for (const raw of [undefined, null, "", "   "]) assert.equal(parseKeyRing(raw), EMPTY_KEY_RING);
    assert.throws(() => signInternal({ keys: EMPTY_KEY_RING, method: "POST", path: "/x", body: "", nowMs: NOW }), /no signing key/);
    assert.deepEqual(
      verifyInternal({ headers: signed(), method: "POST", path: "/internal/emit", body: BODY, keys: EMPTY_KEY_RING, nowMs: NOW }),
      { ok: false, reason: "unknown_kid" },
    );
  });

  it("throws on a malformed value without echoing key material", () => {
    const secret = randomBytes(32).toString("base64");
    const cases = [`WEB:${secret}`, `web:${secret},web:${secret}`, "web:short", `:${secret}`, `toolongkid:${secret}`, "web:not base64!"];
    for (const raw of cases) {
      assert.throws(
        () => parseKeyRing(raw),
        (e: Error) => !e.message.includes(secret),
        raw.slice(0, 12),
      );
    }
  });

  it("restricts a ring to some kids", () => {
    const onlyWeb = restrictKeyRing(receiver, ["web"]);
    assert.deepEqual([...onlyWeb.keys.keys()], ["web"]);
    assert.equal(restrictKeyRing(receiver, ["ops"]).signingKid, "ops");
    assert.equal(restrictKeyRing(receiver, []).signingKid, undefined);
  });
});

describe("internal auth: sign and verify", () => {
  it("a valid signature passes and names the kid", () => {
    const headers = signed();
    assert.deepEqual(Object.keys(headers).sort(), [HEADER_KID, HEADER_SIG, HEADER_TS].sort());
    assert.equal(headers[HEADER_TS], String(NOW / 1000));
    assert.deepEqual(verify(headers), { ok: true, kid: "web" });
    assert.deepEqual(verify(signed({ keys: opsSender })), { ok: true, kid: "ops" });
  });

  it("signs ts, method, path and the body hash", () => {
    assert.equal(canonicalString(1_793_563_200, "post", "/internal/emit", ""), `1793563200\nPOST\n/internal/emit\n${sha256Hex("")}`);
    assert.equal(sha256Hex(Buffer.from(BODY)), sha256Hex(BODY), "bytes and string hash the same");
  });

  it("refuses an unknown kid", () => {
    const stranger = parseKeyRing(`wk:${wk}`);
    assert.deepEqual(verify(signed({ keys: stranger })), { ok: false, reason: "unknown_kid" });
  });

  it("refuses a timestamp more than 60 s away, either way", () => {
    assert.deepEqual(verify(signed({ nowMs: NOW - 61_000 })), { ok: false, reason: "stale" });
    assert.deepEqual(verify(signed({ nowMs: NOW + 61_000 })), { ok: false, reason: "stale" });
    assert.deepEqual(verify(signed({ nowMs: NOW - 60_000 })), { ok: true, kid: "web" });
  });

  it("refuses a changed method, path or body", () => {
    const headers = signed();
    assert.deepEqual(verify(headers, { method: "PUT" }), { ok: false, reason: "bad_sig" });
    assert.deepEqual(verify(headers, { path: "/internal/broadcast" }), { ok: false, reason: "bad_sig" });
    assert.deepEqual(verify(headers, { path: "/internal/emit?x=1" }), { ok: false, reason: "bad_sig" });
    assert.deepEqual(verify(headers, { body: BODY.replace("hi", "ho") }), { ok: false, reason: "bad_sig" });
    assert.deepEqual(verify(headers, { body: `${BODY} ` }), { ok: false, reason: "bad_sig" });
  });

  it("refuses a signature from another kid's key under a claimed kid", () => {
    const headers = { ...signed({ keys: opsSender }), [HEADER_KID]: "web" };
    assert.deepEqual(verify(headers), { ok: false, reason: "bad_sig" });
  });

  it("refuses a replayed signature inside the window, and only after the signature verified", () => {
    const replay = new ReplayGuard();
    const headers = signed();
    assert.deepEqual(verify(headers, { replay }), { ok: true, kid: "web" });
    assert.deepEqual(verify(headers, { replay, nowMs: NOW + 1_000 }), { ok: false, reason: "replay" });
    const forged = { ...headers, [HEADER_SIG]: "A".repeat(43) };
    assert.deepEqual(verify(forged, { replay }), { ok: false, reason: "bad_sig" });
    assert.equal(replay.size, 1, "a forged request never fills the guard");
  });

  it("the replay guard forgets after its window", () => {
    const replay = new ReplayGuard();
    assert.equal(replay.checkAndRemember("sig-1", NOW), true);
    assert.equal(replay.checkAndRemember("sig-1", NOW + INTERNAL_REPLAY_WINDOW_MS - 1), false);
    replay.prune(NOW + INTERNAL_REPLAY_WINDOW_MS);
    assert.equal(replay.size, 0);
    assert.equal(replay.checkAndRemember("sig-1", NOW + INTERNAL_REPLAY_WINDOW_MS), true);
  });

  it("refuses missing and malformed headers", () => {
    const headers = signed();
    for (const drop of [HEADER_KID, HEADER_TS, HEADER_SIG]) {
      const h: Record<string, string> = { ...headers };
      delete h[drop];
      assert.deepEqual(verify(h), { ok: false, reason: "missing" }, drop);
    }
    assert.deepEqual(verify({ ...headers, [HEADER_TS]: "17935632e2" }), { ok: false, reason: "malformed" });
    assert.deepEqual(verify({ ...headers, [HEADER_SIG]: `${headers[HEADER_SIG]}=` }), { ok: false, reason: "malformed" });
    assert.deepEqual(verify({ ...headers, [HEADER_KID]: "WEB" }), { ok: false, reason: "malformed" });
  });

  it("reads Fetch Headers and Node header objects (arrays take the first value)", () => {
    const h = signed();
    assert.deepEqual(
      verifyInternal({ headers: new Headers(h), method: "POST", path: "/internal/emit", body: BODY, keys: receiver, nowMs: NOW }),
      { ok: true, kid: "web" },
    );
    const node = { [HEADER_KID]: [h[HEADER_KID]], [HEADER_TS]: h[HEADER_TS], [HEADER_SIG]: h[HEADER_SIG] };
    assert.deepEqual(
      verifyInternal({ headers: node, method: "POST", path: "/internal/emit", body: BODY, keys: receiver, nowMs: NOW }),
      { ok: true, kid: "web" },
    );
  });
});

describe("internal auth: per-kid allow-lists", () => {
  it("refuses entitlement:changed from kid wk and allows it from web", () => {
    assert.equal(kidMayEmit("wk", "entitlement:changed"), false);
    assert.equal(kidMayEmit("web", "entitlement:changed"), true);
  });

  it("refuses /internal/broadcast from kid web and allows it from ops", () => {
    assert.equal(kidMayCall("web", "/internal/broadcast"), false);
    assert.equal(kidMayCall("ops", "/internal/broadcast"), true);
    assert.equal(kidMayCall("ops", "/internal/drain"), true);
    assert.equal(kidMayCall("ops", "/internal/emit"), false);
    assert.equal(kidMayEmit("ops", "test:echo"), false);
  });

  it("wk may emit only its analysis-side domains", () => {
    for (const ok of ["analysis:progress", "import:finished", "weakness:ready", "bank:due_changed", "compare:ready", "review:text_ready", "games:changed", "export:ready"]) {
      assert.equal(kidMayEmit("wk", ok), true, ok);
    }
    for (const no of ["entitlement:changed", "session:revoked", "notify:new", "games:changedx", "analysisx:progress", "move:applied"]) {
      assert.equal(kidMayEmit("wk", no), false, no);
    }
  });

  it("web reaches emit, the tournament alias and metrics; ws and unknown kids reach nothing", () => {
    assert.deepEqual([...INTERNAL_POLICY.web.paths].sort(), ["/internal/emit", "/internal/metrics", "/internal/tournament-event"]);
    for (const path of INTERNAL_PATHS) {
      assert.equal(kidMayCall("ws", path), false, path);
      assert.equal(kidMayCall("evil", path), false, path);
    }
    assert.equal(kidMayEmit("evil", "test:echo"), false);
  });

  it("every policy path is a known internal path", () => {
    for (const kid of INTERNAL_KIDS) {
      for (const path of INTERNAL_POLICY[kid].paths) assert.ok((INTERNAL_PATHS as readonly string[]).includes(path), `${kid} ${path}`);
    }
  });
});
