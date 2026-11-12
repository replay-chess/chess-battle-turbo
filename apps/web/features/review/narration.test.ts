// narration.ts: the sentence-by-sentence state machine with a fake speech engine (plan §8.10).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clockText,
  NARRATION_RATE_KEY,
  narrationPct,
  narrationTime,
  Narrator,
  nextRate,
  rateLabel,
  type SpeechEngine,
  type UtteranceLike,
} from "./narration";

class FakeEngine implements SpeechEngine {
  queue: UtteranceLike[] = [];
  cancels = 0;
  voices = [{ lang: "fr-FR" }, { lang: "en-GB" }];
  private voiceListeners = new Set<() => void>();
  speak(u: UtteranceLike) {
    this.queue.push(u);
  }
  cancel() {
    this.cancels++;
    const q = this.queue;
    this.queue = [];
    for (const u of q) u.onerror?.({ error: "interrupted" });
  }
  getVoices() {
    return this.voices;
  }
  addEventListener(_: "voiceschanged", fn: () => void) {
    this.voiceListeners.add(fn);
  }
  removeEventListener(_: "voiceschanged", fn: () => void) {
    this.voiceListeners.delete(fn);
  }
  /** Plays the current utterance: start, a word boundary, end. */
  finishCurrent(boundaryAt?: number) {
    const u = this.queue.shift();
    assert.ok(u, "an utterance is queued");
    u.onstart?.({});
    if (boundaryAt !== undefined) u.onboundary?.({ charIndex: boundaryAt });
    u.onend?.({});
    return u;
  }
}

function setup(stored?: string) {
  const engine = new FakeEngine();
  const store = new Map<string, string>();
  if (stored !== undefined) store.set(NARRATION_RATE_KEY, stored);
  const events: string[] = [];
  const narrator = new Narrator({
    engine,
    makeUtterance: (text) => ({ text, rate: 1, lang: "", voice: null, onstart: null, onend: null, onerror: null, onboundary: null }),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    onPlayed: (r) => events.push(`played:${r}`),
    onCompleted: (r) => events.push(`completed:${r}`),
  });
  return { engine, narrator, store, events };
}

const TEXT = ["You played at 85 accuracy.", "The game turned on move 19.", "3 moments are worth a look."];

test("plays sentence by sentence, highlighting the one being spoken, then reports done", () => {
  const { engine, narrator, events } = setup();
  narrator.setText(TEXT);
  assert.equal(narrator.getSnapshot().status, "off");
  assert.equal(narrator.getSnapshot().totalChars, TEXT.join("").length);
  narrator.play();
  assert.equal(narrator.getSnapshot().status, "playing");
  assert.equal(engine.queue[0]!.text, TEXT[0]);
  assert.equal((engine.queue[0]!.voice as { lang: string }).lang, "en-GB", "first en-* voice");
  engine.finishCurrent(4);
  assert.equal(narrator.getSnapshot().sentence, 0);
  assert.equal(narrator.getSnapshot().spokenChars, TEXT[0]!.length);
  engine.queue[0]!.onstart?.({});
  assert.equal(narrator.getSnapshot().sentence, 1);
  engine.queue[0]!.onboundary?.({ charIndex: 4 });
  assert.equal(narrator.getSnapshot().spokenChars, TEXT[0]!.length + 4);
  engine.finishCurrent();
  engine.finishCurrent();
  assert.equal(narrator.getSnapshot().status, "done");
  assert.equal(narrationPct(narrator.getSnapshot()), 100);
  assert.deepEqual(events, ["played:1", "completed:1"]);
});

test("pause remembers the sentence and resume re-speaks it; stop rewinds", () => {
  const { engine, narrator, events } = setup();
  narrator.setText(TEXT);
  narrator.play();
  engine.finishCurrent();
  engine.queue[0]!.onstart?.({});
  narrator.pause();
  assert.deepEqual(
    { status: narrator.getSnapshot().status, sentence: narrator.getSnapshot().sentence },
    { status: "paused", sentence: 1 },
  );
  assert.equal(engine.queue.length, 0, "the engine was cancelled");
  narrator.toggle();
  assert.equal(narrator.getSnapshot().status, "playing");
  assert.equal(engine.queue[0]!.text, TEXT[1], "resumes at the paused sentence");
  assert.deepEqual(events, ["played:1"], "a resume is not a new play");
  narrator.stop();
  assert.deepEqual(
    { status: narrator.getSnapshot().status, sentence: narrator.getSnapshot().sentence, spoken: narrator.getSnapshot().spokenChars },
    { status: "off", sentence: -1, spoken: 0 },
  );
});

test("the speed cycles 1 → 1.25 → 1.5 → 1, is remembered and restarts the current sentence", () => {
  const { engine, narrator, store } = setup();
  narrator.setText(TEXT);
  assert.equal(nextRate(1), 1.25);
  assert.equal(nextRate(1.5), 1);
  assert.equal(rateLabel(1.25), "1.25×");
  narrator.play();
  engine.finishCurrent();
  engine.queue[0]!.onstart?.({});
  narrator.cycleRate();
  assert.equal(narrator.getSnapshot().rate, 1.25);
  assert.equal(store.get(NARRATION_RATE_KEY), "1.25");
  assert.equal(engine.queue.length, 1);
  assert.equal(engine.queue[0]!.text, TEXT[1]);
  assert.equal(engine.queue[0]!.rate, 1.25);
});

test("a stored speed is read back; junk falls back to 1", () => {
  assert.equal(setup("1.5").narrator.getSnapshot().rate, 1.5);
  assert.equal(setup("2").narrator.getSnapshot().rate, 1);
});

test("an engine error ends the narration; a new text resets it", () => {
  const { engine, narrator } = setup();
  narrator.setText(TEXT);
  narrator.play();
  engine.queue[0]!.onerror?.({ error: "synthesis-failed" });
  assert.equal(narrator.getSnapshot().status, "off");
  narrator.play();
  narrator.setText(["Another text."]);
  assert.equal(narrator.getSnapshot().status, "off");
  assert.equal(narrator.getSnapshot().totalChars, "Another text.".length);
  const cancels = engine.cancels;
  narrator.setText(["Another text."]);
  assert.equal(engine.cancels, cancels, "the same text is not reset again");
});

test("time and progress estimates use 14 characters per second × rate", () => {
  assert.equal(clockText(7.4), "0:07");
  assert.equal(clockText(75), "1:15");
  assert.equal(narrationTime({ spokenChars: 98, totalChars: 252, rate: 1 }), "0:07 / 0:18");
  assert.equal(narrationTime({ spokenChars: 0, totalChars: 252, rate: 1.5 }), "0:00 / 0:12");
  assert.equal(narrationPct({ spokenChars: 0, totalChars: 0 }), 0);
});
