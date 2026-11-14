"use client";

// The training session summary (S7, phase-05 plan §4.7, §5.2 S7): seeded from the RSC (`getSessionSummary`), read with
// `sessionSummaryQuery(ref)`. When the runner navigated with `?n=<graded on the device>` and the server holds fewer
// attempts, "Saving your results…" shows and R3 is refetched every 1 s, at most 5 times (the only interval in P5);
// then the partial summary with "Some results are still syncing.". Enter = Back to Train.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronLeft, Puzzle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SessionSummary } from "@repo/contracts/http/train";
import { LessonCardSlot } from "@/components/train/slots/LessonCardSlot";
import { trackTrain } from "@/lib/analytics/train-events";
import { sessionSummaryQuery } from "@/lib/api/queries/train";
import { COARSE_MQ } from "@/lib/layout/media-queries";
import { isEditableTarget, MODAL_OPEN_SELECTOR } from "@/lib/shell/key-target";
import { GradeTable } from "./GradeTable";
import { SAVING_POLL_MS, savingState } from "./model";
import { StatTiles } from "./StatTiles";
import "./summary.css";

const SUMMARY_NOTE = "Again brings a position back today; Easy pushes it out more than a week. The schedule is FSRS.";

export function SummaryScreen({ summary: seed, clientGraded, demo = false }: { summary: SessionSummary; clientGraded: number | null; demo?: boolean }) {
  const router = useRouter();
  // Refetches made on this page (the seed, from the RSC or the runner's W4 answer, is not one).
  const polls = useRef(0);
  const [pollCount, setPollCount] = useState(0);
  const q = useQuery({
    ...sessionSummaryQuery(seed.ref),
    initialData: seed,
    enabled: !demo,
    refetchOnMount: false,
    refetchInterval: (query) => {
      const data = query.state.data as SessionSummary | undefined;
      return data && savingState(data, clientGraded, polls.current) === "saving" ? SAVING_POLL_MS : false;
    },
  });
  const updatedAt = q.dataUpdatedAt;
  const firstUpdate = useRef(updatedAt);
  useEffect(() => {
    if (updatedAt === firstUpdate.current) return;
    polls.current += 1;
    setPollCount(polls.current);
  }, [updatedAt]);
  const summary = q.data ?? seed;
  const saving = savingState(summary, clientGraded, demo ? 0 : pollCount);
  const trainHref = demo ? "/dev/ui/train/hub" : "/train";
  const puzzlesHref = demo ? "/dev/ui/train/puzzles" : summary.next.puzzles.href;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (window.matchMedia(COARSE_MQ).matches || isEditableTarget(e.target) || document.querySelector(MODAL_OPEN_SELECTOR)) return;
      if (e.target instanceof Element && e.target.closest("a[href], button, [role='button']")) return;
      e.preventDefault();
      trackTrain("train_summary_next_clicked", { target: "train" });
      router.push(trainHref);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, trainHref]);

  return (
    <div className="ts" data-rc-lock="" data-testid="session-summary" data-variant={summary.variant} data-saving={saving}>
      <div className="ts__scroll" role="region" aria-label="Session summary">
        <div className="ts__grid">
          <div className="ts__left">
            <p className="ts-lbl" data-testid="summary-eyebrow">
              {summary.eyebrow}
            </p>
            <h1 className="ts-h1" data-testid="summary-title">
              {summary.title}
            </h1>
            <p className="ts-lead" data-testid="summary-lead">
              {summary.subtitle}
            </p>
            {saving !== "none" ? (
              <p className="ts-saving" role="status" data-testid="summary-saving">
                {saving === "saving" ? "Saving your results…" : "Some results are still syncing."}
              </p>
            ) : null}
            {summary.milestone ? (
              <span className="ts-tag" data-testid="summary-milestone">
                {summary.milestone.label}
              </span>
            ) : null}
            <StatTiles summary={summary} />
            <nav className="ts-next" aria-label="What next">
              <LessonCardSlot lesson={summary.next.lesson} className="ts-btn-p" onClick={() => trackTrain("train_summary_next_clicked", { target: "lesson" })} />
              <Link className="ts-row" href={puzzlesHref} prefetch={false} onClick={() => trackTrain("train_summary_next_clicked", { target: "puzzles" })} data-testid="summary-puzzles">
                <Puzzle aria-hidden="true" />
                <span className="ts-row__text">
                  Continue With Puzzles
                  <span className="ts-row__sub">{summary.next.puzzles.note}</span>
                </span>
                <ArrowRight aria-hidden="true" className="ts-row__go" />
              </Link>
              <Link className="ts-row" href={trainHref} onClick={() => trackTrain("train_summary_next_clicked", { target: "train" })} data-testid="summary-back">
                <ChevronLeft aria-hidden="true" />
                <span className="ts-row__text">Back to Train</span>
              </Link>
            </nav>
          </div>
          <section className="ts-card" aria-labelledby="ts-grades-h">
            <h2 id="ts-grades-h" className="ts-lbl">
              How you graded them · next review
            </h2>
            <GradeTable rows={summary.grades} />
            <p className="ts-note ts-tall">{SUMMARY_NOTE}</p>
            {summary.themes.length ? (
              <>
                <h2 className="ts-lbl" style={{ marginTop: 8 }}>
                  Themes covered
                </h2>
                <ul className="ts-chips" style={{ listStyle: "none", margin: 0, padding: 0 }} data-testid="summary-themes">
                  {summary.themes.map((t) => (
                    <li key={t.key} className="ts-tag" data-tone="neutral">
                      {t.label} · {t.n}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
