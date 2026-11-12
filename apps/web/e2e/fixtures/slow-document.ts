// A reverse proxy in front of the e2e web server that can hold back the streamed part of an HTML document.
//
// Next streams a page in flushes: the shell (layouts, the route's loading.tsx fallback) first, then each Suspense
// segment (`<div hidden id="S:n">` + the `$RC` reveal script) and the RSC payload chunks as the server finishes them.
// With `hold(ms)` on, a matching document passes through up to the first streamed segment (`<div hidden id="S:`), and
// everything from there on is buffered for `ms`, even when the server sent the whole page in one flush (a warm server
// often does: React outlines large boundaries as segments anyway). The browser has the shell and its scripts,
// hydrates, and loads Clerk and the stores while the page's own segments are still in flight.
//
// `reset(match)` makes the proxy drop the connection of matching requests without an answer: a network error in the
// middle of a load, as a flaky mobile network gives (offline emulation fails requests before a service worker sees
// them; this reaches the worker's own fetch). It
// is the slow-server case (a busy CI runner, a cold database) on demand, without any hook in the app.
//
// Everything else (assets, /api, RSC requests, other documents) passes through untouched, except that the proxy
// stands in for the app's origin: Host and Origin are rewritten to the app's, and a redirect back to the app's origin
// is rewritten to the proxy's (the middleware's same-site check and Clerk's redirects hold). Cookies ignore the port,
// so a context signed in on the proxy origin is signed in on the app too. localStorage does not: a spec that uses the
// proxy runs the whole flow on the proxy origin (seat `contextOptions.baseURL`).
import http from "node:http";
import type { AddressInfo } from "node:net";

export type SlowDocumentProxy = {
  /** http://localhost:<port> */
  url: string;
  /** Buffers the flushes after the first one of the next matching documents for `ms` (0 = pass through). */
  hold(ms: number): void;
  /** Documents whose flushes were held, newest last (pathname, flushes held, bytes held). */
  held(): readonly { path: string; chunks: number; bytes: number }[];
  /** Drops the connection of every request whose pathname matches (null: none). */
  reset(match: ((pathname: string) => boolean) | null): void;
  /** Pathnames whose connection was dropped. */
  resets(): readonly string[];
  close(): Promise<void>;
};

export async function startSlowDocumentProxy(opts: {
  target: number;
  /** Which documents may be held (pathname). */
  match: (pathname: string) => boolean;
}): Promise<SlowDocumentProxy> {
  let holdMs = 0;
  /** The proxy's own origin, known once it listens. */
  let self = "";
  const log: { path: string; chunks: number; bytes: number }[] = [];

  let resetMatch: ((pathname: string) => boolean) | null = null;
  const resetLog: string[] = [];
  const SEGMENT = Buffer.from('<div hidden id="S:');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (resetMatch?.(url.pathname)) {
      resetLog.push(url.pathname);
      req.socket.destroy();
      return;
    }
    const isDocument =
      req.method === "GET" &&
      /text\/html/.test(req.headers.accept ?? "") &&
      !req.headers.rsc &&
      !req.headers["next-router-state-tree"];
    const holding = isDocument && holdMs > 0 && opts.match(url.pathname) ? holdMs : 0;
    const appOrigin = `http://localhost:${opts.target}`;
    const headers: http.OutgoingHttpHeaders = { ...req.headers, host: `localhost:${opts.target}` };
    if (headers.origin === self) headers.origin = appOrigin;
    if (typeof headers.referer === "string" && headers.referer.startsWith(`${self}/`)) headers.referer = appOrigin + headers.referer.slice(self.length);
    // Uncompressed upstream, so one upstream chunk is one server flush.
    if (holding) headers["accept-encoding"] = "identity";
    const up = http.request(
      { host: "127.0.0.1", port: opts.target, method: req.method, path: req.url, headers },
      (upRes) => {
        const outHeaders = { ...upRes.headers };
        if (typeof outHeaders.location === "string" && outHeaders.location.startsWith(appOrigin)) {
          outHeaders.location = self + outHeaders.location.slice(appOrigin.length);
        }
        res.writeHead(upRes.statusCode ?? 502, upRes.statusMessage, outHeaders);
        if (!holding) {
          upRes.pipe(res);
          return;
        }
        const entry = { path: url.pathname, chunks: 0, bytes: 0 };
        log.push(entry);
        const buffered: Buffer[] = [];
        let shellDone = false;
        let released = false;
        let ended = false;
        const release = () => {
          released = true;
          for (const c of buffered.splice(0)) res.write(c);
          if (ended) res.end();
        };
        const hold = (chunk: Buffer) => {
          buffered.push(chunk);
          entry.chunks++;
          entry.bytes += chunk.length;
        };
        upRes.on("data", (chunk: Buffer) => {
          if (!shellDone) {
            const at = chunk.indexOf(SEGMENT);
            if (at < 0) {
              res.write(chunk);
              return;
            }
            shellDone = true;
            if (at > 0) res.write(chunk.subarray(0, at));
            hold(chunk.subarray(at));
            setTimeout(release, holding);
            return;
          }
          if (released) res.write(chunk);
          else hold(chunk);
        });
        upRes.on("end", () => {
          ended = true;
          if (released || !shellDone) res.end();
        });
        upRes.on("error", () => res.destroy());
      },
    );
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });
  // No WebSocket upgrades through the proxy (bot games open no socket).
  server.on("upgrade", (_req, socket) => socket.destroy());

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  self = `http://localhost:${port}`;
  return {
    url: self,
    hold(ms) {
      holdMs = ms;
    },
    held: () => log,
    reset(match) {
      resetMatch = match;
    },
    resets: () => resetLog,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
