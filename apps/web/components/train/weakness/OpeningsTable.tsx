// OpeningsTable (phase-06 plan §4.6 "Openings"; board `.otab`): a real table, Family / Games / Score, ≤ 4 rows. The
// family carries the muted ECO range and the note ("C55–C59 · Most played"); a long name is cut with an ellipsis and
// keeps its full text in `title`. No rows → "Not enough games per opening yet."
import type { WeaknessBreakdown } from "@repo/contracts/http/weakness";
import { copy } from "./copy";

const TH = "border-b border-cb-border px-2 py-1.5 text-left font-mono text-label font-medium tracking-label text-cb-text-soft uppercase";
const TD = "border-b border-cb-border p-2 align-top";

export function OpeningsTable({ openings }: { openings: WeaknessBreakdown["openings"] }) {
  if (openings.length === 0) return <p className="m-0 text-sm text-cb-text-secondary" data-testid="weakness-openings-empty">{copy.openingsEmpty}</p>;
  return (
    <table className="w-full table-fixed border-collapse text-sm" data-testid="weakness-openings">
      <thead>
        <tr>
          <th scope="col" className={TH}>
            {copy.openingsCols.family}
          </th>
          <th scope="col" className={`${TH} w-[4.5rem]`}>
            {copy.openingsCols.games}
          </th>
          <th scope="col" className={`${TH} w-[4.5rem]`}>
            {copy.openingsCols.score}
          </th>
        </tr>
      </thead>
      <tbody>
        {openings.map((o) => (
          <tr key={`${o.family}-${o.ecoRange}`}>
            <td className={TD}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate" title={o.family}>
                  {o.family}
                </span>
                <span className="font-mono text-label text-cb-text-soft">
                  {o.ecoRange}
                  {o.note ? ` · ${copy.openingNotes[o.note]}` : ""}
                </span>
              </span>
            </td>
            <td className={`${TD} font-mono tabular-nums`}>{o.games}</td>
            <td className={`${TD} font-mono tabular-nums`}>{o.scorePct}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
