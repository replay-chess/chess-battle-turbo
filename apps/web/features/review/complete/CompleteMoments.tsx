"use client";

// The complete page's card list (phase-03 plan §4.2): one row per key moment (the mini board after the played move,
// linking to that moment; the badge; "You played 17.b3 · best was Qc1"; the first why sentence; the result line), or
// the standout moves of a clean game. A client module only because P2's MiniBoard and the badge icons are; it has no
// state, no effects and fetches nothing.

import Link from "next/link";
import type { CompleteMoment, CompleteStandout } from "@repo/contracts/http/review";
import { MiniBoard } from "@/components/board/MiniBoard";
import { QualityBadge } from "../components/QualityBadge";
import { momentBankTag, momentPlayedLine, momentResultLine } from "./copy";

export function CompleteMoments({
  moments,
  standouts,
  momentHrefs,
  footnote,
  footnoteId,
}: {
  moments: readonly CompleteMoment[];
  standouts: readonly CompleteStandout[];
  momentHrefs: readonly string[];
  footnote: string | null;
  footnoteId: string;
}) {
  return (
    <>
      {moments.length > 0 ? (
        <ol className="rvc-mlist">
          {moments.map((m, i) => {
            const tag = momentBankTag(m);
            return (
            <li className="rvc-mrow" key={m.ply} data-testid="complete-moment" data-result={m.result ?? "open"} data-bank={tag ? "" : undefined}>
              <Link href={momentHrefs[i] ?? "#"} prefetch={false} className="rvc-mini" aria-label={`Open moment ${i + 1}: ${m.moveLabel}${m.playedSan}`}>
                <MiniBoard fen={m.fenAfter} size={72} testId="complete-mini-board" />
              </Link>
              <div className="rvc-mrow__body">
                <span className="rvc-mrow__head">
                  <QualityBadge q={m.judgement} size={22} />
                  <span>{momentPlayedLine(m)}</span>
                </span>
                {m.why0 ? <p className="rvc-say">{m.why0}</p> : null}
                <span className="rvc-soft">{momentResultLine(m)}</span>
              </div>
              {tag ? (
                <span className="rvc-tag" data-added={tag.added ? "" : undefined} data-testid="complete-moment-bank">
                  {tag.label}
                </span>
              ) : null}
            </li>
            );
          })}
        </ol>
      ) : (
        <ol className="rvc-mlist">
          {standouts.map((s) => (
            <li className="rvc-mrow" key={s.ply} data-testid="complete-standout">
              <span className="rvc-mini">
                <MiniBoard fen={s.fenAfter} size={72} label={`After ${s.moveLabel}${s.san}`} testId="complete-mini-board" />
              </span>
              <div className="rvc-mrow__body">
                <span className="rvc-mrow__head">
                  <QualityBadge q={s.judgement} size={22} />
                  <span className="rvc-mono">
                    {s.moveLabel}
                    {s.san}
                  </span>
                </span>
                <p className="rvc-say">{s.caption}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {footnote ? (
        <p className="rvc-foot" data-testid={footnoteId}>
          {footnote}
        </p>
      ) : null}
    </>
  );
}
