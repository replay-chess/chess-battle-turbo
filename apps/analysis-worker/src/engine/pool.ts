// The engine pool (phase-03 plan §8.12, task C3): ONE engine process for the worker (the box has 0.75 of a core for
// it). A search that times out or hits a dead process restarts the process and retries the same position once; a
// second failure is EngineFailed, which fails the job with `engine_failed` (back-off and retry, §7.7).
//
// `injectCrash(n)` kills the process before each of the next n searches (the `engine_crash:n` test fault, §7.9):
// 1 exercises the restart-and-retry path, 2 fails the job.
import type { Logger } from "../obs/log";
import type { Metrics } from "../obs/metrics";
import { EngineError, EngineFailed, type Engine, type SearchRequest, type SearchResult } from "./types";

export type EngineState = "starting" | "ready" | "failed" | "fake";

export interface EnginePoolOptions {
  factory: () => Engine;
  log: Logger;
  metrics: Metrics;
}

export class EnginePool {
  private engine: Engine | null = null;
  private pendingCrashes = 0;
  private _state: EngineState = "starting";
  private _buildId = "";
  private _name = "";
  private kind: Engine["kind"] | null = null;

  constructor(private readonly opts: EnginePoolOptions) {}

  get state(): EngineState {
    return this._state;
  }

  /** The build part of `game_analyses.engine`, known after start(). */
  get buildId(): string {
    return this._buildId;
  }

  get name(): string {
    return this._name;
  }

  async start(): Promise<void> {
    this._state = "starting";
    try {
      await this.spawn();
    } catch (error) {
      this._state = "failed";
      throw error;
    }
  }

  private async spawn(): Promise<Engine> {
    const engine = this.opts.factory();
    await engine.start();
    this.engine = engine;
    this.kind = engine.kind;
    this._buildId = engine.buildId;
    this._name = engine.name;
    this._state = engine.kind === "fake" ? "fake" : "ready";
    return engine;
  }

  private async restart(reason: unknown): Promise<Engine> {
    this.opts.metrics.engineRestarts++;
    this.opts.log.warn("engine restart", { reason });
    const old = this.engine;
    this.engine = null;
    if (old) {
      old.kill();
      await old.quit().catch(() => undefined);
    }
    try {
      return await this.spawn();
    } catch (error) {
      this._state = "failed";
      throw new EngineFailed("the engine did not restart", error);
    }
  }

  /** Kill the process before each of the next `count` searches (the `engine_crash` fault). */
  injectCrash(count: number): void {
    this.pendingCrashes += Math.max(0, Math.floor(count));
  }

  async newGame(): Promise<void> {
    const engine = this.engine ?? (await this.restart("no engine"));
    try {
      await engine.newGame();
    } catch (error) {
      if (!(error instanceof EngineError)) throw error;
      await (await this.restart(error)).newGame();
    }
  }

  /** One search with the restart-and-retry-once rule. */
  async search(req: SearchRequest): Promise<SearchResult> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      let engine = this.engine;
      try {
        if (!engine) engine = await this.restart(lastError ?? "no engine");
        if (this.pendingCrashes > 0) {
          this.pendingCrashes--;
          engine.kill();
        }
        const result = await engine.search(req);
        if (result.nps !== null && result.nps > 0) this.opts.metrics.engineNps = Math.round(result.nps);
        return result;
      } catch (error) {
        if (!(error instanceof EngineError)) throw error;
        lastError = error;
        if (attempt === 2) break;
        try {
          engine = await this.restart(error);
          await engine.newGame();
        } catch (restartError) {
          throw restartError instanceof EngineFailed ? restartError : new EngineFailed("the engine did not restart", restartError);
        }
      }
    }
    // Leave a fresh process for the next job.
    await this.restart(lastError).catch(() => undefined);
    throw new EngineFailed(`the engine failed twice on one position (${(lastError as Error).message})`, lastError);
  }

  async stop(): Promise<void> {
    const engine = this.engine;
    this.engine = null;
    if (engine) await engine.quit();
  }

  /** For /ready and telemetry tags. */
  get engineKind(): Engine["kind"] | null {
    return this.kind;
  }
}
