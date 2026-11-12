// socket.io frames a page receives (plan §12.3: "the first progress event has from = 10", "B's socket receives no
// analysis:* for A's game"). Engine.IO v4 text frames: "42[event, payload]" (optionally "42/<nsp>,[…]").
import type { Page } from "@playwright/test";

export type SocketEvent = { event: string; payload: unknown; at: number };

export function parseSocketIoFrame(frame: string): SocketEvent | null {
  const m = /^42(?:\/[^,]*,)?(?:\d+)?(\[.*\])$/s.exec(frame);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[1]!) as unknown[];
    if (!Array.isArray(arr) || typeof arr[0] !== "string") return null;
    return { event: arr[0], payload: arr[1], at: Date.now() };
  } catch {
    return null;
  }
}

/** Records every socket.io event the page receives from now on (all sockets, reconnects included). */
export function recordSocketEvents(page: Page): SocketEvent[] {
  const events: SocketEvent[] = [];
  page.on("websocket", (ws) => {
    ws.on("framereceived", (f) => {
      if (typeof f.payload !== "string") return;
      const e = parseSocketIoFrame(f.payload);
      if (e) events.push(e);
    });
  });
  return events;
}
