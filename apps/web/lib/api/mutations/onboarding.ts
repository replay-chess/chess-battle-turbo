"use client";
// Onboarding mutations (phase-04 plan §5.2, §5.5): ME-4 `PATCH /api/me/onboarding`.
//
// - useOnboardingStep().advance(page, fields?): writes the step's fields into `qk.me().onboarding` at once, sends the
//   PATCH (lowercase wire values, D4-25; `retry: 3` at 1 s / 3 s / 9 s: safe, the write is monotonic and idempotent)
//   and navigates. Navigation waits for the PATCH at most ADVANCE_WAIT_MS: the next page's server guard reads the
//   stored step, so a navigation that beat the write by a few ms would bounce back through the resolver. The common
//   case (≈ 100–200 ms) feels instant; a slow or failing save never holds the user longer than the cap. A save that
//   still fails after its retries shows "Couldn't save. We'll retry." and the resolver re-derives the step on the next
//   load. The first PATCH of a tab carries `timeZone` when the browser's zone differs from `me.user.timeZone`.
// - useCompleteOnboarding(): `{complete: true}`, not optimistic. On 200 the Clerk session is reloaded (the JWT then
//   carries `onboarded`; until then the server's rc_onb cookie covers the lag). On 409 `plan_required` → the plan.
//
// `meta.errorUi = "inline"` on both: the screens own their error copy, so the global mutation toast never fires.
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { MeData } from "@repo/contracts/http/me";
import type { OnboardingView, PatchOnboardingBody, PatchOnboardingData } from "@repo/contracts/http/onboarding";
import { PatchOnboardingData as PatchOnboardingSchema } from "@repo/contracts/http/onboarding";
import { reloadClerkSession } from "@/lib/billing/client";
import { stepPath, type OnbPage } from "@/lib/onboarding/steps";
import { api } from "../client";
import { endpoints } from "../endpoints";
import { isApiError } from "../errors";
import { qk } from "../keys";

/** Longest a step navigation waits for its PATCH. */
export const ADVANCE_WAIT_MS = 1_500;
/** Retry delays of a failed step PATCH (§5.2). */
export const PATCH_RETRY_DELAYS_MS = [1_000, 3_000, 9_000] as const;

export const SAVE_FAILED_COPY = "Couldn't save. We'll retry.";

export type StepFields = Omit<PatchOnboardingBody, "step" | "complete" | "timeZone">;

/** ME-4 over api(); the response schema is parsed in dev and test only (AP-12). */
export async function patchOnboarding(body: PatchOnboardingBody, signal?: AbortSignal): Promise<PatchOnboardingData> {
  const { data } = await api(endpoints.meOnboarding, {
    method: "PATCH",
    body,
    signal,
    schema: process.env.NODE_ENV === "production" ? undefined : PatchOnboardingSchema,
  });
  return data as PatchOnboardingData;
}

/** The browser's IANA zone, or null (old engines, privacy modes that hide it). */
export function browserTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" && tz.length > 0 && tz.length <= 64 ? tz : null;
  } catch {
    return null;
  }
}

let zoneSent = false;

/** `timeZone` for this PATCH: only on the first PATCH of the tab, and only when it differs from the stored zone. */
export function zoneToSend(stored: string | undefined, browser: string | null = browserTimeZone()): string | undefined {
  if (zoneSent || !browser) return undefined;
  zoneSent = true;
  return browser !== (stored ?? "UTC") ? browser : undefined;
}

/** Test seam. */
export function resetZoneSentForTests(): void {
  zoneSent = false;
}

/** Writes an onboarding view (and the zone) into `qk.me()`. */
export function writeMeOnboarding(qc: QueryClient, view: Partial<OnboardingView>, timeZone?: string): void {
  qc.setQueryData<MeData>(qk.me(), (me) => {
    if (!me) return me;
    const onboarding = me.onboarding ? { ...me.onboarding, ...view } : undefined;
    return {
      ...me,
      ...(onboarding ? { onboarding } : {}),
      user: {
        ...me.user,
        ...(view.done !== undefined ? { onboarded: view.done } : {}),
        ...(timeZone ? { timeZone } : {}),
      },
    };
  });
}

/** The optimistic part of a step PATCH: the fields the server will store (the step only moves forward). */
export function optimisticView(current: OnboardingView | undefined, page: OnbPage, fields: StepFields): Partial<OnboardingView> {
  const order = ["welcome", "link", "confirm", "level", "goals", "plan", "activating", "done"] as const;
  const view: Partial<OnboardingView> = {};
  if (!current || order.indexOf(page) > order.indexOf(current.step)) view.step = page;
  if (fields.ratingBand !== undefined) view.ratingBand = fields.ratingBand;
  if (fields.ratingBandSource !== undefined) view.ratingBandSource = fields.ratingBandSource;
  if (fields.initialRating !== undefined) view.initialRating = fields.initialRating;
  if (fields.goals !== undefined) view.goals = fields.goals;
  if (fields.dailyMinutes !== undefined) view.dailyMinutes = fields.dailyMinutes;
  return view;
}

/** Network failures, 429 and 5xx are worth retrying; any other 4xx answers the same again. */
export function retryable(err: unknown): boolean {
  if (!isApiError(err)) return true;
  return err.status === 0 || err.status === 429 || err.status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type Advance = (page: Exclude<OnbPage, "done">, fields?: StepFields, opts?: { href?: string; replace?: boolean }) => Promise<void>;

/** `advance(page, fields?)`: save the step and go to it (§5.2). */
export function useOnboardingStep(): { advance: Advance; isSaving: boolean } {
  const qc = useQueryClient();
  const router = useRouter();
  const mutation = useMutation({
    mutationFn: (body: PatchOnboardingBody) => patchOnboarding(body),
    retry: (failures, err) => failures < PATCH_RETRY_DELAYS_MS.length && retryable(err),
    retryDelay: (attempt) => PATCH_RETRY_DELAYS_MS[Math.min(attempt, PATCH_RETRY_DELAYS_MS.length - 1)]!,
    meta: { errorUi: "inline" },
    onSuccess: (data) => writeMeOnboarding(qc, data.onboarding, data.timeZone),
    onError: (err) => {
      // A 4xx other than 429 will not succeed on retry; either way the resolver re-derives the step next load.
      if (isApiError(err) && err.code === "unauthorized") return; // the session flow handles it
      // The toast module on demand (FIX-2, plan §9.6: the steps' first load carries no toast library).
      void import("@/components/ui/toast").then((m) => m.notify.error(SAVE_FAILED_COPY, { id: "onb-save" })).catch(() => {});
    },
  });

  const advance: Advance = async (page, fields = {}, opts = {}) => {
    const me = qc.getQueryData<MeData>(qk.me());
    writeMeOnboarding(qc, optimisticView(me?.onboarding, page, fields));
    const body: PatchOnboardingBody = { step: page, ...fields };
    const tz = zoneToSend(me?.user.timeZone);
    if (tz) body.timeZone = tz;
    const saved = mutation.mutateAsync(body).then(
      () => undefined,
      () => undefined,
    );
    await Promise.race([saved, sleep(ADVANCE_WAIT_MS)]);
    const href = opts.href ?? stepPath(page);
    if (opts.replace) router.replace(href);
    else router.push(href);
  };

  return { advance, isSaving: mutation.isPending };
}

/** `{complete: true}` (Done; the resolver's claim refresh). */
export function useCompleteOnboarding() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: (body: { timeZone?: string } = {}) => patchOnboarding({ complete: true, ...body }),
    meta: { errorUi: "inline" },
    onSuccess: async (data) => {
      writeMeOnboarding(qc, data.onboarding, data.timeZone);
      // The loaded Clerk (window.Clerk, set by the root layout's ClerkProvider): no `@clerk/nextjs` import in the
      // step chunks (plan §9.6 budgets, FIX-1). Never throws: rc_onb covers the claim lag for 120 s.
      await reloadClerkSession();
    },
    onError: (err) => {
      if (isApiError(err) && err.code === "conflict" && err.details?.reason === "plan_required") {
        router.replace(stepPath("plan"));
      }
    },
  });
}
