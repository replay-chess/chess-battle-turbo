// The legend-lesson card slot (phase-05 plan §2.2, coverage C-05/C-06): `SessionSummary.next.lesson` and
// `BankPage.lesson` are `LessonCard | null` with a frozen contract. P5 always sends null, so this renders nothing;
// P8 fills the field from `nextLessonForPlan(viewer)` and only adds styling here, never a field.
import Link from "next/link";
import type { LessonCard } from "@repo/contracts/http/train";

export function LessonCardSlot({ lesson, className, onClick }: { lesson: LessonCard | null; className?: string; onClick?: () => void }) {
  if (!lesson) return null;
  return (
    <Link href={lesson.href} prefetch={false} className={className} onClick={onClick} data-testid="lesson-card">
      Legend lesson: {lesson.title}
      <span className="sr-only"> · {lesson.minutes} min</span>
    </Link>
  );
}
