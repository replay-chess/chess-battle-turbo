// /practice for a game you did not play, an unknown game or position, or a URL with no (or more than one) source:
// one answer, so a game's existence is never revealed (plan §11.1).
import Link from "next/link";
import { PRIMARY_LINK } from "@/lib/ui/primary-link";

export default function PracticeNotFound() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6" data-testid="practice-not-found">
      <div className="flex max-w-[480px] flex-col items-start gap-4">
        <span className="font-mono text-label font-medium tracking-[0.12em] text-cb-text-soft uppercase">Practice</span>
        <h1 className="m-0 font-serif text-[2.25rem] leading-[1.05] font-normal tracking-[-0.01em]">We couldn’t find that position</h1>
        <p className="m-0 text-body text-cb-text-soft">Practice opens from one of your finished games, a legend position or a position you paste in.</p>
        <Link href="/games" className={PRIMARY_LINK}>
          Go to My Games
        </Link>
      </div>
    </div>
  );
}
