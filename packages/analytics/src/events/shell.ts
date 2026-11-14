// Shell events (SPEC §3.10, phase-01 plan §10.1). Sent by `trackShell()` in
// apps/web/lib/analytics/shell-events.ts. Each schema is a closed property set:
// `.strict()` rejects extra keys and every string is an enum, so no free text
// (query text, names, emails) can ride along.
import { z } from "zod";

/** Mirrors `DestinationKey` in apps/web/lib/shell/types.ts (SPEC §3.4). */
export const DESTINATION_KEYS = [
  "home",
  "play",
  "tournaments",
  "train",
  "learn",
  "legends",
  "openings",
  "review",
  "profile",
  "settings",
  // P5 (phase-05 plan §3.2): the Train sections.
  "train-today",
  "bank",
  "puzzles",
] as const;

export const NAV_SURFACES = ["sidebar", "rail", "tabbar", "subnav", "back", "palette", "chord"] as const;

export const ACCOUNT_ACTIONS = [
  "membership",
  "billing",
  "connected",
  "account",
  "theme",
  "install",
  "admin",
  "help",
  "privacy",
  "terms",
  "signout",
] as const;

export const shellEvents = {
  shell_nav_click: z
    .object({
      dest: z.enum(DESTINATION_KEYS),
      surface: z.enum(NAV_SURFACES),
    })
    .strict(),
  shell_palette_opened: z.object({ via: z.enum(["shortcut", "slash", "button"]) }).strict(),
  shell_palette_command: z
    .object({
      // A command id from lib/shell/palette.ts ("goto:play", "legend:<ref>"), never the typed query.
      id: z.string().regex(/^[a-z0-9][a-z0-9:_-]{0,63}$/i),
      group: z.enum(["goto", "actions", "legends"]),
      queryLength: z.number().int().min(0).max(500),
    })
    .strict(),
  shell_shortcuts_opened: z.object({ via: z.enum(["key", "palette"]) }).strict(),
  shell_shortcuts_toggled: z.object({ enabled: z.boolean() }).strict(),
  shell_account_action: z.object({ action: z.enum(ACCOUNT_ACTIONS) }).strict(),
} as const;

export type ShellEvents = typeof shellEvents;
export type ShellEventName = keyof ShellEvents;
