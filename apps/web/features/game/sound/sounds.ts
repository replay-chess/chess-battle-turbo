// Game sounds (P2 plan 4.6.2): the 11 files in public/sounds/*.webm, fetched and decoded into Web Audio buffers on
// the first user gesture on the game page (never at mount: browsers refuse audio before a gesture, and a page that
// never makes a sound downloads nothing). One bank per tab. A file the browser cannot decode (older Safari and
// WebM/Opus) falls back to an <audio> element for that file. Every failure is silent: sound is never critical.

import { SOUND_NAMES, type SoundName } from "./events";

const url = (name: SoundName) => `/sounds/${name}.webm`;

type Ctx = AudioContext;
type CtxCtor = new () => AudioContext;

export class SoundBank {
  private ctx: Ctx | null = null;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private readonly fallback = new Set<SoundName>();
  private loading: Promise<void> | null = null;

  /** True once the gesture unlock ran (the buffers may still be decoding). */
  get unlocked(): boolean {
    return this.loading !== null;
  }

  /** Call from a user gesture: creates/resumes the AudioContext and starts loading every file once. */
  unlock(): Promise<void> {
    if (typeof window === "undefined") return Promise.resolve();
    const w = window as unknown as { AudioContext?: CtxCtor; webkitAudioContext?: CtxCtor };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!this.ctx && Ctor) {
      try {
        this.ctx = new Ctor();
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx?.state === "suspended") void this.ctx.resume().catch(() => {});
    this.loading ??= Promise.all(SOUND_NAMES.map((n) => this.load(n))).then(() => {});
    return this.loading;
  }

  private async load(name: SoundName): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) {
      this.fallback.add(name);
      return;
    }
    try {
      const res = await fetch(url(name), { cache: "force-cache" });
      if (!res.ok) return;
      const data = await res.arrayBuffer();
      this.buffers.set(name, await ctx.decodeAudioData(data));
    } catch {
      this.fallback.add(name);
    }
  }

  play(name: SoundName, gain = 1): void {
    const ctx = this.ctx;
    const buffer = this.buffers.get(name);
    if (ctx && buffer) {
      try {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const g = ctx.createGain();
        g.gain.value = Math.max(0, Math.min(1, gain));
        src.connect(g).connect(ctx.destination);
        src.start();
      } catch {
        /* a closed or interrupted context: skip this cue */
      }
      return;
    }
    if (!this.fallback.has(name)) return; // still decoding: drop the cue rather than play it late
    try {
      const el = new Audio(url(name));
      el.volume = Math.max(0, Math.min(1, gain));
      void el.play().catch(() => {});
    } catch {
      /* no audio element support */
    }
  }
}

let bank: SoundBank | null = null;

/** The tab's sound bank. */
export function getSoundBank(): SoundBank {
  bank ??= new SoundBank();
  return bank;
}
