export interface FeaturedPosition {
  referenceId: string;
  fen: string;
  sideToMove: string;
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  tournamentName: string | null;
  positionType: string | null;
  positionContext: Record<string, unknown> | null;
}
