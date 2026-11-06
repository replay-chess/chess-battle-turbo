"use client";

// React bindings for the tab's realtime connection (P2 plan 5.2.1): the connection state and the in-game auth
// status, read with useSyncExternalStore. Without RealtimeBoot (no singleton yet) both read their idle values.

import { useSyncExternalStore } from "react";
import { getRealtime, type AuthStatus, type ConnState } from "./connection";

const noop = () => () => {};
const IDLE: ConnState = "idle";
const AUTH_OK: AuthStatus = { kind: "ok" };

export function useConnection(): ConnState {
  const rt = getRealtime();
  return useSyncExternalStore(rt ? rt.subscribe : noop, rt ? rt.getState : () => IDLE, () => IDLE);
}

export function useAuthStatus(): AuthStatus {
  const rt = getRealtime();
  return useSyncExternalStore(rt ? rt.subscribe : noop, rt ? rt.getAuth : () => AUTH_OK, () => AUTH_OK);
}
