"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  ArrowRight,
  ArrowUpRight,
  Ban,
  CalendarClock,
  CreditCard,
  LifeBuoy,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/lib/stores";
import type { StoreSubscription } from "@/lib/stores";
import {
  BILLING_PLANS,
  PLAN_NAME,
  describePlanPrice,
  formatPrice,
  monthlyEquivalentCents,
  yearlySavings,
  type PlanKey,
} from "@/lib/billing/plans";
import type { EntitlementSummary } from "@/lib/billing/entitlement-rules";
import {
  CANCELLATION_FEEDBACK_LABELS,
  CANCELLATION_FEEDBACK_VALUES,
  availablePlanChanges,
  formatMembershipDate,
  formatMinorUnits,
  mergeEntitlementIntoStore,
  type CancellationFeedbackValue,
  type CurrentPlanKey,
  type PlanChange,
  type PlanChangePreview,
} from "@/lib/billing/subscription-action-rules";
import { MembershipModal } from "./MembershipModal";

const EASE = [0.22, 1, 0.36, 1] as const;
const SUPPORT_EMAIL = "hello@playchess.tech";
const SAVINGS = yearlySavings();
const YEARLY_PER_MONTH = formatPrice(monthlyEquivalentCents(BILLING_PLANS.yearly));
const SANS = { fontFamily: "'Geist', sans-serif" } as const;
const SERIF = { fontFamily: "'Instrument Serif', serif" } as const;
const MONO = { fontFamily: "'Geist Mono', monospace" } as const;

/** What the section needs from the store, flattened. */
interface MembershipView {
  entitled: boolean;
  planKey: CurrentPlanKey;
  interval: "month" | "year" | null;
  priceCents: number | null;
  status: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  customerId: string | undefined;
}

function viewFromStore(subscription: StoreSubscription | null): MembershipView {
  const details = subscription?.subscription;
  return {
    entitled: subscription?.entitled ?? subscription?.plan === "player",
    planKey: details?.planKey ?? null,
    interval: details?.interval ?? null,
    priceCents: details?.priceCents ?? null,
    status: details?.status ?? subscription?.status ?? null,
    periodEnd: subscription?.currentPeriodEnd ?? details?.nextBillingDate ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    customerId: subscription?.customerId,
  };
}

interface ScheduledChange {
  productId: string;
  planKey: CurrentPlanKey;
  effectiveAt: string;
}

interface ActionResponse {
  entitlement?: EntitlementSummary;
  message?: string;
  scheduledChange?: ScheduledChange | null;
  paymentLink?: string | null;
  error?: string;
  code?: string;
}

class ApiError extends Error {
  code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

async function requestJson<T extends { error?: string; code?: string }>(
  url: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: unknown },
): Promise<T> {
  const res = await fetch(url, {
    method: init.method,
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) {
    throw new ApiError(
      typeof data.error === "string" && data.error ? data.error : res.statusText || "Request failed",
      data.code,
    );
  }
  return data;
}

type Modal = { kind: "change"; change: PlanChange } | { kind: "cancel" } | null;

export function MembershipSection() {
  const subscription = useUserStore((s) => s.subscription);
  const fetchSubscription = useUserStore((s) => s.fetchSubscription);
  const requested = useRef(false);
  const rootRef = useRef<HTMLElement>(null);

  const [modal, setModal] = useState<Modal>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [scheduledChange, setScheduledChange] = useState<ScheduledChange | null>(null);
  const [preview, setPreview] = useState<PlanChangePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [feedback, setFeedback] = useState<CancellationFeedbackValue | "">("");
  const [comment, setComment] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);

  const view = viewFromStore(subscription);
  const busy = pending !== null;

  // The store only knows about the subscription once something fetched it.
  useEffect(() => {
    if (subscription === null && !requested.current) {
      requested.current = true;
      void fetchSubscription();
    }
  }, [subscription, fetchSubscription]);

  // A scheduled downgrade is not part of the entitlement summary.
  useEffect(() => {
    if (!view.entitled || view.planKey !== "yearly") return;
    let cancelled = false;
    requestJson<{ scheduledChange?: ScheduledChange | null; error?: string }>(
      "/api/subscription/change-plan",
      { method: "GET" },
    )
      .then((data) => {
        if (!cancelled) setScheduledChange(data.scheduledChange ?? null);
      })
      .catch(() => {
        // Not worth surfacing: the section still works without it.
      });
    return () => {
      cancelled = true;
    };
  }, [view.entitled, view.planKey]);

  // The profile loads asynchronously, so the browser's own hash scroll fires
  // before this section exists.
  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== "#membership") return;
    const timer = window.setTimeout(() => {
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 250);
    return () => window.clearTimeout(timer);
  }, []);

  function applyResponse(data: ActionResponse) {
    if (data.entitlement) {
      const current = useUserStore.getState().subscription;
      useUserStore.getState().setSubscription(mergeEntitlementIntoStore(current, data.entitlement));
    }
    if (data.scheduledChange !== undefined) {
      setScheduledChange(data.scheduledChange);
    }
    // Reconcile customer/product IDs that the entitlement does not carry.
    void fetchSubscription();
  }

  function describeError(err: unknown): string {
    return err instanceof Error && err.message ? err.message : "Something went wrong. Please try again.";
  }

  async function runAction(
    id: string,
    request: () => Promise<ActionResponse>,
    options: { successToast?: string; closeModal?: boolean } = {},
  ) {
    setPending(id);
    setModalError(null);
    try {
      const data = await request();
      applyResponse(data);
      if (data.paymentLink) {
        window.open(data.paymentLink, "_blank", "noopener,noreferrer");
        toast.info("Complete the payment in the new tab to finish switching plans.");
      } else {
        toast.success(options.successToast ?? data.message ?? "Done");
      }
      if (options.closeModal !== false) closeModal();
    } catch (err) {
      if (err instanceof ApiError && err.code === "refresh_failed") {
        // The change went through; the follow-up read did not.
        toast.success("Change saved. Refreshing your membership…");
        void fetchSubscription();
        closeModal();
      } else if (modal) {
        setModalError(describeError(err));
      } else {
        toast.error(describeError(err));
      }
    } finally {
      setPending(null);
    }
  }

  function closeModal() {
    setModal(null);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setModalError(null);
    setFeedback("");
    setComment("");
  }

  async function loadPreview(target: PlanKey) {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const data = await requestJson<PlanChangePreview & { error?: string }>(
        "/api/subscription/change-plan/preview",
        { method: "POST", body: { plan: target } },
      );
      setPreview(data);
    } catch (err) {
      setPreviewError(describeError(err));
    } finally {
      setPreviewLoading(false);
    }
  }

  function openChange(change: PlanChange) {
    setModalError(null);
    setModal({ kind: "change", change });
    if (change.kind === "upgrade") void loadPreview(change.target);
  }

  function confirmChange(change: PlanChange) {
    void runAction(`change:${change.target}`, () =>
      requestJson<ActionResponse>("/api/subscription/change-plan", {
        method: "POST",
        body: { plan: change.target },
      }),
    );
  }

  function confirmCancel() {
    void runAction("cancel", () =>
      requestJson<ActionResponse>("/api/subscription/cancel", {
        method: "POST",
        body: {
          ...(feedback ? { feedback } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        },
      }),
    );
  }

  function resume() {
    void runAction("resume", () =>
      requestJson<ActionResponse>("/api/subscription/resume", { method: "POST" }),
    );
  }

  function keepCurrentPlan() {
    void runAction("keep", () =>
      requestJson<ActionResponse>("/api/subscription/change-plan", { method: "DELETE" }),
    );
  }

  const portalHref = view.customerId
    ? `/api/customer-portal?customer_id=${encodeURIComponent(view.customerId)}`
    : "/api/customer-portal";

  // Loading: the store has not answered yet.
  if (subscription === null) {
    return (
      <section id="membership" ref={rootRef} className="scroll-mt-24" data-testid="membership-section">
        <div className="border border-cb-border bg-cb-hover p-6 flex items-center gap-3">
          <Loader2 className="w-4 h-4 text-cb-text-muted animate-spin" />
          <p style={SANS} className="text-xs tracking-[0.2em] uppercase text-cb-text-muted">
            Loading membership
          </p>
        </div>
      </section>
    );
  }

  if (!view.entitled) {
    return (
      <section id="membership" ref={rootRef} className="scroll-mt-24" data-testid="membership-section">
        <a
          href="/pricing"
          data-testid="membership-upsell"
          className="group block border border-cb-border bg-cb-hover hover:border-cb-border-strong transition-colors p-6 sm:p-8"
        >
          <p style={SANS} className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-4">
            Membership
          </p>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <h2 style={SERIF} className="text-3xl sm:text-4xl text-cb-text mb-1">
                {PLAN_NAME} plan
              </h2>
              <p style={SANS} className="text-sm text-cb-text-muted">
                from{" "}
                <span style={SERIF} className="text-lg text-cb-text-secondary">
                  {YEARLY_PER_MONTH}
                </span>
                /month billed yearly, or {formatPrice(BILLING_PLANS.monthly.priceCents)}/mo
              </p>
            </div>
            <span
              style={SANS}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-cb-accent text-cb-accent-fg text-sm font-medium self-start sm:self-auto"
            >
              See plans
              <ArrowRight
                className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform"
                strokeWidth={1.5}
              />
            </span>
          </div>
        </a>
      </section>
    );
  }

  const cancelling = view.cancelAtPeriodEnd || view.status === "cancelled";
  const paymentIssue = view.status === "on_hold" || view.status === "past_due";
  const badge = cancelling
    ? { label: `Cancels on ${formatMembershipDate(view.periodEnd)}`, tone: "warning" as const }
    : paymentIssue
      ? { label: "Payment issue", tone: "warning" as const }
      : { label: "Active", tone: "active" as const };
  const dateLabel = cancelling ? "Access until" : "Renews on";
  const priceLabel =
    view.priceCents !== null && view.interval
      ? describePlanPrice({ interval: view.interval, priceCents: view.priceCents })
      : null;
  const planDescriptor =
    view.planKey === "legacy"
      ? "Original plan, billed monthly"
      : view.interval === "year"
        ? "Billed yearly"
        : view.interval === "month"
          ? "Billed monthly"
          : null;
  const terminal = view.status === "expired" || view.status === "failed";

  const changes = availablePlanChanges(view.planKey);
  const tiles: React.ReactNode[] = [];

  for (const change of changes) {
    const target = BILLING_PLANS[change.target];
    const scheduledForTarget = scheduledChange?.planKey === change.target;
    if (scheduledForTarget) {
      tiles.push(
        <ActionTile
          key={`scheduled:${change.target}`}
          icon={CalendarClock}
          title={`Switching to ${target.label.toLowerCase()} on ${formatMembershipDate(scheduledChange?.effectiveAt)}`}
          detail={`${describePlanPrice(target)} from your renewal date. Changed your mind? Keep ${view.planKey === "yearly" ? "yearly" : "your current plan"}.`}
          actionLabel={pending === "keep" ? "Working…" : "Keep current plan"}
          onClick={keepCurrentPlan}
          disabled={busy}
          testId="keep-current-plan"
        />,
      );
      continue;
    }
    if (change.kind === "upgrade") {
      const detail =
        change.target === "yearly"
          ? `${describePlanPrice(target)}, ${YEARLY_PER_MONTH}/month. Save ${SAVINGS.percent}%. Prorated today.`
          : `${describePlanPrice(target)} instead of ${priceLabel ?? "your current price"}. Applies today.`;
      tiles.push(
        <ActionTile
          key={`change:${change.target}`}
          icon={ArrowUpRight}
          title={`Switch to ${target.label.toLowerCase()}`}
          detail={detail}
          onClick={() => openChange(change)}
          disabled={busy}
          highlight
          testId={`switch-to-${change.target}`}
        />,
      );
    } else {
      tiles.push(
        <ActionTile
          key={`change:${change.target}`}
          icon={CalendarClock}
          title={`Switch to ${target.label.toLowerCase()} at renewal`}
          detail={`${describePlanPrice(target)} starting ${formatMembershipDate(view.periodEnd)}. Nothing changes until then.`}
          onClick={() => openChange(change)}
          disabled={busy}
          testId={`switch-to-${change.target}`}
        />,
      );
    }
  }

  if (view.cancelAtPeriodEnd && !terminal) {
    tiles.push(
      <ActionTile
        key="resume"
        icon={RotateCcw}
        title={pending === "resume" ? "Resuming…" : "Resume subscription"}
        detail={`Keep your plan renewing on ${formatMembershipDate(view.periodEnd)}.`}
        onClick={resume}
        disabled={busy}
        highlight
        testId="resume-subscription"
      />,
    );
  } else if (!cancelling && !terminal) {
    tiles.push(
      <ActionTile
        key="cancel"
        icon={Ban}
        title="Cancel at period end"
        detail={`Access continues until ${formatMembershipDate(view.periodEnd)}. Resume anytime before then.`}
        onClick={() => {
          setModalError(null);
          setModal({ kind: "cancel" });
        }}
        disabled={busy}
        testId="cancel-subscription"
      />,
    );
  }

  tiles.push(
    <LinkTile
      key="portal"
      icon={CreditCard}
      title="Manage billing"
      detail="Payment method, invoices and receipts."
      href={portalHref}
      external
      testId="manage-billing"
    />,
    <LinkTile
      key="support"
      icon={LifeBuoy}
      title="Get support"
      detail={SUPPORT_EMAIL}
      href={`mailto:${SUPPORT_EMAIL}`}
      testId="get-support"
    />,
  );

  const activeChange = modal?.kind === "change" ? modal.change : null;
  const changeTarget = activeChange ? BILLING_PLANS[activeChange.target] : null;

  return (
    <section id="membership" ref={rootRef} className="scroll-mt-24" data-testid="membership-section">
      {/* Status card */}
      <div className="border border-cb-border bg-cb-hover">
        <div className="p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4 mb-6">
            <p style={SANS} className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted">
              Membership
            </p>
            <span className="flex items-center gap-2.5">
              <span className="relative flex h-2 w-2">
                {badge.tone === "active" && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                )}
                <span
                  className={cn(
                    "relative inline-flex rounded-full h-2 w-2",
                    badge.tone === "active" ? "bg-amber-500" : "bg-cb-text-muted",
                  )}
                />
              </span>
              <span
                style={SANS}
                data-testid="membership-badge"
                className={cn(
                  "text-[11px] font-medium uppercase tracking-widest",
                  badge.tone === "active" ? "text-amber-400" : "text-cb-text-secondary",
                )}
              >
                {badge.label}
              </span>
            </span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div>
              <h2 style={SERIF} className="text-3xl sm:text-4xl text-cb-text mb-1">
                {PLAN_NAME}
              </h2>
              {planDescriptor && (
                <p style={SANS} className="text-xs text-cb-text-muted">
                  {planDescriptor}
                </p>
              )}
            </div>
            {priceLabel && (
              <p
                style={SERIF}
                className="text-2xl sm:text-3xl text-cb-text-secondary"
                data-testid="membership-price"
              >
                {priceLabel}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px bg-cb-hover border-t border-cb-border">
          <div className="bg-cb-bg p-5">
            <p style={SANS} className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2">
              {dateLabel}
            </p>
            <p style={MONO} className="text-sm text-cb-text-secondary" data-testid="membership-period-end">
              {formatMembershipDate(view.periodEnd)}
            </p>
          </div>
          <div className="bg-cb-bg p-5">
            <p style={SANS} className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2">
              Status
            </p>
            <p
              style={MONO}
              className={cn("text-sm", badge.tone === "active" ? "text-amber-400" : "text-cb-text-secondary")}
              data-testid="membership-status"
            >
              {humanizeStatus(view.status)}
            </p>
          </div>
        </div>
      </div>

      {paymentIssue && (
        <div className="mt-4 border border-cb-border-strong bg-cb-hover p-4">
          <p style={SANS} className="text-sm text-cb-text-secondary">
            Your last payment did not go through. Update your payment method under Manage billing to
            keep your access.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 border border-cb-border">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-cb-hover">{tiles}</div>
      </div>

      {/* Plan change modal */}
      <MembershipModal
        isOpen={activeChange !== null}
        onClose={closeModal}
        locked={busy}
        testId="change-plan-modal"
        title={
          activeChange?.kind === "downgrade"
            ? `Switch to ${changeTarget?.label.toLowerCase()} at renewal`
            : `Switch to ${changeTarget?.label.toLowerCase()}`
        }
        description={
          activeChange?.kind === "downgrade"
            ? `Your ${PLAN_NAME} plan stays as it is until ${formatMembershipDate(view.periodEnd)}. From then on you are billed ${changeTarget ? describePlanPrice(changeTarget) : ""}.`
            : "The unused part of your current period is credited against the new plan, so you only pay the difference today."
        }
      >
        {activeChange && changeTarget && (
          <div className="space-y-5">
            {activeChange.kind === "upgrade" ? (
              <div className="border border-cb-border">
                <div className="grid grid-cols-2 gap-px bg-cb-hover">
                  <div className="bg-cb-bg p-4">
                    <p style={SANS} className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2">
                      Charged today
                    </p>
                    {previewLoading ? (
                      <Loader2 className="w-4 h-4 text-cb-text-muted animate-spin" />
                    ) : (
                      <p style={SERIF} className="text-2xl text-cb-text" data-testid="preview-charge">
                        {preview && preview.immediateChargeCents !== null
                          ? formatMinorUnits(preview.immediateChargeCents, preview.currency)
                          : "—"}
                      </p>
                    )}
                  </div>
                  <div className="bg-cb-bg p-4">
                    <p style={SANS} className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2">
                      Then
                    </p>
                    <p style={SERIF} className="text-2xl text-cb-text">
                      {describePlanPrice(changeTarget)}
                    </p>
                  </div>
                </div>
                <div className="border-t border-cb-border bg-cb-bg p-4">
                  <p style={SANS} className="text-xs text-cb-text-muted">
                    {previewLoading
                      ? "Working out your prorated amount…"
                      : preview
                        ? `Next renewal ${formatMembershipDate(preview.newPlan.nextBillingDate)}${
                            preview.customerCreditsCents
                              ? `, after ${formatMinorUnits(preview.customerCreditsCents, preview.currency)} in credit`
                              : ""
                          }.`
                        : previewError
                          ? previewError
                          : "Preview unavailable."}
                  </p>
                  {previewError && !previewLoading && (
                    <button
                      type="button"
                      onClick={() => void loadPreview(activeChange.target)}
                      style={SANS}
                      className="mt-2 text-xs uppercase tracking-widest text-cb-text-secondary hover:text-cb-text transition-colors"
                    >
                      Retry preview
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="border border-cb-border bg-cb-bg p-4 grid grid-cols-2 gap-4">
                <div>
                  <p style={SANS} className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2">
                    Takes effect
                  </p>
                  <p style={MONO} className="text-sm text-cb-text-secondary">
                    {formatMembershipDate(view.periodEnd)}
                  </p>
                </div>
                <div>
                  <p style={SANS} className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2">
                    New price
                  </p>
                  <p style={MONO} className="text-sm text-cb-text-secondary">
                    {describePlanPrice(changeTarget)}
                  </p>
                </div>
              </div>
            )}

            {modalError && <ModalError message={modalError} />}

            <div className="flex flex-col sm:flex-row gap-3">
              <PrimaryButton
                onClick={() => confirmChange(activeChange)}
                disabled={busy || (activeChange.kind === "upgrade" && !preview)}
                loading={pending === `change:${activeChange.target}`}
                testId="confirm-change-plan"
              >
                {activeChange.kind === "downgrade"
                  ? `Switch on ${formatMembershipDate(view.periodEnd)}`
                  : preview && preview.immediateChargeCents !== null
                    ? `Pay ${formatMinorUnits(preview.immediateChargeCents, preview.currency)} and switch`
                    : "Confirm switch"}
              </PrimaryButton>
              <SecondaryButton onClick={closeModal} disabled={busy}>
                Keep current plan
              </SecondaryButton>
            </div>
          </div>
        )}
      </MembershipModal>

      {/* Cancel modal */}
      <MembershipModal
        isOpen={modal?.kind === "cancel"}
        onClose={closeModal}
        locked={busy}
        testId="cancel-modal"
        title="Cancel at period end"
        description={`You keep full access until ${formatMembershipDate(view.periodEnd)} and will not be billed again. You can resume anytime before then.`}
      >
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            confirmCancel();
          }}
        >
          <div>
            <label
              htmlFor="cancel-feedback"
              style={SANS}
              className="block text-xs text-cb-text-muted uppercase tracking-widest mb-3"
            >
              Reason (optional)
            </label>
            <select
              id="cancel-feedback"
              value={feedback}
              onChange={(event) => setFeedback(event.target.value as CancellationFeedbackValue | "")}
              disabled={busy}
              style={SANS}
              className="w-full px-4 py-3 bg-transparent border border-cb-border text-cb-text focus:outline-none focus:border-cb-border-strong transition-colors duration-300"
              data-testid="cancel-feedback"
            >
              <option value="">Prefer not to say</option>
              {CANCELLATION_FEEDBACK_VALUES.map((value) => (
                <option key={value} value={value}>
                  {CANCELLATION_FEEDBACK_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="cancel-comment"
              style={SANS}
              className="block text-xs text-cb-text-muted uppercase tracking-widest mb-3"
            >
              Anything we should know? (optional)
            </label>
            <textarea
              id="cancel-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={1000}
              rows={3}
              disabled={busy}
              placeholder="What would have made you stay?"
              style={SANS}
              className="w-full px-4 py-3 bg-transparent border border-cb-border text-cb-text placeholder-cb-text-faint focus:outline-none focus:border-cb-border-strong transition-colors duration-300 resize-none"
              data-testid="cancel-comment"
            />
          </div>

          {modalError && <ModalError message={modalError} />}

          <div className="flex flex-col sm:flex-row gap-3">
            <PrimaryButton type="submit" disabled={busy} loading={pending === "cancel"} testId="confirm-cancel">
              Cancel on {formatMembershipDate(view.periodEnd)}
            </PrimaryButton>
            <SecondaryButton onClick={closeModal} disabled={busy}>
              Keep my plan
            </SecondaryButton>
          </div>
        </form>
      </MembershipModal>
    </section>
  );
}

function humanizeStatus(status: string | null): string {
  if (!status) return "Active";
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

type IconType = React.ComponentType<{ className?: string; strokeWidth?: number }>;

function ActionTile({
  icon: Icon,
  title,
  detail,
  onClick,
  disabled,
  highlight,
  actionLabel,
  testId,
}: {
  icon: IconType;
  title: string;
  detail: string;
  onClick: () => void;
  disabled?: boolean;
  highlight?: boolean;
  /** Renders a secondary button inside the tile instead of making the whole tile the button. */
  actionLabel?: string;
  testId?: string;
}) {
  if (actionLabel) {
    return (
      <div className="bg-cb-bg p-5 flex flex-col" data-testid={testId ? `${testId}-tile` : undefined}>
        <div className="flex items-center justify-between mb-3">
          <Icon className="w-5 h-5 text-amber-400" strokeWidth={1.5} />
        </div>
        <p style={SANS} className="text-sm font-medium text-cb-text mb-1">
          {title}
        </p>
        <p style={SANS} className="text-xs text-cb-text-muted mb-4">
          {detail}
        </p>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          style={SANS}
          data-testid={testId}
          className="mt-auto self-start px-4 py-2 text-xs font-medium uppercase tracking-widest border border-cb-border-strong text-cb-text-secondary hover:text-cb-text hover:bg-cb-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {actionLabel}
        </button>
      </div>
    );
  }
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      whileTap={disabled ? undefined : { scale: 0.995 }}
      transition={{ duration: 0.2, ease: EASE }}
      className="group bg-cb-bg hover:bg-cb-hover transition-colors p-5 flex flex-col text-left disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <div className="flex items-center justify-between mb-3 w-full">
        <Icon className={cn("w-5 h-5", highlight ? "text-amber-400" : "text-cb-text-muted")} strokeWidth={1.5} />
        <ArrowRight
          className="w-4 h-4 text-cb-text-faint group-hover:text-cb-text-muted group-hover:translate-x-0.5 transition-all"
          strokeWidth={1.5}
        />
      </div>
      <p style={SANS} className="text-sm font-medium text-cb-text mb-1">
        {title}
      </p>
      <p style={SANS} className="text-xs text-cb-text-muted">
        {detail}
      </p>
    </motion.button>
  );
}

function LinkTile({
  icon: Icon,
  title,
  detail,
  href,
  external,
  testId,
}: {
  icon: IconType;
  title: string;
  detail: string;
  href: string;
  external?: boolean;
  testId?: string;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      data-testid={testId}
      className="group bg-cb-bg hover:bg-cb-hover transition-colors p-5 flex flex-col"
    >
      <div className="flex items-center justify-between mb-3">
        <Icon className="w-5 h-5 text-cb-text-muted" strokeWidth={1.5} />
        {external ? (
          <ArrowUpRight
            className="w-4 h-4 text-cb-text-faint group-hover:text-cb-text-muted transition-colors"
            strokeWidth={1.5}
          />
        ) : (
          <ArrowRight
            className="w-4 h-4 text-cb-text-faint group-hover:text-cb-text-muted group-hover:translate-x-0.5 transition-all"
            strokeWidth={1.5}
          />
        )}
      </div>
      <p style={SANS} className="text-sm font-medium text-cb-text mb-1">
        {title}
      </p>
      <p style={SANS} className="text-xs text-cb-text-muted">
        {detail}
      </p>
    </a>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  loading,
  type = "button",
  testId,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  type?: "button" | "submit";
  testId?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      style={SANS}
      className={cn(
        "group relative flex-1 flex items-center justify-center gap-2 px-6 py-3.5",
        "bg-cb-accent text-cb-accent-fg transition-all duration-300 overflow-hidden",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      )}
    >
      <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
      <span className="relative z-10 text-sm font-medium group-hover:text-cb-text transition-colors duration-300 flex items-center gap-2">
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {children}
      </span>
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={SANS}
      className="px-6 py-3.5 border border-cb-border-strong text-sm text-cb-text-secondary hover:text-cb-text hover:bg-cb-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function ModalError({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-cb-border-strong p-3"
      role="alert"
    >
      <p style={SANS} className="text-cb-text-secondary text-sm">
        {message}
      </p>
    </motion.div>
  );
}
