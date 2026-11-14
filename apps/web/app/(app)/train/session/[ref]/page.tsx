// /train/session/[ref] (phase-05 plan §0 "Summary URL", §4.7): an ACTIVE session goes to its runner (`?s=`), any other
// to its summary. A foreign or missing ref is a 404 (existence is never revealed).
import { notFound, redirect } from "next/navigation";
import { requestNow } from "@/lib/api/now";
import { requireMemberPage } from "@/lib/auth/require-member-page";
import { getFlags } from "@/lib/flags";
import { isNotFound } from "@/lib/data/errors";
import { getSession } from "@/lib/train/sessions.server";

export const dynamic = "force-dynamic";

export default async function TrainSessionPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const viewer = await requireMemberPage({ returnTo: `/train/session/${encodeURIComponent(ref)}` });
  if (!(await getFlags(viewer)).train) notFound(); // the flag registry: off → /train/** pages 404
  let target: string;
  try {
    const s = await getSession(viewer, ref, await requestNow());
    const runner = s.kind === "puzzles" ? "/train/puzzles" : "/train/bank/session";
    target = s.status === "active" ? `${runner}?s=${encodeURIComponent(s.ref)}` : `/train/session/${encodeURIComponent(s.ref)}/summary`;
  } catch (err) {
    if (isNotFound(err)) notFound();
    throw err;
  }
  redirect(target);
}
