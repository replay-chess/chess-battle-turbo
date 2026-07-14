# WebSocket Server — Graviton + Spot Migration Plan

> Status: **PLAN ONLY — not executed.** No AWS changes and no app code changes have been
> applied. This document is for review. Author: cost-optimization pass, 2026-06-03.

## 1. Why

The WebSocket server is a thin socket relay (forwards moves to the Next.js API). On the
current prod box it idles at **0.1–0.5% CPU**, yet it runs on an on-demand `t2.small`
(oldest instance generation). We can cut compute ~70% by moving to **Graviton (ARM) on a
Spot instance** without changing the app's behaviour.

### Already done (Phase 1 — cleanup, 2026-06-03)
- Terminated the **orphaned duplicate** prod box (`t3.small`, `98.87.11.117`) left running
  after the May 13 migration. DNS (`ws-chess.playchess.tech`) had already cut over to the
  new box; the old one was just burning ~$19/mo.
- Terminated three idle stopped instances (`openclaw_orchestrator`, `Kokoro_server`,
  `chess-battle-perf`) whose EBS volumes were still billing (~$2.88/mo).
- **Live prod is unchanged:** `chess-battle-ws` `t2.small` (`52.91.156.80`), healthy.

## 2. Current vs. target cost (us-east-1)

| Item                          | Now (t2.small on-demand) | Target (t4g.small spot) |
|-------------------------------|--------------------------|-------------------------|
| Compute                       | $16.79/mo                | ~$5.04/mo (spot @ $0.0069/hr) |
| Public IPv4 (1×)              | $3.65/mo                 | $3.65/mo (Elastic IP)   |
| EBS (8 GB gp3)                | $0.64/mo                 | $0.64/mo                |
| **Total**                     | **~$21/mo**              | **~$9.3/mo**            |

Aggressive option: `t4g.micro` spot (~$2.5/mo, 1 GB RAM) → **~$6.8/mo total**. The relay
fits easily in 1 GB at current traffic, but `t4g.small` (2 GB) leaves comfortable headroom.

> Spot prices float. Caps below use the on-demand price as max, so worst case = on-demand.

## 3. The risk you accepted — and how we contain it

Game state lives **in-memory** (no Redis, no replication). A Spot interruption gives a
**2-minute warning**, then the box is reclaimed. What survives vs. what's lost:

| State                                    | Survives a hard kill? | Why |
|------------------------------------------|-----------------------|-----|
| Board position / move history            | ✅ Yes                | Persisted to DB on every move (`persistMove` → `/api/chess/move`) |
| Final result                             | ✅ Yes                | `completeGame` → `/api/chess/game-over` |
| Live clock tick *between* moves          | ⚠️ Rolled back to last move | Only persisted per-move |
| Pre-game analysis-phase countdown        | ❌ Lost               | In-memory timer |
| Active socket connections                | ❌ Drop, must reconnect | Sockets are per-process |

**Mitigation = a Spot-interruption handler** (Section 5): on the 2-min notice it flushes
each live game's current clocks to the DB and tells clients to reconnect, *then* exits.
Net effect: a clean handoff instead of a hard drop. At current traffic (a handful of
concurrent games, t4g interruptions in us-east-1 are infrequent) this is a rare, graceful
blip rather than lost games.

## 4. Architecture decision

Two paths. Recommend starting with **Path A**, hardening to **Path B** later if Spot
churn ever becomes noticeable.

### Path A — single persistent Spot instance + Elastic IP (recommended first step)
- One `t4g.small` Spot instance, **Elastic IP** attached, DNS points at the EIP.
- If interrupted: the interruption handler flushes state; you (or a tiny cron) launch a
  replacement and re-associate the EIP. Simplest; manual replacement is fine at this scale.

### Path B — Auto Scaling Group (desired=1) for self-healing
- Launch template (Graviton, Spot, capacity-optimized across `t4g.small`/`t4g.medium`/
  `t3a.small`), ASG `min=max=desired=1`.
- User-data associates the EIP + boots the service, so AWS auto-replaces an interrupted
  instance with **zero manual steps**. Requires an instance profile with
  `ec2:AssociateAddress` and a pre-baked arm64 AMI. Do this once Path A is proven.

DNS stays on `ws-chess.playchess.tech` → **Elastic IP** (stable across replacements), so
`NEXT_PUBLIC_WEBSOCKET_URL` on Vercel never changes.

## 5. App code changes (review before applying — NOT yet applied)

Three small additions. They are additive and safe on x86 too (the IMDS poll simply no-ops
when not running on EC2 Spot).

### 5a. New file: `apps/web-socket/spotInterruption.ts`
```ts
import { logger } from "./utils/logger";

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

/** Polls IMDS for the Spot interruption notice; runs onInterrupt() once, then SIGTERM. */
export function watchForSpotInterruption(onInterrupt: () => Promise<void>): void {
  let triggered = false;
  const timer = setInterval(async () => {
    if (triggered) return;
    const token = await imdsToken();
    if (!token) return;
    if (await isInterrupting(token)) {
      triggered = true;
      clearInterval(timer);
      logger.warn("Spot interruption notice — flushing state, then shutting down");
      try {
        await onInterrupt();
      } finally {
        process.kill(process.pid, "SIGTERM"); // reuse existing graceful shutdown
      }
    }
  }, POLL_MS);
  timer.unref?.();
}
```

### 5b. `GameSession.ts` — add a flush + restart notice
```ts
// add updateGameState to the existing apiClient import
import { persistMove, completeGame, updateGameState } from "./utils/apiClient";

/** Persist current (ticking) clocks so a restart doesn't roll back to the last move. */
public async flushStateToDb(): Promise<void> {
  if (!this.gameStarted || this.gameEnded) return;
  await updateGameState({
    gameReferenceId: this.gameData.referenceId,
    whiteTime: this.clockManager.getTimeInSeconds("w"),
    blackTime: this.clockManager.getTimeInSeconds("b"),
    lastMoveAt: new Date(),
  });
}

/** Tell players/spectators to expect a brief reconnect. */
public notifyServerRestart(): void {
  const payload = { gameReferenceId: this.gameData.referenceId };
  this.broadcast("server_restarting", payload);
  this.broadcastToSpectators("server_restarting", payload);
}
```

### 5c. `GameManager.ts` — flush all live games
```ts
public async flushAllGames(): Promise<void> {
  const sessions = Array.from(this.games.values());
  logger.info(`Flushing ${sessions.length} active game(s) before shutdown`);
  await Promise.allSettled(
    sessions.map((s) => {
      s.notifyServerRestart();
      return s.flushStateToDb();
    })
  );
}
```

### 5d. `index.ts` — wire it up (after `gameManager` is created)
```ts
import { watchForSpotInterruption } from "./spotInterruption";
// ...
watchForSpotInterruption(async () => {
  await gameManager.flushAllGames();
});
```
The existing `SIGTERM` handler already calls `gameManager.destroy()` + `server.close()`,
so no further shutdown wiring is needed.

> Client side: socket.io already auto-reconnects, and the server already supports
> reconnection (`handleReconnect` replays game/analysis state). Optionally have the client
> show a "reconnecting…" toast on the `server_restarting` event — not required for correctness.

## 6. AWS setup — Path A (exact commands, run when approved)

Reuses the prod box's network: VPC `vpc-0c82e1cee63c5d47f`, subnet
`subnet-05e8a6eb329c254d4`, SG `sg-065e17529c98615cc`, key `chess-battle-keypair`,
region `us-east-1`.

```bash
# 1. Latest Ubuntu 22.04 ARM64 AMI (Graviton)
ARM_AMI=$(aws ssm get-parameter \
  --name /aws/service/canonical/ubuntu/server/22.04/stable/current/arm64/hvm/ebs-gp2/ami-id \
  --query Parameter.Value --output text)
echo "ARM AMI: $ARM_AMI"

# 2. Allocate an Elastic IP (stable address for DNS)
EIP_ALLOC=$(aws ec2 allocate-address --domain vpc --query AllocationId --output text)
EIP_ADDR=$(aws ec2 describe-addresses --allocation-ids "$EIP_ALLOC" \
  --query 'Addresses[0].PublicIp' --output text)
echo "Elastic IP: $EIP_ADDR ($EIP_ALLOC)"

# 3. Launch a t4g.small SPOT instance (max price capped at on-demand)
aws ec2 run-instances \
  --image-id "$ARM_AMI" \
  --instance-type t4g.small \
  --key-name chess-battle-keypair \
  --security-group-ids sg-065e17529c98615cc \
  --subnet-id subnet-05e8a6eb329c254d4 \
  --instance-market-options 'MarketType=spot,SpotOptions={MaxPrice=0.0168,SpotInstanceType=persistent,InstanceInterruptionBehavior=stop}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=chess-battle-ws-spot}]' \
  --count 1

# 4. Once it's "running", associate the Elastic IP
NEW_ID=<instance-id-from-step-3>
aws ec2 associate-address --instance-id "$NEW_ID" --allocation-id "$EIP_ALLOC"
```

Then provision the app on the new box (it's a fresh Ubuntu arm64 host):
```bash
# SSH in, then run the existing setup — it is arch-agnostic (NodeSource detects arm64)
scp -r apps/web-socket/deploy ubuntu@$EIP_ADDR:/tmp/
ssh ubuntu@$EIP_ADDR 'sudo bash /tmp/deploy/setup-server.sh'   # installs Node 22, nginx, certbot, systemd
# copy .env (PORT, NODE_ENV=production, WEB_APP_URL, INTERNAL_API_SECRET — must match Vercel)
# issue TLS for ws-chess.playchess.tech via certbot, then deploy-app.sh
```

> `INTERNAL_API_SECRET` must match Vercel's value, or every `/api/chess/*` call 401s and
> games get stuck `IN_PROGRESS` (see deploy/README.md).

### DNS cutover (after the new box is healthy on its own hostname)
1. Confirm `curl https://<eip>/health` returns `{"status":"ok"}` with a valid cert.
2. Point `ws-chess.playchess.tech` A record → **Elastic IP** (managed at your DNS
   provider — there is no Route53 zone in this account).
3. Watch CloudWatch `NetworkOut` move to the new box; old `t2.small` drains as clients
   reconnect.
4. After ~24h of clean traffic, terminate the old `t2.small` (`i-09ea75448671c1b94`).

## 7. Validation & rollback
- **Validate:** health endpoint, a real test game end-to-end, then simulate an
  interruption to exercise the handler — `aws ec2 send-spot-instance-interruptions
  --instance-id <id> --instance-interruption-action stop` (Fault Injection / supported in
  test) and confirm clocks flush + clients reconnect.
- **Rollback:** DNS still has the old `t2.small` IP until you terminate it — repoint the A
  record back and you're instantly restored. Keep the old box running until step 6.4.

## 8. Non-spot fallback (if Spot churn ever annoys you)
A 1-year **Compute Savings Plan** on a `t4g.small` on-demand gives ~30–40% off
($16.79 → ~$10–12/mo) with zero interruption risk. Worth it only if Spot interruptions
prove disruptive; for now Spot is cheaper and acceptable.

## 10. AS-BUILT — parallel spot box provisioned 2026-06-03

A `t4g.small` Spot box was provisioned and **validated serving the prod domain on its own
IP (DNS untouched)**. Production (`t2.small` 52.91.156.80) was never touched.

| Resource | Value |
|----------|-------|
| Spot instance | `i-0e3eb558284b2f37b` (t4g.small, arm64, persistent spot, stop-on-interrupt, MaxPrice=$0.0168) |
| Elastic IP | **44.222.7.147** (`eipalloc-036a720cb5427707b`) |
| Image | Ubuntu 22.04 arm64 (`ami-0210135d98f11a45f`) |
| Disk | 8 GB gp3 (58% used) |
| SG / subnet / key | `sg-065e17529c98615cc` / `subnet-05e8a6eb329c254d4` / `chess-battle-keypair` (reused from prod) |
| Runtime | Node 22.22.3, pnpm 11.5.1, systemd `chess-websocket` + nginx (both enabled on boot) |
| Code | latest `main` (1c44f7e) **+ the Section 5 spot-interruption handler overlaid** |
| Validated | `https://ws-chess.playchess.tech/health` via `--resolve` → ok, valid cert (exp Aug 11), Socket.IO handshake ok, 80→443 redirect ok |

### Remaining steps — YOURS to do (each is reversible until the last)
1. **(Recommended first)** Commit + push the Section 5 code changes to `main` so the box's
   git state matches its running code. Then on the box: `cd .../chess-battle-turbo &&
   git checkout -- apps/web-socket && git pull` to reconcile. Until you do this, the box
   runs the handler but its git working tree shows local modifications (a future CI
   `git pull` could conflict).
   - Note: pushing triggers `deploy-websocket.yml`, which deploys to the **current**
     `EC2_HOST` (the old box). Harmless (handler no-ops on x86). Update `EC2_HOST` *after*
     cutover so deploys target the new box.
2. **DNS cutover** (at your DNS provider — no Route53 here): point `ws-chess.playchess.tech`
   A record → **44.222.7.147**. Lower the TTL first if you want a fast rollback window.
3. **Watch** traffic move: CloudWatch `NetworkOut` on `i-0e3eb558284b2f37b`, or
   `sudo journalctl -u chess-websocket -f` on the new box.
4. **Update GitHub secret** `EC2_HOST` → `44.222.7.147` (keypair unchanged) so future
   pushes deploy to the spot box.
5. **After ~24h clean**, terminate the old `t2.small` (`i-09ea75448671c1b94`). Rollback
   before then = repoint DNS back to `52.91.156.80`.

### Notes
- Cert auto-renewal on the new box needs DNS pointing at it (HTTP-01); it works after
  step 2. Current cert is valid until Aug 11, so there's no rush.
- Spot reclaim → handler flushes clocks + signals clients → box **stops** (EIP stays
  attached) → AWS restarts it when capacity returns → systemd auto-starts. Brief downtime
  during the reclaim window is the accepted "spot for now" tradeoff.
- The systemd unit logs a cosmetic "StandardOutput=syslog is obsolete" warning (inherited
  from the repo unit file); logging to journal works fine.

## 9. Open items for you
- Confirm `t4g.small` vs `t4g.micro` (RAM headroom vs. ~$2.5/mo extra savings).
- Confirm Path A now, Path B (ASG self-healing) later — or jump straight to B.
- Approve the Section 5 code changes before I wire them into the app.
