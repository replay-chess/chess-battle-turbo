// Client view of the socket server's clock (P2 plan 5.2.7): `clock:ping {c}` every 10 s, ack `{c, s}`;
// rtt = now − c, offset = s + rtt/2 − now, smoothed with an EWMA (α 0.2). `now()` = Date.now() + offset.
// A join/sync ack seeds it from `state.serverNow` before the first ping answers.

import { RTT_ALPHA } from "@repo/game-core/constants";

export class ServerClock {
  private offset = 0;
  private samples = 0;

  now = (): number => Date.now() + this.offset;

  /** A `clock:ping` round trip: `c` = client send time, `s` = server time, `recv` = client receive time. */
  sample(c: number, s: number, recv: number = Date.now()): void {
    const rtt = Math.max(0, recv - c);
    this.push(s + rtt / 2 - recv);
  }

  /** A snapshot from the server (join/sync ack); `sentAt` is when the request left (half the trip is assumed). */
  seed(serverNow: number, sentAt: number, recv: number = Date.now()): void {
    if (this.samples > 0) return; // pings are more precise than snapshot stamps
    const rtt = Math.max(0, recv - sentAt);
    this.offset = serverNow + rtt / 2 - recv;
  }

  getOffset(): number {
    return this.offset;
  }

  private push(sample: number): void {
    this.offset = this.samples === 0 ? sample : this.offset + RTT_ALPHA * (sample - this.offset);
    this.samples += 1;
  }
}
