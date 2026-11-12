// The phone top bar's title slot id, apart from TopBar.tsx: pages that portal into it (TopBarTitle) must not import
// TopBar, whose account menu (Clerk hooks, the menu primitives, the install dialog) would then join every such page's
// First Load JS (FIX-2: ~100 kB gzipped on /review, the comparison and /practice).
export const TOPBAR_TITLE_ID = "shell-topbar-title";
