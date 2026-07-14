import { logger } from "./utils/logger";

/**
 * Watches the EC2 instance metadata service (IMDSv2) for a Spot interruption notice.
 * When AWS schedules the instance for reclaim it exposes a 2-minute warning at
 * /latest/meta-data/spot/instance-action. On that signal we run onInterrupt() once
 * (to flush in-memory game state to the DB and tell clients to reconnect) and then
 * raise SIGTERM to reuse the existing graceful-shutdown path.
 *
 * No-ops safely when not running on EC2 Spot (IMDS unreachable / token request fails),
 * so it's harmless on x86, in Docker, or locally.
 */

const IMDS = "http://169.254.169.254";
const POLL_MS = 5000;

async function imdsToken(): Promise<string | null> {
  try {
    const res = await fetch(`${IMDS}/latest/api/token`, {
      method: "PUT",
      headers: { "X-aws-ec2-metadata-token-ttl-seconds": "60" },
      signal: AbortSignal.timeout(2000),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null; // not on EC2 / IMDS unreachable
  }
}

async function isInterrupting(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${IMDS}/latest/meta-data/spot/instance-action`, {
      headers: { "X-aws-ec2-metadata-token": token },
      signal: AbortSignal.timeout(2000),
    });
    return res.status === 200; // 200 = action scheduled; 404 = normal
  } catch {
    return false;
  }
}

export function watchForSpotInterruption(
  onInterrupt: () => Promise<void>
): void {
  let triggered = false;
  const timer = setInterval(async () => {
    if (triggered) return;
    const token = await imdsToken();
    if (!token) return;
    if (await isInterrupting(token)) {
      triggered = true;
      clearInterval(timer);
      logger.warn(
        "Spot interruption notice received — flushing state, then shutting down"
      );
      try {
        await onInterrupt();
      } catch (error) {
        logger.error("Error during spot-interruption flush", error);
      } finally {
        process.kill(process.pid, "SIGTERM");
      }
    }
  }, POLL_MS);
  // Don't keep the event loop alive solely for this poller
  timer.unref?.();
}
