// Layout class strings shared by the Weakness Profile components (phase-06 plan §4.3, §4.6). Written out in full so
// Tailwind's scanner sees every class.
//
// The device forms: desktop (sidebar; ≤ 1100 px the rail, `narrow:`), iPad landscape (rail by its coarse pointer, a
// landscape viewport wider than 900 px: 4 tabs, the week plan, no "Top 3" label, no strengths box), and the tab-bar
// form (`tabbar:`, phones and iPad portrait: one scrolling column, 4 tabs, no week plan, no strengths box).

/** iPad landscape only (not a narrow desktop window, not a phone on its side). */
export const IPAD_L_HIDDEN = "[@media(hover:none)_and_(pointer:coarse)_and_(orientation:landscape)_and_(min-width:901px)]:hidden";
export const IPAD_L_SR_ONLY = "[@media(hover:none)_and_(pointer:coarse)_and_(orientation:landscape)_and_(min-width:901px)]:sr-only";
/** The Strengths tab: phones, iPad portrait and iPad landscape. */
export const STR_TAB_SHOWN = "hidden tabbar:inline-flex [@media(hover:none)_and_(pointer:coarse)_and_(orientation:landscape)_and_(min-width:901px)]:inline-flex";
/** The media query matching where the Strengths tab is shown (for its `disabled`, so the arrows skip it elsewhere). */
export const STR_TAB_QUERY = "(max-width: 600px), (max-width: 900px) and (orientation: portrait), (hover: none) and (pointer: coarse) and (orientation: landscape) and (min-width: 901px)";
/** The tab-bar form (phones, iPad portrait): the drill opens as a bottom sheet. */
export const TABBAR_QUERY = "(max-width: 600px), (max-width: 900px) and (orientation: portrait)";
/** Desktop-only blocks (the strengths box). */
export const DESKTOP_ONLY = "tabbar:hidden [@media(hover:none)_and_(pointer:coarse)_and_(orientation:landscape)_and_(min-width:901px)]:hidden";
