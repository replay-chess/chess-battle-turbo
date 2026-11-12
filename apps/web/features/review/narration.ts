// Coach narration with the Web Speech API (phase-03 plan §8.10; rct-a §2.7). Client only, costs nothing.
//
// - One SpeechSynthesisUtterance per sentence; its `start` event moves the highlight to that sentence.
// - Rate ∈ {1, 1.25, 1.5}, remembered in localStorage `rc:narration:rate` (try/catch; P10 syncs it from Settings).
// - Progress = spoken characters / total (word `boundary` events refine it inside a sentence); the duration estimate
//   is characters / (14 × rate) seconds.
// - The voice is the first `en-*` voice, re-picked on `voiceschanged`. iOS only speaks when the first `speak()` runs
//   inside the tap handler, so `play()` must be called synchronously from the click.
// - Pause is cancel-and-remember (speechSynthesis.pause() is unreliable on Android and Safari); resume re-speaks the
//   current sentence. Changing the speed while playing restarts the current sentence at the new rate.
// - The owner stops it on a moment, tab or route change and on `pagehide` (`stop()`).
// The controller is a tiny external store (subscribe/getSnapshot) for useSyncExternalStore; the speech engine is
// injected, so the state machine is unit-tested without a browser.

export const NARRATION_RATES = [1, 1.25, 1.5] as const;
export type NarrationRate = (typeof NARRATION_RATES)[number];
export const NARRATION_RATE_KEY = "rc:narration:rate";
/** Characters per second at rate 1 (the duration estimate). */
export const CHARS_PER_SECOND = 14;

export type NarrationStatus = "off" | "playing" | "paused" | "done";

export interface NarrationState {
  status: NarrationStatus;
  /** The sentence being spoken (or where a pause left off); −1 before the first `start`. */
  sentence: number;
  spokenChars: number;
  totalChars: number;
  rate: NarrationRate;
}

/** The part of `SpeechSynthesisUtterance` the controller uses. */
export interface UtteranceLike {
  text: string;
  rate: number;
  lang: string;
  voice: unknown;
  onstart: ((ev: unknown) => void) | null;
  onend: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onboundary: ((ev: { charIndex?: number }) => void) | null;
}

/** The part of `speechSynthesis` the controller uses. */
export interface SpeechEngine {
  speak(u: UtteranceLike): void;
  cancel(): void;
  getVoices(): { lang: string }[];
  addEventListener?(type: "voiceschanged", fn: () => void): void;
  removeEventListener?(type: "voiceschanged", fn: () => void): void;
}

export interface NarratorDeps {
  engine: SpeechEngine;
  makeUtterance(text: string): UtteranceLike;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  /** Called once when a run starts from the beginning and once when it reaches the end. */
  onPlayed?(rate: NarrationRate): void;
  onCompleted?(rate: NarrationRate): void;
}

export function isNarrationRate(n: number): n is NarrationRate {
  return (NARRATION_RATES as readonly number[]).includes(n);
}

/** The next speed of the 1× → 1.25× → 1.5× chip. */
export function nextRate(rate: NarrationRate): NarrationRate {
  const i = NARRATION_RATES.indexOf(rate);
  return NARRATION_RATES[(i + 1) % NARRATION_RATES.length]!;
}

/** "1×", "1.25×". */
export function rateLabel(rate: NarrationRate): string {
  return `${rate}×`;
}

/** "0:07". */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "0:07 / 0:18" from the spoken and total characters at a rate. */
export function narrationTime(state: Pick<NarrationState, "spokenChars" | "totalChars" | "rate">): string {
  const per = CHARS_PER_SECOND * state.rate;
  return `${clockText(state.spokenChars / per)} / ${clockText(state.totalChars / per)}`;
}

/** 0–100. */
export function narrationPct(state: Pick<NarrationState, "spokenChars" | "totalChars">): number {
  return state.totalChars > 0 ? Math.min(100, (state.spokenChars / state.totalChars) * 100) : 0;
}

function readRate(storage: NarratorDeps["storage"]): NarrationRate {
  try {
    const n = Number(storage?.getItem(NARRATION_RATE_KEY));
    return isNarrationRate(n) ? n : 1;
  } catch {
    return 1;
  }
}

export class Narrator {
  private state: NarrationState;
  private sentences: string[] = [];
  /** Character offset where each sentence starts (+ the total at the end). */
  private offsets: number[] = [0];
  private readonly listeners = new Set<() => void>();
  /** Bumped on every cancel, so callbacks of a cancelled utterance are ignored. */
  private run = 0;
  private voice: unknown = null;
  private readonly onVoices = () => this.pickVoice();

  constructor(private readonly deps: NarratorDeps) {
    this.state = { status: "off", sentence: -1, spokenChars: 0, totalChars: 0, rate: readRate(deps.storage) };
    deps.engine.addEventListener?.("voiceschanged", this.onVoices);
    this.pickVoice();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): NarrationState => this.state;

  /** Sets the text (sentences). A different text stops and resets the narration. */
  setText(sentences: readonly string[]): void {
    const clean = sentences.map((s) => s.trim()).filter(Boolean);
    if (clean.length === this.sentences.length && clean.every((s, i) => s === this.sentences[i])) return;
    this.cancelSpeech();
    this.sentences = clean;
    this.offsets = [0];
    for (const s of clean) this.offsets.push(this.offsets[this.offsets.length - 1]! + s.length);
    this.set({ status: "off", sentence: -1, spokenChars: 0, totalChars: this.offsets[this.offsets.length - 1]! });
  }

  /** Play from the start, or resume a pause. Call it synchronously from the tap (iOS). */
  play(): void {
    if (this.sentences.length === 0) return;
    const s = this.state;
    const from = s.status === "paused" && s.sentence >= 0 ? s.sentence : 0;
    if (from === 0) this.deps.onPlayed?.(s.rate);
    this.speakFrom(from);
  }

  pause(): void {
    if (this.state.status !== "playing") return;
    this.cancelSpeech();
    const sentence = Math.max(0, this.state.sentence);
    this.set({ status: "paused", sentence, spokenChars: this.offsets[sentence] ?? 0 });
  }

  toggle(): void {
    if (this.state.status === "playing") this.pause();
    else this.play();
  }

  /** Stops and rewinds (a tab, moment or route change; pagehide). */
  stop(): void {
    this.cancelSpeech();
    if (this.state.status !== "off" || this.state.spokenChars !== 0) this.set({ status: "off", sentence: -1, spokenChars: 0 });
  }

  setRate(rate: NarrationRate): void {
    if (rate === this.state.rate) return;
    try {
      this.deps.storage?.setItem(NARRATION_RATE_KEY, String(rate));
    } catch {
      // storage blocked: the speed lasts for this page only
    }
    const wasPlaying = this.state.status === "playing";
    const sentence = Math.max(0, this.state.sentence);
    this.set({ rate });
    if (wasPlaying) this.speakFrom(sentence);
  }

  cycleRate(): void {
    this.setRate(nextRate(this.state.rate));
  }

  destroy(): void {
    this.cancelSpeech();
    this.deps.engine.removeEventListener?.("voiceschanged", this.onVoices);
    this.listeners.clear();
  }

  // ── internals ──

  private pickVoice(): void {
    try {
      this.voice = this.deps.engine.getVoices().find((v) => /^en(-|_|$)/i.test(v.lang)) ?? null;
    } catch {
      this.voice = null;
    }
  }

  private cancelSpeech(): void {
    this.run++;
    try {
      this.deps.engine.cancel();
    } catch {
      // nothing to cancel
    }
  }

  private speakFrom(index: number): void {
    this.cancelSpeech();
    const run = this.run;
    this.set({ status: "playing", sentence: index, spokenChars: this.offsets[index] ?? 0 });
    const speakOne = (i: number) => {
      if (run !== this.run) return;
      if (i >= this.sentences.length) {
        this.set({ status: "done", spokenChars: this.state.totalChars });
        this.deps.onCompleted?.(this.state.rate);
        return;
      }
      const u = this.deps.makeUtterance(this.sentences[i]!);
      u.rate = this.state.rate;
      u.lang = "en-US";
      if (this.voice) u.voice = this.voice;
      u.onstart = () => {
        if (run === this.run) this.set({ sentence: i, spokenChars: this.offsets[i] ?? 0 });
      };
      u.onboundary = (ev) => {
        if (run !== this.run || typeof ev?.charIndex !== "number") return;
        const at = (this.offsets[i] ?? 0) + ev.charIndex;
        if (at > this.state.spokenChars) this.set({ spokenChars: Math.min(at, this.offsets[i + 1] ?? at) });
      };
      u.onend = () => {
        if (run !== this.run) return;
        this.set({ spokenChars: this.offsets[i + 1] ?? this.state.spokenChars });
        speakOne(i + 1);
      };
      u.onerror = () => {
        if (run !== this.run) return;
        // "interrupted"/"canceled" come from our own cancel (run changed); anything else ends the narration.
        this.cancelSpeech();
        this.set({ status: "off", sentence: -1, spokenChars: 0 });
      };
      this.deps.engine.speak(u);
    };
    speakOne(index);
  }

  private set(patch: Partial<NarrationState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}

/** The browser's speech engine, or null when the Web Speech API is missing (the controls are then hidden). */
export function browserSpeech(): Pick<NarratorDeps, "engine" | "makeUtterance" | "storage"> | null {
  if (typeof window === "undefined") return null;
  const synth = window.speechSynthesis as SpeechSynthesis | undefined;
  const Utterance = window.SpeechSynthesisUtterance as typeof SpeechSynthesisUtterance | undefined;
  if (!synth || !Utterance) return null;
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return {
    engine: synth as unknown as SpeechEngine,
    makeUtterance: (text) => new Utterance(text) as unknown as UtteranceLike,
    storage,
  };
}
