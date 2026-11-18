// Opening families by ECO code (phase-06 plan §8.9): the weakness profile's Openings tab groups a member's games by
// family, not by the 500 single codes. A curated table of contiguous ranges that covers A00–E99 exactly once, so every
// stored `game_players."ecoCode"` falls in one family and two families never share a code (eco-families.test.ts).
//
// Names follow the CC0 lichess-org/chess-openings names (the TSVs served from apps/web/public/openings), coarsened to
// the families a club player recognises and written in British English as the design boards do ("Two Knights
// Defence C55–C59", "Queen’s Gambit Declined D30–D69", "Sicilian, Alapin B22", "London System D02"). Pure data and
// lookups; no I/O.

export interface EcoFamily {
  /** Display name (typographic apostrophe, British spelling). Unique across the table. */
  name: string;
  /** First ECO code of the range, inclusive. */
  from: string;
  /** Last ECO code of the range, inclusive (= from for a single code). */
  to: string;
}

/** Contiguous, ordered, non-overlapping ranges covering A00–E99. */
export const ECO_FAMILIES: readonly EcoFamily[] = [
  // A: flank openings, 1.d4 without 2.c4 … d5, Benoni, Dutch
  { name: "Uncommon Opening", from: "A00", to: "A00" },
  { name: "Nimzo-Larsen Attack", from: "A01", to: "A01" },
  { name: "Bird Opening", from: "A02", to: "A03" },
  { name: "Zukertort Opening", from: "A04", to: "A06" },
  { name: "King’s Indian Attack", from: "A07", to: "A08" },
  { name: "Réti Opening", from: "A09", to: "A09" },
  { name: "English Opening", from: "A10", to: "A19" },
  { name: "English, King’s English", from: "A20", to: "A29" },
  { name: "English, Symmetrical", from: "A30", to: "A39" },
  { name: "Queen’s Pawn, Uncommon", from: "A40", to: "A41" },
  { name: "Modern Defence, Averbakh", from: "A42", to: "A42" },
  { name: "Old Benoni Defence", from: "A43", to: "A44" },
  { name: "Trompowsky Attack", from: "A45", to: "A45" },
  { name: "Indian Defence, 2.Nf3", from: "A46", to: "A46" },
  { name: "Queen’s Indian, 2.Nf3 b6", from: "A47", to: "A47" },
  { name: "East Indian Defence", from: "A48", to: "A49" },
  { name: "Indian Defence, 2.c4", from: "A50", to: "A50" },
  { name: "Budapest Gambit", from: "A51", to: "A52" },
  { name: "Old Indian Defence", from: "A53", to: "A55" },
  { name: "Benoni Defence", from: "A56", to: "A56" },
  { name: "Benko Gambit", from: "A57", to: "A59" },
  { name: "Modern Benoni", from: "A60", to: "A79" },
  { name: "Dutch Defence", from: "A80", to: "A99" },
  // B: semi-open games other than the French
  { name: "King’s Pawn, Uncommon", from: "B00", to: "B00" },
  { name: "Scandinavian Defence", from: "B01", to: "B01" },
  { name: "Alekhine Defence", from: "B02", to: "B05" },
  { name: "Modern Defence", from: "B06", to: "B06" },
  { name: "Pirc Defence", from: "B07", to: "B09" },
  { name: "Caro-Kann Defence", from: "B10", to: "B11" },
  { name: "Caro-Kann, Advance", from: "B12", to: "B12" },
  { name: "Caro-Kann, Exchange", from: "B13", to: "B13" },
  { name: "Caro-Kann, Panov", from: "B14", to: "B14" },
  { name: "Caro-Kann, Main Line", from: "B15", to: "B19" },
  { name: "Sicilian Defence", from: "B20", to: "B20" },
  { name: "Sicilian, Smith-Morra and Grand Prix", from: "B21", to: "B21" },
  { name: "Sicilian, Alapin", from: "B22", to: "B22" },
  { name: "Sicilian, Closed", from: "B23", to: "B26" },
  { name: "Sicilian, 2.Nf3 Uncommon", from: "B27", to: "B29" },
  { name: "Sicilian, Rossolimo", from: "B30", to: "B31" },
  { name: "Sicilian, Kalashnikov", from: "B32", to: "B32" },
  { name: "Sicilian, Sveshnikov", from: "B33", to: "B33" },
  { name: "Sicilian, Accelerated Dragon", from: "B34", to: "B39" },
  { name: "Sicilian, 2…e6", from: "B40", to: "B40" },
  { name: "Sicilian, Kan", from: "B41", to: "B43" },
  { name: "Sicilian, Taimanov", from: "B44", to: "B49" },
  { name: "Sicilian, 2…d6", from: "B50", to: "B50" },
  { name: "Sicilian, Moscow", from: "B51", to: "B52" },
  { name: "Sicilian, Open 2…d6", from: "B53", to: "B55" },
  { name: "Sicilian, Classical", from: "B56", to: "B59" },
  { name: "Sicilian, Richter-Rauzer", from: "B60", to: "B69" },
  { name: "Sicilian, Dragon", from: "B70", to: "B79" },
  { name: "Sicilian, Scheveningen", from: "B80", to: "B85" },
  { name: "Sicilian, Sozin", from: "B86", to: "B89" },
  { name: "Sicilian, Najdorf", from: "B90", to: "B99" },
  // C: the French and the open games
  { name: "French Defence", from: "C00", to: "C00" },
  { name: "French, Exchange", from: "C01", to: "C01" },
  { name: "French, Advance", from: "C02", to: "C02" },
  { name: "French, Tarrasch", from: "C03", to: "C09" },
  { name: "French, Rubinstein", from: "C10", to: "C10" },
  { name: "French, Classical", from: "C11", to: "C14" },
  { name: "French, Winawer", from: "C15", to: "C19" },
  { name: "King’s Pawn Game", from: "C20", to: "C20" },
  { name: "Centre Game", from: "C21", to: "C22" },
  { name: "Bishop’s Opening", from: "C23", to: "C24" },
  { name: "Vienna Game", from: "C25", to: "C29" },
  { name: "King’s Gambit Declined", from: "C30", to: "C32" },
  { name: "King’s Gambit Accepted", from: "C33", to: "C39" },
  { name: "King’s Knight Opening", from: "C40", to: "C40" },
  { name: "Philidor Defence", from: "C41", to: "C41" },
  { name: "Petrov’s Defence", from: "C42", to: "C43" },
  { name: "Scotch Game", from: "C44", to: "C45" },
  { name: "Three Knights Opening", from: "C46", to: "C46" },
  { name: "Four Knights Game", from: "C47", to: "C49" },
  { name: "Italian Game", from: "C50", to: "C50" },
  { name: "Evans Gambit", from: "C51", to: "C52" },
  { name: "Giuoco Piano", from: "C53", to: "C54" },
  { name: "Two Knights Defence", from: "C55", to: "C59" },
  { name: "Ruy Lopez", from: "C60", to: "C64" },
  { name: "Ruy Lopez, Berlin", from: "C65", to: "C67" },
  { name: "Ruy Lopez, Exchange", from: "C68", to: "C69" },
  { name: "Ruy Lopez, Morphy Defence", from: "C70", to: "C79" },
  { name: "Ruy Lopez, Open", from: "C80", to: "C83" },
  { name: "Ruy Lopez, Closed", from: "C84", to: "C99" },
  // D: closed games (1.d4 d5) and the Grünfeld
  { name: "Queen’s Pawn Game", from: "D00", to: "D00" },
  { name: "Richter-Veresov Attack", from: "D01", to: "D01" },
  { name: "London System", from: "D02", to: "D02" },
  { name: "Torre Attack", from: "D03", to: "D03" },
  { name: "Colle System", from: "D04", to: "D05" },
  { name: "Queen’s Gambit", from: "D06", to: "D06" },
  { name: "Chigorin Defence", from: "D07", to: "D07" },
  { name: "Albin Countergambit", from: "D08", to: "D09" },
  { name: "Slav Defence", from: "D10", to: "D19" },
  { name: "Queen’s Gambit Accepted", from: "D20", to: "D29" },
  { name: "Queen’s Gambit Declined", from: "D30", to: "D69" },
  { name: "Neo-Grünfeld Defence", from: "D70", to: "D79" },
  { name: "Grünfeld Defence", from: "D80", to: "D99" },
  // E: Indian defences with 1.d4 Nf6 2.c4 e6 / g6
  { name: "Catalan Opening", from: "E00", to: "E09" },
  { name: "Indian Defence, 3.Nf3", from: "E10", to: "E10" },
  { name: "Bogo-Indian Defence", from: "E11", to: "E11" },
  { name: "Queen’s Indian Defence", from: "E12", to: "E19" },
  { name: "Nimzo-Indian Defence", from: "E20", to: "E31" },
  { name: "Nimzo-Indian, Classical", from: "E32", to: "E39" },
  { name: "Nimzo-Indian, Rubinstein", from: "E40", to: "E59" },
  { name: "King’s Indian Defence", from: "E60", to: "E61" },
  { name: "King’s Indian, Fianchetto", from: "E62", to: "E69" },
  { name: "King’s Indian, Normal", from: "E70", to: "E79" },
  { name: "King’s Indian, Sämisch", from: "E80", to: "E89" },
  { name: "King’s Indian, Classical", from: "E90", to: "E99" },
];

const ECO_RE = /^[A-E][0-9]{2}$/;

/** True for a code A00…E99 (upper case). */
export function isEcoCode(code: string | null | undefined): code is string {
  return typeof code === "string" && ECO_RE.test(code);
}

/** Ordinal 0…499 of a valid code (A00 = 0, E99 = 499). */
export function ecoOrdinal(code: string): number {
  if (!isEcoCode(code)) throw new RangeError(`invalid ECO code ${JSON.stringify(code)}`);
  return (code.charCodeAt(0) - 65) * 100 + Number(code.slice(1));
}

/** Code → family index, built once (500 entries). */
const BY_ORDINAL: readonly number[] = (() => {
  const out = new Array<number>(500).fill(-1);
  ECO_FAMILIES.forEach((f, i) => {
    for (let o = ecoOrdinal(f.from); o <= ecoOrdinal(f.to); o++) out[o] = i;
  });
  return out;
})();

/** The family of a stored ECO code; null for null, an empty string or anything that is not A00…E99. */
export function ecoFamily(code: string | null | undefined): EcoFamily | null {
  if (!isEcoCode(code)) return null;
  const i = BY_ORDINAL[ecoOrdinal(code)] ?? -1;
  return i >= 0 ? (ECO_FAMILIES[i] as EcoFamily) : null;
}

/** "C55–C59" (en dash), or "B22" for a single-code family (plan §8.9 `ecoRange`). */
export function ecoRange(f: Pick<EcoFamily, "from" | "to">): string {
  return f.from === f.to ? f.from : `${f.from}–${f.to}`;
}
