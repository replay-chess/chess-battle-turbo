// LessonLink (phase-06 plan §4.6, §7.6): "Legend lesson: {title}" → /learn/lessons/{slug}?from=weakness. Rendered only
// when the row carries a lesson, which P8's resolver supplies (always null in P6; `lesson=1` on the demo route).
import Link from "next/link";
import type { WeaknessLesson } from "@repo/contracts/http/weakness";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { copy } from "./copy";

export const lessonHref = (lesson: WeaknessLesson): string => `/learn/lessons/${encodeURIComponent(lesson.slug)}?from=weakness`;

export function LessonLink({ lesson, className }: { lesson: WeaknessLesson | null; className?: string }) {
  if (!lesson) return null;
  return (
    <Link
      href={lessonHref(lesson)}
      prefetch={false}
      className={cn(buttonVariants({ variant: "secondary" }), "h-auto min-h-11 whitespace-normal text-left", className)}
      data-testid="weakness-lesson-link"
    >
      {copy.lessonLink(lesson.title)}
    </Link>
  );
}
