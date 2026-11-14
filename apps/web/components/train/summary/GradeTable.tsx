// "How you graded them · next review" (§4.7): a real table, rows Again · Hard · Good · Easy with the count and the
// interval label (the median scheduled interval of this session's attempts with that grade, from the server). The bar
// is decoration: count / max(3, most) × 90 % (V3SessionSummary: 1 → 30 %, 2 → 60 %, 3 → 90 %).
import type { GradeRow } from "@repo/contracts/http/train";
import { barWidth } from "./model";

const LABEL = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" } as const;

export function GradeTable({ rows }: { rows: readonly GradeRow[] }) {
  return (
    <table className="ts-table" data-testid="summary-grades">
      <caption className="ts-vh">How you graded them and when each comes back</caption>
      <thead className="ts-vh">
        <tr>
          <th scope="col">Grade</th>
          <td />
          <th scope="col">Count</th>
          <th scope="col">Next review</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.grade} data-grade={r.grade}>
            <th scope="row">{LABEL[r.grade]}</th>
            <td className="ts-table__bar" aria-hidden="true">
              <span className="ts-bar">
                <span style={{ width: `${barWidth(r.n, rows)}%` }} />
              </span>
            </td>
            <td className="ts-table__n ts-mono">{r.n}</td>
            <td className="ts-table__when ts-mono">{r.intervalLabel}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
