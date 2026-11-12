// `analysis:progress` frames (phase-03 plan §5.11, P3-D26; frame contract in CA/src/codec.ts `PliesDelta`).
//
// Band: frames go out only while the job streams (`streamsProgress(priority, watched)`: priority ≥ GAME_ENDED or a
// kick watched the game in the last 10 minutes); the band is re-read at every frame, so an A3 that raised the
// priority mid-run (seen at the next checkpoint or heartbeat) switches streaming on.
//
// Cadence: a frame when 2 plies are new, or 300 ms after the last frame when at least one is (PROGRESS_FRAME_*).
//
// Where a frame starts: a client that holds the A1 snapshot holds the last checkpoint, so a frame must start at or
// before it to splice (`deltaFit`). Each frame starts at the checkpoint that was current when the previous frame was
// sent, but never more than PROGRESS_FRAME_MAX_PLIES (8) plies back (the schema's cap). Example with checkpoints every
// 10 plies: frames 10→12, 10→14, 10→16, 10→18, then 12→20 (the checkpoint at 20 commits first, so a client that
// finds a gap refetches A1 and gets 20), then 20→22 … A resumed run first sends `{from: r, gradedPlies: r}` so a
// reloaded client shows the resume point at once (§8.12 step 4).
//
// Frames are posted in order on one promise chain, so the search never waits for the socket hop.
import { encodeBestTokens, encodeJudgements } from "@repo/chess-analysis/codec";
import {
  PROGRESS_FRAME_EVERY_MS,
  PROGRESS_FRAME_EVERY_PLIES,
  PROGRESS_FRAME_MAX_PLIES,
} from "@repo/contracts/socket/analysis";
import type { Clock } from "../scheduler/clock";
import type { EmitSink } from "../socket/emit";
import { buildEvent } from "../socket/events";
import type { AnalysisArrays } from "./types";

export interface ProgressStreamOptions {
  emitter: EmitSink;
  clock: Clock;
  gameRef: string;
  totalPlies: number;
  memberRefs: readonly string[];
  /** Re-read at every frame. */
  streams(): boolean;
  depthP50(): number;
}

export class ProgressStream {
  private lastEnd = 0;
  private lastAtMs = 0;
  /** The last checkpoint written. */
  private checkpoint = 0;
  /** The checkpoint that was current when the last frame was sent (the next frame's earliest start). */
  private base = 0;
  private chain: Promise<unknown> = Promise.resolve();
  /** When the first frame with graded plies was posted (for `worker.first_progress_ms`). */
  firstFrameAtMs: number | null = null;
  framesSent = 0;

  constructor(private readonly opts: ProgressStreamOptions) {}

  /** The run starts (or resumes) with `resumedAt` plies already graded and stored. */
  start(resumedAt: number, arrays: AnalysisArrays): void {
    this.lastEnd = resumedAt;
    this.checkpoint = resumedAt;
    this.base = resumedAt;
    this.lastAtMs = this.opts.clock.now();
    if (!this.opts.streams()) return;
    this.post(resumedAt, resumedAt, arrays);
  }

  /** A checkpoint at `gradedPlies` committed. */
  noteCheckpoint(gradedPlies: number): void {
    this.checkpoint = gradedPlies;
  }

  /** Would `update(gradedPlies)` send a frame now (streaming, and the cadence is due)? The caller grades only then. */
  wants(gradedPlies: number): boolean {
    const fresh = gradedPlies - this.lastEnd;
    if (fresh <= 0 || !this.opts.streams()) return false;
    return fresh >= PROGRESS_FRAME_EVERY_PLIES || this.opts.clock.now() - this.lastAtMs >= PROGRESS_FRAME_EVERY_MS;
  }

  /** `gradedPlies` plies are graded now (`arrays.judgements` holds them); sends a frame when the cadence says so. */
  update(gradedPlies: number, arrays: AnalysisArrays): void {
    if (this.wants(gradedPlies)) this.send(gradedPlies, arrays);
  }

  /** Sends whatever is not sent yet (end of pass 1). */
  flush(gradedPlies: number, arrays: AnalysisArrays): void {
    if (gradedPlies > this.lastEnd) this.send(gradedPlies, arrays);
  }

  /** Waits for every posted frame. */
  async drain(): Promise<void> {
    await this.chain;
  }

  private send(gradedPlies: number, arrays: AnalysisArrays): void {
    const from = Math.max(this.base, gradedPlies - PROGRESS_FRAME_MAX_PLIES);
    this.lastEnd = gradedPlies;
    this.lastAtMs = this.opts.clock.now();
    this.base = this.checkpoint;
    if (!this.opts.streams()) return;
    this.post(from, gradedPlies, arrays);
    if (this.firstFrameAtMs === null && gradedPlies > from) this.firstFrameAtMs = this.lastAtMs;
  }

  private post(from: number, gradedPlies: number, arrays: AnalysisArrays): void {
    const data = buildEvent("analysis:progress", {
      gameRef: this.opts.gameRef,
      from,
      gradedPlies,
      totalPlies: this.opts.totalPlies,
      evals: arrays.evals.slice(from, gradedPlies + 1),
      best: encodeBestTokens(arrays.best.slice(from, gradedPlies)),
      j: encodeJudgements(arrays.judgements.slice(from, gradedPlies)),
      depthP50: this.opts.depthP50(),
    });
    this.framesSent++;
    const refs = this.opts.memberRefs;
    this.chain = this.chain.then(() => this.opts.emitter.emit("analysis:progress", data, refs));
  }
}
