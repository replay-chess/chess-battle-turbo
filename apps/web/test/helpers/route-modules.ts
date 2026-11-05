// Finds app/api/**/route.ts files and the route() handlers they export (contract tests, authz walker).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { RouteHandler } from "@/lib/api/route";

export const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const API_DIR = path.join(WEB, "app", "api");

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethodName = (typeof HTTP_METHODS)[number];

export type RouteFile = {
  /** Relative to apps/web, posix separators. */
  file: string;
  /** URL path with Next segments: /api/chess/game-by-ref/[gameReferenceId]. */
  urlPath: string;
  /** Exported HTTP methods found in the source. */
  methods: HttpMethodName[];
  /** True when the file wraps its handlers with route() from lib/api/route. */
  usesRoute: boolean;
};

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name === "route.ts" || entry.name === "route.tsx") out.push(full);
  }
  return out;
}

export function listRouteFiles(): RouteFile[] {
  return walk(API_DIR, [])
    .sort()
    .map((full) => {
      const source = readFileSync(full, "utf8");
      const rel = path.relative(WEB, full).split(path.sep).join("/");
      const dir = path.posix.dirname(rel).replace(/^app/, "");
      const urlPath = dir
        .split("/")
        .filter((seg) => !/^\(.*\)$/.test(seg))
        .join("/");
      const methods = HTTP_METHODS.filter((m) =>
        new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b|export\\s+const\\s+${m}\\b|export\\s*\\{[^}]*\\b${m}\\b`).test(source),
      );
      const usesRoute = /from\s+["']@\/lib\/api\/route["']/.test(source) && /\broute\s*\(/.test(source);
      return { file: rel, urlPath, methods, usesRoute };
    });
}

/** `/api/x/[ref]` → `/api/x/{ref}` (the registry's spelling). */
export function toRegistryPath(urlPath: string): string {
  return urlPath.replace(/\[\.{0,3}([^\]]+)\]/g, "{$1}");
}

/** Imports a route file and returns its route() handlers by method. */
export async function loadRouteHandlers(file: RouteFile): Promise<Partial<Record<HttpMethodName, RouteHandler>>> {
  const mod = (await import(pathToFileURL(path.join(WEB, file.file)).href)) as Record<string, unknown>;
  const handlers: Partial<Record<HttpMethodName, RouteHandler>> = {};
  for (const method of HTTP_METHODS) {
    const h = mod[method] as RouteHandler | undefined;
    if (typeof h === "function" && h.spec) handlers[method] = h;
  }
  return handlers;
}
