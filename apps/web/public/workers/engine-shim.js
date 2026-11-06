/*
 * Replay Chess engine shim (phase-02 plan 0.2, 13.1 WP-H). A same-origin classic worker that loads the
 * Stockfish.js 18 lite build (GPL-3.0; see COPYING and SOURCE.txt next to the engine files) from
 *   r = the R2 folder (NEXT_PUBLIC_ENGINE_BASE_URL), when given, else
 *   o = the hashed same-origin folder /workers/sf18-<hash>/.
 * `new Worker()` needs a same-origin script, so this file stays on the origin and pulls the engine with
 * importScripts(). The Stockfish.js glue reads the WASM URL from this worker's location.hash (set by the page).
 *
 * Fallback: a failed R2 glue load re-imports the glue from the origin folder, and a failed R2 WASM fetch is
 * retried from the origin folder (fetch is wrapped before the glue runs). The page receives one object message
 *   { rc: "engine-init", source: "r2" | "origin", cached, bytes, glueMs }
 * right before "uciok"; every other message is a UCI line string from the engine.
 */
(function () {
  "use strict";
  var GLUE = "stockfish-18-lite-single.js";
  var WASM = "stockfish-18-lite-single.wasm";
  var params = new URLSearchParams(self.location.search);
  var origin = params.get("o") || "";
  var remote = params.get("r") || "";
  if (!/^\/workers\/sf18-[0-9a-f]{6,64}\/$/.test(origin)) throw new Error("engine-shim: bad origin folder");
  if (remote && !/^https:\/\/[^\s?#]+\/$/.test(remote)) remote = "";

  var source = remote ? "r2" : "origin";
  var glueFellBack = false;
  var originWasm = origin + WASM;

  var realFetch = self.fetch.bind(self);
  self.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
    if (url.indexOf(WASM) === -1 || !remote || url.indexOf(remote) !== 0) return realFetch(input, init);
    if (glueFellBack) return realFetch(originWasm, init);
    return realFetch(input, init)
      .then(function (res) {
        if (!res.ok) throw new Error("engine-shim: R2 wasm " + res.status);
        return res;
      })
      .catch(function () {
        source = "origin";
        return realFetch(originWasm, init);
      });
  };

  var reported = false;
  var t0 = self.performance && self.performance.now ? self.performance.now() : 0;
  var glueMs = 0;
  function report() {
    var cached = false;
    var bytes = 0;
    try {
      var entries = self.performance.getEntriesByType("resource");
      for (var i = entries.length - 1; i >= 0; i--) {
        var e = entries[i];
        if (e.name.indexOf(WASM) !== -1) {
          cached = e.transferSize === 0 && e.decodedBodySize > 0;
          bytes = e.encodedBodySize || 0;
          break;
        }
      }
    } catch (err) {
      /* resource timing unavailable */
    }
    return { rc: "engine-init", source: source, cached: cached, bytes: bytes, glueMs: glueMs };
  }

  var realPost = self.postMessage.bind(self);
  self.postMessage = function (message) {
    if (!reported && message === "uciok") {
      reported = true;
      realPost(report());
    }
    return realPost.apply(self, arguments);
  };

  if (remote) {
    try {
      importScripts(remote + GLUE);
    } catch (err) {
      source = "origin";
      glueFellBack = true;
      importScripts(origin + GLUE);
    }
  } else {
    importScripts(origin + GLUE);
  }
  glueMs = Math.round((self.performance && self.performance.now ? self.performance.now() : 0) - t0);
})();
