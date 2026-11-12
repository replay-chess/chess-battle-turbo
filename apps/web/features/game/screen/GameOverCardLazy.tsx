"use client";

// The result card loads when a game ends (or with an ended game's first render), not with /game's first load: it is
// only on screen in the `result` phase, and the /game/[ref] budget (600 kB gz) has no room for it eagerly.
import dynamic from "next/dynamic";

export const GameOverCard = dynamic(() => import("./GameOverCard").then((m) => m.GameOverCard));
