// The public share page's stylesheet, inlined into the page (phase-03 plan §4.4; FIX-2): the page is plain HTML from a
// route handler (route.ts), so it has no Tailwind classes, no layout CSS and no next/font. These rules reproduce the
// former page's Tailwind utilities (the same sizes, breakpoints and one-viewport layout), the DS tokens it used (light,
// and dark through the system preference: the page runs no theme script) and the app's three fonts from
// public/fonts/share (latin subsets, font-display: swap, never preloaded: nothing loads ahead of the first paint).
// share-css.test.ts keeps every token equal to app/globals.css.

/** The DS tokens this page uses, light and dark (app/globals.css `:root` and `.dark`). */
export const SHARE_TOKENS = {
  light: {
    "--cb-bg": "#FAF9F6",
    "--cb-surface": "#FFFFFF",
    "--cb-text": "#1A1A1A",
    "--cb-text-soft": "rgba(0,0,0,0.62)",
    "--cb-border": "rgba(0, 0, 0, 0.3)",
    "--cb-border-strong": "rgba(0,0,0,0.15)",
    "--cb-fill": "#f5f3f0",
    "--cb-accent": "#3D3229",
    "--cb-accent-fg": "#FFFFFF",
    "--cb-accent-hover": "#1a1a1a",
    "--cb-text-disabled": "rgba(0,0,0,0.4)",
    "--article-board-light": "#e9e2d4",
    "--article-board-dark": "#8f7865",
    "--article-board-last": "rgba(225, 184, 74, 0.42)",
    "--cb-bad": "#a3412e",
    "--mq-best": "#7d9d3e",
    "--mq-interesting": "#5b8bb5",
  },
  dark: {
    "--cb-bg": "#000000",
    "--cb-surface": "#0A0A0A",
    "--cb-text": "#FFFFFF",
    "--cb-text-soft": "rgba(255,255,255,0.62)",
    "--cb-border": "rgba(255, 255, 255, 0.35)",
    "--cb-border-strong": "rgba(255,255,255,0.2)",
    "--cb-fill": "#161616",
    "--cb-accent": "#FFFFFF",
    "--cb-accent-fg": "#000000",
    "--cb-accent-hover": "#d4d4d4",
    "--cb-text-disabled": "rgba(255,255,255,0.35)",
    "--article-board-light": "#d8cfbf",
    "--article-board-dark": "#68574a",
    "--article-board-last": "rgba(230, 188, 70, 0.42)",
    "--cb-bad": "#e07b63",
  },
} as const;

const vars = (t: Record<string, string>) =>
  Object.entries(t)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");

const SANS = `"Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif`;
const MONO = `"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace`;
const SERIF = `"Instrument Serif",Georgia,"Times New Roman",serif`;
/** The app's breakpoints (app/globals.css @custom-variant). */
const TABBAR = "(max-width:600px),(max-width:900px) and (orientation:portrait)";

export const SHARE_CSS = [
  `@font-face{font-family:"Geist";src:url(/fonts/share/geist-latin.woff2) format("woff2");font-weight:100 900;font-display:swap}`,
  `@font-face{font-family:"Geist Mono";src:url(/fonts/share/geist-mono-latin.woff2) format("woff2");font-weight:100 900;font-display:swap}`,
  `@font-face{font-family:"Instrument Serif";src:url(/fonts/share/instrument-serif-latin.woff2) format("woff2");font-weight:400;font-display:swap}`,
  `:root{${vars(SHARE_TOKENS.light)};color-scheme:light}`,
  `@media (prefers-color-scheme:dark){:root{${vars(SHARE_TOKENS.dark)};color-scheme:dark}}`,
  `*,*::before,*::after{box-sizing:border-box}`,
  `html,body{margin:0;height:100%}`,
  `body{background:var(--cb-bg);color:var(--cb-text);font:400 15px/1.5 ${SANS};-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}`,
  `a{color:inherit}`,
  `button{font:inherit;color:inherit}`,
  `:focus-visible{outline:2px solid var(--cb-text);outline-offset:2px}`,
  `.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}`,
  `.soft{color:var(--cb-text-soft)}`,
  `.mono{font-family:${MONO}}`,
  `.lbl{font:500 .6875rem/1.3 ${MONO};letter-spacing:.12em;text-transform:uppercase;color:var(--cb-text-soft)}`,
  `.page{display:flex;flex-direction:column;height:100vh;height:100dvh;overflow:hidden;background:var(--cb-bg);color:var(--cb-text)}`,
  `.nav{display:flex;flex-shrink:0;align-items:center;gap:28px;height:64px;padding:0 32px;border-bottom:1px solid var(--cb-border);background:color-mix(in srgb,var(--cb-bg) 85%,transparent)}`,
  `.brand{display:flex;align-items:center;gap:10px;min-height:44px;min-width:44px;color:var(--cb-text);text-decoration:none;-webkit-tap-highlight-color:transparent}`,
  `.brand img{width:36px;height:36px;flex-shrink:0}`,
  `.wordmark{font:400 1.25rem/1.75rem ${SERIF};letter-spacing:-.025em}`,
  `.navlink{display:inline-flex;align-items:center;min-height:44px;text-decoration:none}`,
  `.navlink:hover{color:var(--cb-text)}`,
  `.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;min-height:44px;padding:0 18px;border-radius:0;background:var(--cb-accent);color:var(--cb-accent-fg);font:500 .875rem/1.25 ${SANS};text-decoration:none;cursor:pointer;user-select:none;transition:background-color .15s;-webkit-tap-highlight-color:transparent}`,
  `.btn:hover{background:var(--cb-accent-hover)}`,
  `.nav .btn{margin-left:auto;min-height:36px}`,
  `@media (pointer:coarse){.nav .btn{min-height:44px}}`,
  `main{display:flex;flex:1;flex-direction:column;min-height:0}`,
  `.foot{display:flex;flex-shrink:0;align-items:center;gap:18px;height:40px;padding:0 32px;border-top:1px solid var(--cb-border);font-size:.75rem;color:var(--cb-text-soft)}`,
  `.foot a{display:inline-flex;align-items:center;min-height:40px;color:var(--cb-text-soft);text-decoration:none}`,
  `.foot a:hover{color:var(--cb-text)}`,
  // The two columns: the game (board, players, stepper) and the review panel (the only scroller).
  `.body{--board:min(560px,calc(100dvh - 280px),calc(100vw - 600px));display:grid;flex:1;min-height:0;grid-template-columns:auto minmax(320px,440px);align-items:center;justify-content:center;gap:56px;padding:24px 32px}`,
  `.game{display:flex;flex-direction:column;gap:8px;min-width:0}`,
  `.players{display:flex;justify-content:space-between;gap:12px;width:100%;max-width:var(--board);margin:0 auto;font-size:.875rem}`,
  `.player{display:flex;align-items:baseline;gap:8px;min-width:0}`,
  `.player .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
  `.player .sub{font:400 .75rem/1 ${MONO};color:var(--cb-text-soft)}`,
  `.stepper{display:flex;flex-direction:column;gap:8px;min-width:0}`,
  `.boardbox{position:relative;width:var(--board);max-width:100%;aspect-ratio:1/1;margin:0 auto;border:1px solid var(--cb-border);background:var(--cb-surface)}`,
  `.board-svg{display:block;width:100%;height:100%;user-select:none}`,
  `.controls{display:flex;align-items:center;gap:8px;width:100%;max-width:var(--board);margin:0 auto}`,
  `.step{display:inline-flex;flex-shrink:0;align-items:center;justify-content:center;width:44px;height:44px;border:1px solid var(--cb-border-strong);background:var(--cb-surface);color:var(--cb-text);cursor:pointer}`,
  `.step:hover{background:var(--cb-fill)}`,
  `.step:disabled{cursor:not-allowed;color:var(--cb-text-disabled)}`,
  `.position{flex:1;min-width:0;margin:0;overflow:hidden;text-align:center;text-overflow:ellipsis;white-space:nowrap;font:400 .875rem/1.25rem ${MONO}}`,
  `.strip{display:flex;gap:4px;width:100%;max-width:var(--board);margin:0 auto;padding:0 0 4px;list-style:none;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin}`,
  `.strip li{flex-shrink:0}`,
  `.strip button{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 8px;border:1px solid var(--cb-border);background:var(--cb-surface);font:400 .75rem/1 ${MONO};white-space:nowrap;color:var(--cb-text);cursor:pointer}`,
  `.strip button:hover{background:var(--cb-fill)}`,
  `.strip button[aria-current="true"]{border-color:var(--cb-accent);background:var(--cb-accent);color:var(--cb-accent-fg)}`,
  `.strip img,.glyph{width:16px;height:16px;flex-shrink:0}`,
  `.glyph{display:inline-flex;align-items:center;justify-content:center;border-radius:9999px;background:var(--mq-interesting);color:#fff;font:700 8px/1 ${MONO}}`,
  `.facts{position:relative;display:flex;flex-direction:column;gap:16px;min-width:0;max-height:100%;min-height:0;padding:24px;overflow-y:auto;overscroll-behavior:contain;border:1px solid var(--cb-border);background:var(--cb-surface)}`,
  `.facts h1,.notice h1{margin:0;font:400 2.25rem/1.05 ${SERIF};letter-spacing:-.01em}`,
  `.meta{margin:0;font:400 .75rem/1rem ${MONO};color:var(--cb-text-soft)}`,
  `.acc{display:flex;align-items:flex-end;gap:16px}`,
  `.acc .num{display:flex;flex-direction:column}`,
  `.acc .big{font:400 2.5rem/1 ${MONO}}`,
  `.acc .opp{padding-bottom:2px;font:400 .75rem/1rem ${MONO};color:var(--cb-text-soft)}`,
  `.moment{margin:0;padding-left:12px;border-left:2px solid var(--cb-accent);font-size:.9375rem;line-height:1.5}`,
  `.summary{display:flex;flex-direction:column;gap:8px}`,
  `.summary p{margin:0;font-size:.9375rem;line-height:1.5}`,
  `.cta{display:flex;flex-direction:column;align-items:flex-start;gap:12px;margin-top:auto;padding-top:16px;border-top:1px solid var(--cb-border)}`,
  `.cta p{margin:0;font-size:.9375rem;line-height:1.5;color:var(--cb-text-soft)}`,
  `.notice{display:flex;flex:1;align-items:center;justify-content:center;min-height:0;padding:24px;overflow-y:auto}`,
  `.notice>div{display:flex;flex-direction:column;align-items:flex-start;gap:16px;max-width:520px}`,
  `.notice p{margin:0;font-size:.9375rem;line-height:1.5;color:var(--cb-text-soft)}`,
  // narrow (≤ 1100 px wide), vh700 / vh640 (short screens), then the tab-bar layout (phones, iPad portrait).
  `@media (max-width:1100px){.nav{gap:18px;padding:0 20px}.body{gap:32px;padding:24px 20px}}`,
  `@media (max-width:600px){.wordmark{display:none}}`,
  `@media (max-height:700px){.body{padding-top:12px;padding-bottom:12px;--board:min(560px,calc(100dvh - 210px),calc(100vw - 560px))}.foot{display:none}}`,
  `@media (max-height:640px){.nav{height:48px}.brand img{width:28px;height:28px}}`,
  `@media ${TABBAR}{.nav{height:56px;gap:12px;padding:0 16px}.foot{display:none}.body{display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;gap:12px;padding:12px 16px;--board:min(calc(100vw - 32px),44dvh)}.game{flex-shrink:0}.bottom-player{display:none}.facts{flex:1;padding:16px}.facts h1{font-size:1.75rem}}`,
].join("\n");
