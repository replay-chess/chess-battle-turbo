// J5 PGN reading (phase-06 plan §7.4.5 steps 1–2) on real Lichess dump text: the 2026 dump's exact format (Site with
// /game/, %eval in pawns and mates, %clk h:mm:ss), the screen's every refusal, and the line splitter on text that
// starts and ends mid-game.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PgnSplitter, bandOf, clockOf, gameIdOf, parseEvalText, parseMovetext, screenGame, timeClassOf, type PgnGame } from "./pgn";

/** A real game of the 2026-10 dump (players' names removed), analysed by Lichess. */
const HEADERS = `[Event "Rated Rapid game"]
[Site "https://lichess.org/game/fihtkeRA"]
[Date "2026.10.01"]
[Round "-"]
[White "a"]
[Black "b"]
[Result "1/2-1/2"]
[UTCDate "2026.10.01"]
[UTCTime "00:11:46"]
[WhiteElo "834"]
[BlackElo "818"]
[ECO "C44"]
[TimeControl "600+0"]
[Termination "Normal"]`;

function movetext(plies: number, opts: { evalEvery?: boolean; clkEvery?: boolean; mateEnd?: boolean } = {}): string {
  const sans = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Na5", "Bb5+", "c6", "dxc6", "bxc6", "Be2", "h6", "Nf3", "e4", "Ne5", "Bd6", "d4", "exd3", "Nxd3", "Qc7", "b3"];
  const out: string[] = [];
  for (let i = 0; i < plies; i++) {
    const num = i % 2 === 0 ? `${i / 2 + 1}. ` : `${(i - 1) / 2 + 1}... `;
    const ev = opts.evalEvery === false && i === 3 ? "" : `[%eval ${(0.2 + i / 100).toFixed(2)}] `;
    const clk = opts.clkEvery === false && i === 5 ? "" : `[%clk 0:0${9 - Math.floor(i / 10)}:${String(59 - (i % 60)).padStart(2, "0")}]`;
    out.push(`${num}${sans[i % sans.length]}${i === 2 ? "?!" : ""} { ${ev}${clk} }`);
  }
  return `${out.join(" ")} 1/2-1/2`;
}

function game(headers: string, mt: string): PgnGame {
  const g = new PgnSplitter().push(`${headers}\n\n${mt}\n\n[Event "next"]\n`);
  assert.equal(g.length, 1);
  return g[0] as PgnGame;
}

describe("J5 PGN reading", () => {
  it("time classes from initial + 40 × increment (bullet < 180, blitz < 480, rapid < 1500)", () => {
    assert.equal(timeClassOf("15+0"), "BULLET");
    assert.equal(timeClassOf("60+1"), "BULLET");
    assert.equal(timeClassOf("120+1"), "BULLET", "2+1 is bullet on Lichess (160 s)");
    assert.equal(timeClassOf("180+0"), "BLITZ");
    assert.equal(timeClassOf("180+2"), "BLITZ");
    assert.equal(timeClassOf("300+5"), "RAPID");
    assert.equal(timeClassOf("600+0"), "RAPID");
    assert.equal(timeClassOf("900+15"), null);
    assert.equal(timeClassOf("1800+0"), null);
    assert.equal(timeClassOf("-"), null);
    assert.deepEqual(clockOf("180+2"), { initialSeconds: 180, incrementSeconds: 2 });
  });

  it("band keys are the lower edge of 100-point cells 600–2400", () => {
    assert.equal(bandOf(599), null);
    assert.equal(bandOf(600), "600");
    assert.equal(bandOf(1184), "1100");
    assert.equal(bandOf(2499), "2400");
    assert.equal(bandOf(2500), null);
  });

  it("the game id from both Site forms", () => {
    assert.equal(gameIdOf("https://lichess.org/game/fihtkeRA"), "fihtkeRA");
    assert.equal(gameIdOf("https://lichess.org/Q8ku5wgM"), "Q8ku5wgM");
    assert.equal(gameIdOf("https://example.org/x"), null);
  });

  it("parses moves, evals (pawns, mates) and clocks; glyphs dropped", () => {
    const p = parseMovetext("1. e4 { [%eval 0.17] [%clk 0:03:00] } 1... e5?? { [%eval #-3] [%clk 0:02:58] } 2. Qh5 { [%eval -1.5] [%clk 1:00:01] } 0-1");
    assert.deepEqual(p.sans, ["e4", "e5", "Qh5"]);
    assert.deepEqual(p.evals, [{ cp: 17 }, { mate: -3 }, { cp: -150 }]);
    assert.deepEqual(p.clocksSec, [180, 178, 3601]);
    assert.equal(p.result, "0-1");
    assert.deepEqual(parseEvalText("#4"), { mate: 4 });
    assert.deepEqual(parseEvalText("0.0"), { cp: 0 });
  });

  it("the screen keeps a fully analysed, clocked, rated game and refuses each missing piece", () => {
    const ok = screenGame(game(HEADERS, movetext(24)));
    assert.ok(ok.ok);
    if (ok.ok) {
      assert.equal(ok.id, "fihtkeRA");
      assert.equal(ok.tc, "RAPID");
      assert.equal(ok.plies, 24);
      assert.deepEqual(ok.sides, [
        { color: "w", elo: 834, band: "800" },
        { color: "b", elo: 818, band: "800" },
      ]);
    }
    const reason = (h: string, mt = movetext(24)) => {
      const s = screenGame(game(h, mt));
      return s.ok ? "ok" : s.reason;
    };
    assert.equal(reason(HEADERS.replace("Rated Rapid", "Casual Rapid")), "unrated");
    assert.equal(reason(`${HEADERS}\n[WhiteTitle "BOT"]`), "bot");
    assert.equal(reason(HEADERS.replace('"Normal"', '"Rules infraction"')), "termination");
    assert.equal(reason(HEADERS.replace('"Normal"', '"Abandoned"')), "termination");
    assert.equal(reason(HEADERS.replace('"600+0"', '"1800+0"')), "time_class");
    assert.equal(reason(HEADERS.replace('[BlackElo "818"]', '[BlackElo "?"]')), "elo");
    assert.equal(reason(HEADERS, movetext(24).replace(/\[%eval [^\]]*\] /g, "")), "no_eval");
    assert.equal(reason(HEADERS, movetext(19)), "short");
    assert.equal(reason(HEADERS, movetext(24, { clkEvery: false })), "clock");
    assert.equal(reason(HEADERS, movetext(24, { evalEvery: false })), "eval_gaps");
    assert.equal(reason(`${HEADERS}\n[FEN "8/8/8/8/8/8/8/K6k w - - 0 1"]\n[SetUp "1"]`), "from_position");
  });

  it("a game ending in mate may lack the mated position's eval (the importer's rule), nothing else may", () => {
    const base = movetext(20).replace(" 1/2-1/2", "");
    const mated = `${base} 11. Qxf7# { [%clk 0:01:00] } 1-0`;
    const p = parseMovetext(mated);
    assert.equal(p.sans.length, 21);
    assert.equal(p.evals[20], null);
    const s = screenGame(game(HEADERS, mated));
    assert.equal(s.ok ? "ok" : s.reason, "ok");
    const notMate = `${base} 11. Qxf7+ { [%clk 0:01:00] } 1-0`;
    const t = screenGame(game(HEADERS, notMate));
    assert.equal(t.ok ? "ok" : t.reason, "eval_gaps");
  });

  it("the splitter drops the partial game at either edge and survives any cut", () => {
    const text = `${movetext(4)}\n\n${HEADERS}\n\n${movetext(24)}\n\n${HEADERS.replace("fihtkeRA", "AAAAAAAA")}\n\n${movetext(30)}\n\n${HEADERS.replace("fihtkeRA", "BBBBBBBB")}\n`;
    for (const cut of [1, 7, 100, 777, text.length - 3]) {
      const s = new PgnSplitter();
      const games = [...s.push(text.slice(0, cut)), ...s.push(text.slice(cut)), ...s.end(false)];
      assert.deepEqual(
        games.map((g) => gameIdOf(g.headers.Site)),
        ["fihtkeRA", "AAAAAAAA"],
        `cut at ${cut}`,
      );
    }
    const s = new PgnSplitter();
    assert.deepEqual(
      [...s.push(`${HEADERS}\n\n${movetext(24)}\n`), ...s.end(true)].map((g) => gameIdOf(g.headers.Site)),
      ["fihtkeRA"],
      "a complete stream keeps its last game",
    );
  });
});
