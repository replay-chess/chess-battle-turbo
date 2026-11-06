// Golden transcripts (phase-02 plan §12.3): one file per lit state, every command, ack, event and snapshot valid
// against the protocol schemas, `seq` +1 per room event, time non-decreasing. The files live in
// PKG/chess-fixtures/socket/transcripts (read by path: contracts does not depend on the fixtures package).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { GameSnapshot } from "../../http/games";
import { COMMANDS, isCommandName } from "../commands";
import { GAME_EVENT_SPECS, isServerEventName, SERVER_EVENTS } from "../registry";
import { LIT_STATES, Transcript } from "./transcript";

const dir = fileURLToPath(new URL("../../../../chess-fixtures/socket/transcripts/", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

describe("golden transcripts", () => {
  it("has exactly one file per lit design state", () => {
    assert.deepEqual(files.map((f) => f.replace(/\.json$/, "")).sort(), [...LIT_STATES].sort());
  });

  for (const file of files) {
    it(file, () => {
      const raw = JSON.parse(readFileSync(dir + file, "utf8")) as unknown;
      const parsed = Transcript.safeParse(raw);
      assert.ok(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3)));
      const tr = parsed.data;
      assert.equal(`${tr.state}.json`, file);
      assert.ok(Object.keys(tr.expect).length > 0, "expects at least one role");
      assert.ok(Object.values(tr.expect).some((e) => e?.primary === tr.state),
        "some role reaches the named state");

      let lastT = 0;
      const seqByRoom = new Map<string, number>();
      for (const [i, step] of tr.steps.entries()) {
        const at = `step ${i}`;
        assert.ok(step.t >= lastT, `${at}: time goes backwards`);
        lastT = step.t;
        if ("snapshot" in step) {
          assert.ok(GameSnapshot.safeParse(step.snapshot).success, `${at}: snapshot`);
        } else if ("send" in step) {
          assert.ok(isCommandName(step.send), `${at}: unknown command ${step.send}`);
          const cmd = COMMANDS[step.send];
          const p = cmd.payload.safeParse(step.payload);
          assert.ok(p.success, `${at}: ${step.send} payload ${JSON.stringify(p.error?.issues)}`);
          if (step.ack !== null) {
            const a = cmd.ack.safeParse(step.ack);
            assert.ok(a.success, `${at}: ${step.send} ack ${JSON.stringify(a.error?.issues.slice(0, 3))}`);
            const state = (step.ack as { state?: { seq: number; ref: string; you: { role: string } } }).state;
            if (state) seqByRoom.set(`${state.you.role === "spectator" ? "spectate" : "game"}:${state.ref}:${step.actor}`, state.seq);
          }
        } else if ("event" in step) {
          assert.ok(isServerEventName(step.event), `${at}: unknown event ${step.event}`);
          const spec = SERVER_EVENTS[step.event];
          const e = spec.schema.safeParse(step.payload);
          assert.ok(e.success, `${at}: ${step.event} ${JSON.stringify(e.error?.issues.slice(0, 3))}`);
          if (step.event in GAME_EVENT_SPECS && spec.seq) {
            const { seq, ref } = step.payload as { seq: number; ref: string };
            for (const role of step.to) {
              const key = `${role === "spectator" ? "spectate" : "game"}:${ref}:${role}`;
              const prev = seqByRoom.get(key);
              if (prev !== undefined) assert.equal(seq, prev + 1, `${at}: ${step.event} seq for ${role}`);
              seqByRoom.set(key, seq);
            }
          }
        }
      }
    });
  }
});
