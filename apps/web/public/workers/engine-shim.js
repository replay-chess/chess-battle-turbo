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
 * right before "uciok", and while the engine files download
 *   { rc: "engine-progress", stage: "glue" | "wasm", state: "start" | "waiting" | "progress" | "done" | "failed",
 *     loaded?, total? }
 * (a heartbeat every 2 s while the WASM request is in flight, byte counts as its body streams in), so the page tells a
 * slow download from an engine that failed: uci.ts does not count download time against its init timeout. Every other
 * message is a UCI line string from the engine.
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

  var realPost = self.postMessage.bind(self);
  var HEARTBEAT_MS = 2000;
  var PROGRESS_EVERY_MS = 250;
  function progress(stage, state, loaded, total) {
    var m = { rc: "engine-progress", stage: stage, state: state };
    if (typeof loaded === "number") m.loaded = loaded;
    if (typeof total === "number") m.total = total;
    realPost(m);
  }

  /** Reports the WASM download: a heartbeat while the request waits, the bytes as the body streams in, the end. */
  function track(pending) {
    progress("wasm", "start");
    var beat = setInterval(function () {
      progress("wasm", "waiting");
    }, HEARTBEAT_MS);
    var stopped = false;
    function stop(state, loaded, total) {
      if (stopped) return;
      stopped = true;
      clearInterval(beat);
      progress("wasm", state, loaded, total);
    }
    return pending.then(
      function (res) {
        if (!res.ok || !res.body || typeof ReadableStream === "undefined") {
          stop(res.ok ? "done" : "failed");
          return res;
        }
        var total = Number(res.headers.get("content-length")) || 0;
        var loaded = 0;
        var last = 0;
        var reader = res.body.getReader();
        var body = new ReadableStream({
          pull: function (controller) {
            return reader.read().then(
              function (r) {
                if (r.done) {
                  stop("done", loaded, total);
                  controller.close();
                  return;
                }
                loaded += r.value.byteLength;
                var now = Date.now();
                if (now - last >= PROGRESS_EVERY_MS) {
                  last = now;
                  progress("wasm", "progress", loaded, total);
                }
                controller.enqueue(r.value);
              },
              function (err) {
                stop("failed", loaded, total);
                controller.error(err);
              },
            );
          },
          cancel: function (reason) {
            stop("failed", loaded, total);
            return reader.cancel(reason);
          },
        });
        // Same status and headers (Content-Type: application/wasm for instantiateStreaming), the counted body.
        return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
      },
      function (err) {
        stop("failed");
        throw err;
      },
    );
  }

  var realFetch = self.fetch.bind(self);
  self.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
    if (url.indexOf(WASM) === -1) return realFetch(input, init);
    if (!remote || url.indexOf(remote) !== 0) return track(realFetch(input, init));
    if (glueFellBack) return track(realFetch(originWasm, init));
    return track(
      realFetch(input, init)
        .then(function (res) {
          if (!res.ok) throw new Error("engine-shim: R2 wasm " + res.status);
          return res;
        })
        .catch(function () {
          source = "origin";
          return realFetch(originWasm, init);
        }),
    );
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

  self.postMessage = function (message) {
    if (!reported && message === "uciok") {
      reported = true;
      realPost(report());
    }
    return realPost.apply(self, arguments);
  };

  // importScripts blocks this worker while the glue downloads: say so first, so the page waits for the download.
  progress("glue", "start");
  try {
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
  } catch (err) {
    progress("glue", "failed");
    throw err;
  }
  progress("glue", "done");
  glueMs = Math.round((self.performance && self.performance.now ? self.performance.now() : 0) - t0);
})();
