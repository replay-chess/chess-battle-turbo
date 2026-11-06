// POST /internal/emit (phase-02 plan 7.5, B20 fan-out; api-perf AP-10). Body (strict; `{room}` or `rooms[]` → 400):
//   { v: 1, targets: ({ room } | { userRef })[] ≤ 50, event, data, dedupeKey? }  →  202 { delivered }
// Order: HMAC (allow.ts) → strict body (400) → event in the emit registry (422 unknown_event) → event in the
// kid's allow-list (403) → dedupeKey seen in the last 60 s (202, no second delivery) → targets whose room has no
// socket are dropped BEFORE `data` is parsed, and when every target is empty the answer is 202 {delivered: 0} with
// no parse at all → `data` parsed against the event schema (422 invalid_data) → delivery. User-room deliveries go
// through `UserRooms.emitToUser`, which stamps the user's next `useq`.
import type { Express } from "express";
import type { Server } from "socket.io";
import { ROOM, parseRoom, type RoomKind } from "@repo/contracts/socket/rooms";
import { EmitBody, type EmitResponse } from "@repo/contracts/socket/internal";
import { EMIT_EVENTS, emitEventFor } from "@repo/contracts/socket/registry";
import { EMIT_DEDUPE_TTL_MS } from "@repo/contracts/socket/limits";
import type { Metrics } from "../ports";
import { roomSize, type UserRooms } from "../server/rooms";
import { internalRoute, jsonOf, kidMayEmit, sendError, type InternalAuthDeps } from "./allow";

export interface EmitDeps extends InternalAuthDeps {
  io: Server;
  userRooms: UserRooms;
  appEnv: string;
  metrics: Metrics;
  /** Test spy: called right before `data` is parsed. */
  onParse?(event: string): void;
}

/** dedupeKey → expiry (insertion order = expiry order). */
class DedupeSet {
  private readonly seen = new Map<string, number>();
  constructor(private readonly ttlMs: number) {}
  has(key: string, now: number): boolean {
    this.prune(now);
    return this.seen.has(key);
  }
  add(key: string, now: number): void {
    this.seen.set(key, now + this.ttlMs);
  }
  private prune(now: number): void {
    for (const [key, exp] of this.seen) {
      if (exp > now) break;
      this.seen.delete(key);
    }
  }
}

export function mountEmit(app: Express, deps: EmitDeps): void {
  const dedupe = new DedupeSet(EMIT_DEDUPE_TTL_MS);
  app.post(
    "/internal/emit",
    ...internalRoute(deps, "/internal/emit", (_req, res, { kid, raw }) => {
      const parsed = EmitBody.safeParse(jsonOf(raw));
      if (!parsed.success) return sendError(res, 400, "validation_failed");
      const body = parsed.data;
      const known = emitEventFor(body.event, deps.appEnv);
      if (!known.ok) return sendError(res, 422, "unknown_event");
      if (!kidMayEmit(kid, body.event)) {
        deps.metrics.count("ws.internal.auth_fail", { reason: "event" });
        return sendError(res, 403, "forbidden");
      }
      const now = deps.now();
      const key = body.dedupeKey ? `${kid}:${body.dedupeKey}` : null;
      if (key && dedupe.has(key, now)) {
        res.status(202).json({ delivered: 0, deduped: true } satisfies EmitResponse);
        return;
      }
      const allowedKinds = EMIT_EVENTS[known.name].to as readonly string[];
      const rooms: { kind: RoomKind; id: string; name: string }[] = [];
      for (const target of body.targets) {
        const name = "userRef" in target ? ROOM.user(target.userRef) : target.room;
        const room = parseRoom(name);
        if (!room || !allowedKinds.includes(room.kind)) return sendError(res, 400, "validation_failed");
        rooms.push({ ...room, name });
      }
      // AP-10: drop rooms nobody is in before any parse work.
      const live = rooms.filter((r) => roomSize(deps.io, r.name) > 0);
      if (live.length === 0) {
        deps.metrics.count("ws.emit", { event: body.event, result: "empty" });
        if (key) dedupe.add(key, now);
        res.status(202).json({ delivered: 0 } satisfies EmitResponse);
        return;
      }
      deps.onParse?.(body.event);
      const data = known.schema.safeParse(body.data);
      if (!data.success) return sendError(res, 422, "invalid_data");
      const payload = data.data as Record<string, unknown>;
      for (const r of live) {
        if (r.kind === "user") deps.userRooms.emitToUser(r.id, body.event, payload);
        else deps.io.to(r.name).emit(body.event, payload);
      }
      if (key) dedupe.add(key, now);
      deps.metrics.count("ws.emit", { event: body.event, result: "delivered" }, live.length);
      res.status(202).json({ delivered: live.length } satisfies EmitResponse);
    }),
  );
}
