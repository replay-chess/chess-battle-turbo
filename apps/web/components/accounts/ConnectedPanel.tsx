"use client";

// /settings/connected, presentational (phase-04 plan §4.10; DR/V4SettingsConnected.dc.html, V4SettingsConnectedError,
// the `on_connected` pane of V4{iPhone,Android,iPadP,iPadL}Settings). Renders every board state from props: the
// wired screen (ConnectedScreen: queries, mutations, the socket) and the /dev/ui/connected demo (fixtures, simulated
// flows) pass the same props, so each of the ten states is reachable and looks the same in both.
import type { LinkedAccountView } from "@repo/contracts/http/accounts";
import type { ProviderSlug } from "@repo/contracts/http/p04-plain";
import type { RetryCountdownState } from "@/components/system/useRetryCountdown";
import { AccountCard } from "./AccountCard";
import { ChessComLinkForm, type ChessComFormError } from "./ChessComLinkForm";
import { ConnectedFrame } from "./ConnectedFrame";
import { LichessConnect, type LichessReturn } from "./LichessConnect";
import { panelModels } from "./model";

export type PerProvider<T> = Record<ProviderSlug, T>;

export type ConnectedPanelProps = {
  nowMs: number;
  chesscom: LinkedAccountView | null;
  lichess: LinkedAccountView | null;
  saved: boolean;
  profileHref: string | null;
  chrome?: "shell" | "marketing";
  /** The unlinked Chess.com card. */
  cc: {
    input: string;
    onInput: (value: string) => void;
    onSubmit: () => void;
    looking: boolean;
    error: ChessComFormError;
    countdown?: RetryCountdownState;
  };
  /** The unlinked Lichess card and the OAuth return. */
  li: { connecting: boolean; returned: LichessReturn; justLinked: boolean; onConnect: () => void };
  syncPending: PerProvider<boolean>;
  syncError: PerProvider<"paywall" | "failed" | null>;
  onSync: (provider: ProviderSlug) => void;
  onAutoImport: (provider: ProviderSlug, on: boolean) => void;
  confirmOpen: ProviderSlug | null;
  onConfirmOpen: (provider: ProviderSlug | null) => void;
  disconnectPending: ProviderSlug | null;
  disconnectError: { provider: ProviderSlug; message: string } | null;
  onDisconnect: (provider: ProviderSlug, deleteGames: boolean) => void;
};

export function ConnectedPanel(props: ConnectedPanelProps) {
  const { chesscom, lichess, state } = panelModels(props);
  const linkedProps = (provider: ProviderSlug) => ({
    avatarUrl: (provider === "chesscom" ? props.chesscom : props.lichess)?.avatarUrl ?? null,
    onSync: () => props.onSync(provider),
    syncError: props.syncError[provider],
    onAutoImport: (on: boolean) => props.onAutoImport(provider, on),
    confirmOpen: props.confirmOpen === provider,
    onConfirmOpenChange: (open: boolean) => props.onConfirmOpen(open ? provider : null),
    disconnectPending: props.disconnectPending === provider,
    disconnectError: props.disconnectError?.provider === provider ? props.disconnectError.message : null,
    onDisconnect: (deleteGames: boolean) => props.onDisconnect(provider, deleteGames),
  });
  return (
    <ConnectedFrame saved={props.saved} profileHref={props.profileHref} boardState={state} chrome={props.chrome}>
      <AccountCard
        model={chesscom}
        {...linkedProps("chesscom")}
        unlinked={
          <ChessComLinkForm
            value={props.cc.input}
            onChange={props.cc.onInput}
            onSubmit={props.cc.onSubmit}
            looking={props.cc.looking}
            error={props.cc.error}
            countdown={props.cc.countdown}
          />
        }
      />
      <AccountCard
        model={lichess}
        {...linkedProps("lichess")}
        unlinked={<LichessConnect connecting={props.li.connecting} returned={props.li.returned} onConnect={props.li.onConnect} />}
      />
    </ConnectedFrame>
  );
}
