// "What happens after you start" (phase-04 plan §4.6; V3OnbPlan aside, V3iPadOnbPlan card, V3iPhoneOnbPlan `.mini`
// table): a table with `th scope="row"` for the day. `full` has every row ("Every game" hides at heights ≤ 760);
// `mini` is the phone table (three rows, shorter copy). No hooks.
import type { TimelineRow } from "@/lib/onboarding/plan-view";

export function PlanTimeline({ rows, variant }: { rows: readonly TimelineRow[]; variant: "full" | "mini" }) {
  const shown = variant === "mini" ? rows.filter((r) => r.short !== null) : rows;
  return (
    <table className={variant === "mini" ? "onb-tl onb-tl--mini" : "onb-tl"} aria-label="What happens after you start" data-testid={`onb-plan-timeline-${variant}`}>
      {variant === "mini" ? (
        <colgroup>
          <col className="onb-tl__c1" />
          <col />
        </colgroup>
      ) : null}
      <thead>
        <tr>
          <th scope="col">
            <span className="onb-lbl">When</span>
          </th>
          <th scope="col" className="onb-tl__pl">
            <span className="onb-lbl">What you get</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {shown.map((r) => (
          <tr key={r.when} className={r.tall && variant === "full" ? "onb-tall" : undefined}>
            <th scope="row">{r.when}</th>
            <td className="onb-tl__pl">{variant === "mini" ? r.short : r.what}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
