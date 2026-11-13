// Anonymises one Chess.com archive month for the recorded fixture (phase-04 plan §12.5 "recorded", V-3): the
// member becomes `knightowl_88`, opponents `opponent_01`, `opponent_02`, …; game ids, uuids, player URLs, match and
// tournament links are replaced with synthetic ones; PGN headers are rebuilt from an allow-list (names replaced
// everywhere, unknown headers dropped). Moves, `%clk` comments, `tcn`, ratings, accuracies, times, FENs and openings
// stay as recorded, which is the point: V-3 checks the real field names and clock comments.

export const FIXTURE_MEMBER = "knightowl_88";

const PGN_HEADERS = [
  "Event",
  "Site",
  "Date",
  "Round",
  "White",
  "Black",
  "Result",
  "SetUp",
  "FEN",
  "Variant",
  "CurrentPosition",
  "Timezone",
  "ECO",
  "ECOUrl",
  "UTCDate",
  "UTCTime",
  "WhiteElo",
  "BlackElo",
  "TimeControl",
  "Termination",
  "StartTime",
  "EndDate",
  "EndTime",
  "Link",
] as const;

type Player = { username: string; "@id"?: string; uuid?: string } & Record<string, unknown>;
type Game = { url: string; pgn: string; uuid: string; white: Player; black: Player } & Record<string, unknown>;

export interface AnonymiseResult {
  games: Record<string, unknown>[];
  /** Header names that were dropped (reported by the recorder, never written). */
  droppedHeaders: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function anonymiseMonth(rawGames: readonly unknown[], memberLower: string, limit = Infinity): AnonymiseResult {
  const names = new Map<string, string>([[memberLower.toLowerCase(), FIXTURE_MEMBER]]);
  const alias = (u: string) => {
    const k = u.toLowerCase();
    if (!names.has(k)) names.set(k, `opponent_${String(names.size).padStart(2, "0")}`);
    return names.get(k)!;
  };
  const dropped = new Set<string>();
  let liveId = 150_000_000_000;
  let dailyId = 1_050_000_000;
  const games: Record<string, unknown>[] = [];

  for (const raw of rawGames.slice(0, Number.isFinite(limit) ? limit : undefined)) {
    const g = structuredClone(raw) as Game;
    const real = [g.white.username, g.black.username];
    const fake = real.map(alias);
    const replaceNames = (s: string) =>
      real.reduce((acc, name, i) => acc.replace(new RegExp(`\\b${escapeRe(name)}\\b`, "gi"), fake[i]!), s);

    const daily = /\/game\/daily\//.test(g.url);
    const id = daily ? ++dailyId : (liveId += 7);
    const url = `https://www.chess.com/game/${daily ? "daily" : "live"}/${id}`;
    g.url = url;
    g.uuid = `00000000-0000-4000-a000-${String(id).padStart(12, "0").slice(-12)}`;
    for (const [side, i] of [
      ["white", 0],
      ["black", 1],
    ] as const) {
      const p = g[side];
      p.username = fake[i]!;
      if (p["@id"] !== undefined) p["@id"] = `https://api.chess.com/pub/player/${fake[i]}`;
      if (p.uuid !== undefined) p.uuid = `00000000-0000-4000-b000-${String(id * 2 + i).padStart(12, "0").slice(-12)}`;
    }
    if (g.match !== undefined) g.match = "https://api.chess.com/pub/match/0";
    if (g.tournament !== undefined) g.tournament = "https://api.chess.com/pub/tournament/fixture-0";

    const [head, ...rest] = g.pgn.split(/\r?\n\r?\n/);
    const headers = new Map<string, string>();
    for (const line of (head ?? "").split(/\r?\n/)) {
      const m = /^\[([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\]$/.exec(line.trim());
      if (m) headers.set(m[1]!, m[2]!);
    }
    for (const k of headers.keys()) if (!(PGN_HEADERS as readonly string[]).includes(k)) dropped.add(k);
    headers.set("White", fake[0]!);
    headers.set("Black", fake[1]!);
    headers.set("Link", url);
    headers.set("Event", daily ? "Let's Play!" : "Live Chess");
    if (headers.has("Termination")) headers.set("Termination", replaceNames(headers.get("Termination")!));
    const kept = PGN_HEADERS.filter((k) => headers.has(k)).map((k) => `[${k} "${headers.get(k)}"]`);
    g.pgn = `${kept.join("\n")}\n\n${rest.join("\n\n")}`;
    games.push(g);
  }
  return { games, droppedHeaders: [...dropped].sort() };
}
