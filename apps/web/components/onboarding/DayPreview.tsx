// "Your day" (phase-04 plan §4.5, §8.3; V3OnbGoals aside, V3iPhoneOnbGoals / V3iPadOnbGoals inline card): the rows
// previewDay() computes for the picked goals and minutes, "{title} · {desc} · {m} MIN" ("ANYTIME" for Play friends).
// No hooks: rendered twice by the Goals step (the desktop aside and the compact inline card; CSS shows one).
import type { DayPreview as DayPreviewData } from "@/lib/onboarding/day-preview";

export function DayPreview({ preview, headingId }: { preview: DayPreviewData; headingId: string }) {
  return (
    <section className="onb-card onb-day" aria-labelledby={headingId} data-testid="onb-day-preview">
      <div className="onb-day__head">
        <span className="onb-lbl" id={headingId}>
          Your day
        </span>
        <span className="onb-mono onb-sec onb-xs" data-testid="onb-day-total">
          {preview.totalLabel}
        </span>
      </div>
      {preview.rows.length > 0 ? (
        <ol className="onb-day__rows">
          {preview.rows.map((r) => (
            <li key={r.goal} data-goal={r.goal}>
              <span className="onb-day__what">
                <span className="onb-day__title">{r.title}</span>
                <span className="onb-sec onb-small">{r.desc}</span>
              </span>
              <span className="onb-mono onb-sec onb-xs">{r.label}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="onb-p">Choose a goal to see a sample day.</p>
      )}
    </section>
  );
}
