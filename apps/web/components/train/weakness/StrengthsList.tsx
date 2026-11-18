// StrengthsList (phase-06 plan §4.6, §8.20): the 1–2 strength sentences as good notes (board `.note.good`), or the
// empty line. Shared by the desktop box and the Strengths tab.
import { copy } from "./copy";

export function StrengthsList({ strengths }: { strengths: readonly string[] }) {
  if (strengths.length === 0) return <p className="m-0 text-sm text-cb-text-secondary" data-testid="weakness-strengths-empty">{copy.strengthsEmpty}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0" data-testid="weakness-strengths">
      {strengths.map((s) => (
        <li key={s} className="border border-cb-good/30 bg-cb-good-bg px-3.5 py-3 text-sm leading-[1.45]">
          {s}
        </li>
      ))}
    </ul>
  );
}
