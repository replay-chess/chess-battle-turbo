// The game telemetry module (./telemetry.ts) in its own chunk: the /game route is at its 600 kB first-load budget
// (plan 9.1), and nothing about telemetry needs to be there before hydration. Calls made before the chunk arrives
// are queued in order (with their timestamps taken at call time) and run once it loads. Server renders send nothing.

type Telemetry = typeof import("./telemetry");

let mod: Telemetry | null = null;
let loading = false;
const queue: ((m: Telemetry) => void)[] = [];

function load(): void {
  if (loading) return;
  loading = true;
  import("./telemetry").then(
    (m) => {
      mod = m;
      for (const fn of queue.splice(0)) fn(m);
    },
    () => {
      queue.length = 0; // telemetry never breaks the game
    },
  );
}

export function withTelemetry(fn: (m: Telemetry) => void): void {
  if (typeof window === "undefined") return;
  if (mod) {
    fn(mod);
    return;
  }
  queue.push(fn);
  load();
}
