"use client";

// LabelCountsTable (plan §4.1; V3ReviewSummary counts): a real <table> of plies per label for You and Opp, 22 px
// badges, in two columns filled row by row as on the board. Ten rows always, plus Forced and
// Interesting when either side has one. Loaded with next/dynamic (§9.6).

import { COPY, QUALITY_LABEL } from "../copy";
import { countRows, type CountRow, type Side } from "../model";
import { QualityBadge } from "./QualityBadge";

function Half({ rows, caption }: { rows: CountRow[]; caption: string }) {
  return (
    <table className="rv-counts__half">
      <caption className="rv-vh">{caption}</caption>
      <colgroup>
        <col style={{ width: 28 }} />
        <col />
        <col style={{ width: 34 }} />
        <col style={{ width: 34 }} />
      </colgroup>
      <thead>
        <tr className="rv-counts__head">
          <td aria-hidden="true" />
          <th scope="col">{COPY.countsMove}</th>
          <th scope="col">{COPY.countsYou}</th>
          <th scope="col">{COPY.countsOpp}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} data-q={r.key}>
            <td>
              <QualityBadge q={r.key} size={22} decorative />
            </td>
            <th scope="row">{QUALITY_LABEL[r.key]}</th>
            <td className="rv-mono">{r.you}</td>
            <td className="rv-mono">{r.opp}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function LabelCountsTable({ counts, you }: { counts: { w: number[]; b: number[] }; you: Side }) {
  const rows = countRows(counts, you);
  // Row-major like the board's two-up grid: Brilliant | Great, Best | Excellent, Good | Book, …
  return (
    <div className="rv-counts" data-testid="label-counts">
      <Half rows={rows.filter((_, i) => i % 2 === 0)} caption="Move labels: your count and your opponent’s" />
      <Half rows={rows.filter((_, i) => i % 2 === 1)} caption="More move labels: your count and your opponent’s" />
    </div>
  );
}
