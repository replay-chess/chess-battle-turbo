// Builds docs/api/openapi.json (OpenAPI 3.1) from the endpoint registry with zod 4's built-in z.toJSONSchema.
//   pnpm --filter @repo/contracts openapi          (writes ../../docs/api/openapi.json through stdout)
// The output is deterministic: object keys are sorted, nothing depends on time or machine. CI regenerates it and fails
// on a diff (plan §13.4). Only the document goes to stdout.
import { pathToFileURL } from "node:url";
import { z } from "zod";

import * as accounts from "../src/http/accounts";
import * as billing from "../src/http/billing";
import { ALLOWED_STATUSES, ERROR_STATUS, type ErrorCode } from "../src/http/codes";
import * as common from "../src/http/common";
import {
  cacheTierOf,
  expectedErrorCodes,
  pathParamNames,
  rateLimitsOf,
  successStatusOf,
  type AuthMode,
  type EndpointDef,
} from "../src/http/endpoint";
import * as envelope from "../src/http/envelope";
import { ErrorEnvelope, ok } from "../src/http/envelope";
import * as games from "../src/http/games";
import * as importStatus from "../src/http/import";
import * as legend from "../src/http/legend";
import * as me from "../src/http/me";
import * as onboarding from "../src/http/onboarding";
import * as openings from "../src/http/openings";
import * as practice from "../src/http/practice";
import { areaOf, HTTP_ENDPOINTS } from "../src/http/registry/index";
import * as review from "../src/http/review";
import * as share from "../src/http/share";
import * as socketToken from "../src/http/socket-token";
import * as system from "../src/http/system";
import * as webhooks from "../src/http/webhooks";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

/** Modules whose named object and enum schemas become components/schemas. A new src/http/<area>.ts is added here. */
const SCHEMA_MODULES: Record<string, Record<string, unknown>> = {
  accounts,
  billing,
  common,
  envelope,
  games,
  importStatus,
  legend,
  me,
  onboarding,
  openings,
  practice,
  review,
  share,
  socketToken,
  system,
  webhooks,
};

const COMPONENT_URI = (id: string) => `#/components/schemas/${id}`;
const OP_PREFIX = "__op__";

const SECURITY: Record<AuthMode, JsonObject[]> = {
  public: [],
  optional: [{}, { clerkSession: [] }],
  user: [{ clerkSession: [] }],
  member: [{ clerkSession: [] }],
  owner: [{ clerkSession: [] }],
  admin: [{ clerkSession: [] }],
  internal: [{ internalToken: [] }],
  cron: [{ cronBearer: [] }],
  webhook: [{ webhookSignature: [] }],
};

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  302: "Found",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  410: "Gone",
  412: "Precondition Failed",
  413: "Payload Too Large",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

function isNamedSchema(name: string, value: unknown): value is z.ZodType {
  if (!/^[A-Z]/.test(name) || !(value instanceof z.ZodType)) return false;
  return value instanceof z.ZodObject || value instanceof z.ZodEnum;
}

function sortKeys(value: unknown): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value as Json;
}

function stripMeta(schema: JsonObject): JsonObject {
  const rest = { ...schema };
  delete rest.$schema;
  delete rest.$id;
  return rest;
}

/** Inline JSON Schema for a request part (input side: what the client sends, before coercion and defaults). */
function inputSchema(schema: z.ZodType): JsonObject {
  return stripMeta(z.toJSONSchema(schema, { io: "input", unrepresentable: "any", target: "draft-2020-12" }) as JsonObject);
}

function successEnvelope(def: EndpointDef): z.ZodType | null {
  const status = successStatusOf(def);
  if (status === 204 || status === 302) return null;
  const format = def.responseFormat ?? "envelope";
  if (format === "text") return def.response ?? z.string();
  if (format === "legacy") return def.response ?? z.unknown();
  return ok(def.response ?? z.null());
}

function opSchemaId(def: EndpointDef): string {
  return `${OP_PREFIX}${def.id}`;
}

/** Turns `{ a: z.string(), b: … }` object schemas into OpenAPI parameter objects. */
function parametersFor(def: EndpointDef): JsonObject[] {
  const params: JsonObject[] = [];
  const add = (where: "path" | "query", schema: z.ZodType | undefined) => {
    if (!schema) return;
    const json = inputSchema(schema);
    const props = (json.properties ?? {}) as Record<string, JsonObject>;
    const required = new Set((json.required ?? []) as string[]);
    for (const name of Object.keys(props)) {
      params.push({ name, in: where, required: where === "path" || required.has(name), schema: props[name] as Json });
    }
  };
  add("path", def.params);
  add("query", def.query);
  for (const name of pathParamNames(def.path)) {
    if (!params.some((p) => p.in === "path" && p.name === name)) {
      params.push({ name, in: "path", required: true, schema: { type: "string" } });
    }
  }
  return params;
}

function errorResponses(def: EndpointDef): Record<string, JsonObject> {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of expectedErrorCodes(def)) {
    const status = ERROR_STATUS[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  const out: Record<string, JsonObject> = {};
  for (const [status, codes] of byStatus) {
    out[String(status)] = {
      description: `${STATUS_TEXT[status] ?? "Error"}: ${codes.map((c) => `\`${c}\``).join(", ")}`,
      headers: {
        "x-request-id": { $ref: "#/components/headers/RequestId" },
        ...(status === 429 ? { "Retry-After": { $ref: "#/components/headers/RetryAfter" } } : {}),
      },
      content: { "application/json": { schema: { $ref: COMPONENT_URI("ErrorEnvelope") } } },
    };
  }
  return out;
}

function operationFor(def: EndpointDef, schemas: Record<string, JsonObject>): JsonObject {
  const status = successStatusOf(def);
  const tier = cacheTierOf(def);
  const success: JsonObject = {
    description: STATUS_TEXT[status] ?? "Success",
    headers:
      status === 302
        ? { "x-request-id": { $ref: "#/components/headers/RequestId" }, Location: { schema: { type: "string" } } }
        : { "x-request-id": { $ref: "#/components/headers/RequestId" } },
  };
  const opSchema = schemas[opSchemaId(def)];
  if (status !== 204 && opSchema) {
    const contentType =
      (def.responseFormat ?? "envelope") === "text" ? "text/plain" : tier === "sse" ? "text/event-stream" : "application/json";
    success.content = { [contentType]: { schema: opSchema } };
  }
  const responses: Record<string, JsonObject> = { [String(status)]: success, ...errorResponses(def) };
  if (tier === "private-etag" || tier === "public-static" || tier === "public-immutable") {
    responses["304"] = { description: "Not Modified (If-None-Match matched the ETag)" };
  }

  const op: JsonObject = {
    operationId: def.id,
    tags: [areaOf(def.id) ?? "other"],
    security: SECURITY[def.auth],
    responses: responses as Json,
    "x-auth": def.auth,
    "x-cache": tier,
  };
  if (def.summary) op.summary = def.summary;
  if (def.deprecated) op.deprecated = true;
  if (def.class) op["x-class"] = def.class;
  const limits = rateLimitsOf(def);
  if (limits.length) op["x-rate-limit"] = limits.map((l) => ({ ...l, store: l.store ?? "burst" }));
  if (def.sideEffects?.length) op["x-side-effects"] = def.sideEffects;
  if (def.publicStatic) op["x-public-static"] = def.publicStatic;
  if (def.publicShort) op["x-public-short"] = def.publicShort;
  if (def.versionParam) op["x-version-param"] = def.versionParam;
  if (def.maxBodyBytes) op["x-max-body-bytes"] = def.maxBodyBytes;
  const parameters = parametersFor(def);
  if (parameters.length) op.parameters = parameters;
  if (def.body) {
    op.requestBody = { required: true, content: { "application/json": { schema: inputSchema(def.body) } } };
  }
  return op;
}

/** Builds the whole document as a plain object (sorted keys). */
export function buildOpenApiDocument(): JsonObject {
  // One registry: named schemas become components; each operation's success body is registered under a
  // temporary id so that it can $ref the named components, then it is inlined into its operation.
  const registry = z.registry<{ id: string }>();
  const componentNames: string[] = [];
  for (const mod of Object.values(SCHEMA_MODULES)) {
    for (const [name, value] of Object.entries(mod)) {
      if (!isNamedSchema(name, value) || registry.has(value)) continue;
      if (componentNames.includes(name)) throw new Error(`openapi: two schemas are exported as "${name}"`);
      registry.add(value, { id: name });
      componentNames.push(name);
    }
  }
  if (!registry.has(ErrorEnvelope)) throw new Error("openapi: ErrorEnvelope must be a component");
  for (const def of HTTP_ENDPOINTS) {
    const body = successEnvelope(def);
    if (body && !registry.has(body)) registry.add(body, { id: opSchemaId(def) });
  }

  // io "input": the wire shape the server's response check parses. Objects stay open (no additionalProperties: false)
  // because adding response fields is an allowed, additive change (API §2.3).
  const generated = z.toJSONSchema(registry, {
    io: "input",
    uri: COMPONENT_URI,
    unrepresentable: "any",
    target: "draft-2020-12",
  }) as { schemas: Record<string, JsonObject> };

  const all: Record<string, JsonObject> = {};
  for (const [id, schema] of Object.entries(generated.schemas)) all[id] = stripMeta(schema);

  // An op body that is itself a named component (legacy formats) is referenced, not inlined.
  const opSchemas: Record<string, JsonObject> = {};
  for (const def of HTTP_ENDPOINTS) {
    const body = successEnvelope(def);
    if (!body) continue;
    const named = registry.get(body)?.id;
    opSchemas[opSchemaId(def)] =
      named && !named.startsWith(OP_PREFIX) ? { $ref: COMPONENT_URI(named) } : (all[opSchemaId(def)] as JsonObject);
  }
  const components: Record<string, JsonObject> = {};
  for (const name of componentNames) components[name] = all[name] as JsonObject;

  const paths: Record<string, JsonObject> = {};
  for (const def of HTTP_ENDPOINTS) {
    const item = (paths[def.path] ??= {});
    const method = def.method.toLowerCase();
    if (item[method]) throw new Error(`openapi: ${def.method} ${def.path} is declared twice`);
    item[method] = operationFor(def, opSchemas);
  }

  const doc = {
    openapi: "3.1.0",
    info: {
      title: "Replay Chess HTTP API",
      version: "1.0.0",
      description:
        "Generated from @repo/contracts (packages/contracts/src/http/registry) by scripts/openapi.ts. Do not edit by hand. " +
        "Success bodies are { data, meta? } unless an operation says otherwise; every 4xx/5xx is ErrorEnvelope with " +
        "Cache-Control: private, no-store.",
    },
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    servers: [{ url: "/" }],
    tags: Array.from(new Set(HTTP_ENDPOINTS.map((d) => areaOf(d.id) ?? "other"))).map((name) => ({ name })),
    paths,
    components: {
      schemas: components,
      headers: {
        RequestId: { description: "Request id; equals error.requestId and the Sentry tag.", schema: { type: "string" } },
        RetryAfter: { description: "Seconds until the limiter admits the request.", schema: { type: "integer", minimum: 1 } },
      },
      securitySchemes: {
        clerkSession: { type: "apiKey", in: "cookie", name: "__session", description: "Clerk session (cookie or Authorization bearer)." },
        internalToken: { type: "apiKey", in: "header", name: "x-internal-token", description: "Shared secret for internal routes." },
        cronBearer: { type: "http", scheme: "bearer", description: "Authorization: Bearer CRON_SECRET (Vercel cron)." },
        webhookSignature: {
          type: "apiKey",
          in: "header",
          name: "webhook-signature",
          description: "Provider signature over the raw body (Standard Webhooks for Dodo, svix-signature for Clerk).",
        },
      },
    },
    "x-error-codes": Object.fromEntries(Object.entries(ERROR_STATUS)),
    "x-allowed-statuses": [...ALLOWED_STATUSES],
  };

  const sorted = sortKeys(doc) as JsonObject;
  const text = JSON.stringify(sorted);
  if (text.includes('"#/$defs/')) throw new Error("openapi: a schema kept a local $defs reference; register it as a component");
  if (text.includes(OP_PREFIX)) throw new Error("openapi: an operation schema leaked into the document");
  return sorted;
}

/** The exact file contents of docs/api/openapi.json. */
export function renderOpenApi(): string {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) process.stdout.write(renderOpenApi());
