/** Presets of /dev/ui/board, shared by the server page and the client demo. */
export const BOARD_PRESETS = ["start", "promotion", "check", "castle", "enpassant", "premove", "study", "badges", "arrows"] as const;
export type BoardPreset = (typeof BOARD_PRESETS)[number];

export const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const PRESET_FEN: Record<BoardPreset, string> = {
  start: START,
  promotion: "8/1P3k2/8/5p2/8/4K1P1/8/1r6 w - - 0 41",
  check: "rnbqk1nr/pppp1ppp/8/4p3/1b1PP3/8/PPP2PPP/RNBQKBNR w KQkq - 1 3",
  castle: "r3k2r/pppqbppp/2np1n2/4p3/4P3/2NP1N2/PPPQBPPP/R3K2R w KQkq - 0 1",
  enpassant: "4k3/8/8/3Pp3/8/8/8/4K3 w - e6 0 2",
  premove: START,
  study: "r1b1kb1r/p2nqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR3R w kq - 0 11",
  badges: "r1b1kb1r/p2nqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR3R w kq - 0 11",
  arrows: START,
};
export const PRESET_LABEL: Record<BoardPreset, string> = {
  start: "Start",
  promotion: "Promotion",
  check: "Check",
  castle: "Castling",
  enpassant: "En Passant",
  premove: "Premove",
  study: "Study (Locked)",
  badges: "Badges",
  arrows: "Arrows",
};
