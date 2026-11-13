"use client";

// Shared navigation of the onboarding frame (phase-04 plan §4.0 "Shared interactions"):
// - the current page (the (flow) layout's selected segment) and its back target: the page's own (`<OnbBack>`, e.g.
//   Level → the linked account's confirm URL) or the previous step;
// - Alt+← goes back with router.push (never history.back(): deep links have no history); ignored while typing in a
//   field, where Alt/Option+← moves the caret by word;
// - after each step navigation, focus moves to the step's h1 (`[data-onb-h1]`, tabIndex −1), so keyboard and screen
//   reader users start at the top of the new step (useFocusOnRouteChange), unless the step focused a control of its
//   own first (Link's cleared field after Not Me);
// - Enter submits the step's primary action from wherever the focus is not a control (submitStepOnEnter, FIX-1).
import { createContext, use, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { usePathname, useRouter, useSelectedLayoutSegment } from "next/navigation";
import { defaultBackPage, isOnbPage, stepPath, type OnbPage } from "@/lib/onboarding/steps";

type Override = { page: OnbPage | null; href: string | null };

type NavState = {
  page: OnbPage | null;
  /** The back target (href), or null when there is none (welcome, done). */
  back: string | null;
  /** A state setter (stable identity): `<OnbBack>` registers its page's target. */
  register: Dispatch<SetStateAction<Override | null>>;
  /** /dev/ui demo: Sign out and the keyboard back do nothing. */
  demo: boolean;
};

const NavContext = createContext<NavState>({ page: null, back: null, register: () => {}, demo: false });

export function useOnbNav(): NavState {
  return use(NavContext);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (target as HTMLInputElement).type;
  return !["button", "checkbox", "radio", "submit", "reset"].includes(type);
}

/** The focus sits on a control of the current step (not the page, not the h1, not the shared header). */
export function stepOwnsFocus(active: Element | null): boolean {
  if (!active || active === document.body || active === document.documentElement) return false;
  if (active.matches("[data-onb-h1], .onb-panel h1[tabindex='-1']")) return false;
  return active.closest(".onb-stage") !== null;
}

const INTERACTIVE =
  'a[href], button, input, select, textarea, summary, [contenteditable=""], [contenteditable="true"], ' +
  '[role="button"], [role="link"], [role="radio"], [role="checkbox"], [role="switch"], [role="tab"], [role="option"], ' +
  '[role="menuitem"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="textbox"]';

/**
 * Enter "submits the primary action" (plan §4.0, §4.3 "Enter = That's Me", §4.4, §4.6): from wherever the focus lands
 * that is not a control itself (the page on a first load, the h1 after a step navigation, the stage's text), Enter
 * submits the step's form exactly as the browser's implicit submission would from a field. Never from a control (a
 * button or link activates itself; a radio group has its own rule, submit-on-enter.ts), inside a dialog, or when the
 * form's submit button is disabled. Returns the form it submitted (tests), else null. FIX-1.
 */
export function submitStepOnEnter(e: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "isComposing" | "defaultPrevented" | "target">): HTMLFormElement | null {
  if (e.key !== "Enter" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing || e.defaultPrevented) return null;
  const target = e.target instanceof Element ? e.target : null;
  if (target && target !== document.body && target !== document.documentElement) {
    if (target.closest(INTERACTIVE) || target.closest('[role="dialog"], [role="alertdialog"], dialog, [role="menu"]')) return null;
    if (!target.closest(".onb-stage")) return null;
  }
  const form =
    (target?.closest<HTMLFormElement>(".onb-stage form.onb-form") ?? null) ||
    document.querySelector<HTMLFormElement>(".onb-stage form.onb-form");
  if (!form) return null;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"], input[type="submit"]');
  if (!submit || submit.disabled) return null;
  form.requestSubmit(submit);
  return form;
}

/** Focus the step's h1 after a client navigation (not on the first load: the browser starts at the top anyway). */
export function useFocusOnRouteChange(): void {
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let frame = 0;
    let tries = 0;
    const focus = () => {
      // A step that already put the focus on one of its own controls keeps it (Link after Not Me / not_found: the
      // cleared username field, plan §4.3; FIX-1: this frame used to move it back to the h1).
      if (stepOwnsFocus(document.activeElement)) return;
      // The step's own h1, or a shared card's (the Activating step's ActivationCard heading, tabIndex −1).
      const h1 = document.querySelector<HTMLElement>("[data-onb-h1], .onb-panel h1[tabindex='-1']");
      if (h1) {
        h1.focus({ preventScroll: true });
        return;
      }
      if (++tries < 10) frame = requestAnimationFrame(focus);
    };
    frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [pathname]);
}

export function OnbNavProvider({ children, page: fixedPage, demo = false }: { children: React.ReactNode; page?: OnbPage; demo?: boolean }) {
  // The (flow) layout's selected segment; the /dev/ui demo routes pass the page they render.
  const segment = useSelectedLayoutSegment();
  const page = fixedPage ?? (isOnbPage(segment) ? segment : null);
  const router = useRouter();
  const [override, register] = useState<Override | null>(null);

  const fallback = page ? defaultBackPage(page) : null;
  const back = override && override.page === page ? override.href : fallback ? stepPath(fallback) : null;

  useFocusOnRouteChange();

  useEffect(() => {
    if (!back || demo) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.key !== "ArrowLeft" || e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      e.preventDefault();
      router.push(back);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, demo, router]);

  useEffect(() => {
    const onEnter = (e: KeyboardEvent) => {
      if (submitStepOnEnter(e)) e.preventDefault();
    };
    window.addEventListener("keydown", onEnter);
    return () => window.removeEventListener("keydown", onEnter);
  }, []);

  return <NavContext value={{ page, back, register, demo }}>{children}</NavContext>;
}

/** A page's own back target (rendered by the page; nothing visible). `null` = no back on this page. */
export function OnbBack({ href }: { href: string | null }) {
  const { register, page } = useOnbNav();
  useEffect(() => {
    register({ page, href });
    return () => register(null);
  }, [register, page, href]);
  return null;
}
