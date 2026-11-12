// The toast library on demand (FIX-2). `sonner` (~9 kB gzipped) is rendered by the root layout's Toaster, but a page
// that only *raises* a toast now and then (an error with a Retry) need not carry the library in its own first load:
// the call imports it when it happens (the chunk is already loaded by the Toaster by then, so it costs nothing).
type Toast = typeof import("sonner").toast;

/** Runs `fn` with sonner's `toast` (a no-op if the chunk cannot load: a toast never breaks the screen). */
export function withToast(fn: (toast: Toast) => void, importer: () => Promise<{ toast: Toast }> = () => import("sonner")): Promise<void> {
  return importer()
    .then((m) => fn(m.toast))
    .catch(() => undefined);
}
