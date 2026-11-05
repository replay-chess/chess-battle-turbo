// Expected shell mode for a CSS viewport (SPEC 2.2, 10.6). Pure, so modes.test.ts
// can run it under node:test. `touchShell` is matchMedia(COARSE_MQ), read from the
// page after load (04 §8.2: WebKit's iPad emulation reports a coarse pointer).
export type ShellMode = "sidebar" | "rail" | "tabbar";

export function expectedShellMode(vw: number, vh: number, touchShell: boolean): ShellMode {
  const portrait = vh >= vw;
  if (vw <= 600 || (vw <= 900 && portrait)) return "tabbar";
  if (vw <= 1100 || touchShell) return "rail";
  return "sidebar";
}

/** Nav column width per mode (SPEC 2.2). */
export const NAV_WIDTH: Record<Exclude<ShellMode, "tabbar">, number> = { sidebar: 220, rail: 64 };
