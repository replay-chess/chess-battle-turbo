// Practice context query (phase-03 plan §5.9, §7.2 PR1). The `/practice` RSC reads the DAL directly; this is for
// client callers outside it (P5's "study this position"). Keys from `qk.practice`; the schema check only in dev and
// test builds (AP-12). A context is immutable for a finished game's ply or a position, so staleTime is Infinity.
import type { PracticeContextDTO } from "@repo/contracts/http/practice";
import { PracticeContextDTO as PracticeContextSchema } from "@repo/contracts/http/practice";
import { queryOptions } from "@tanstack/react-query";
import { api } from "../client";
import { endpoints } from "../endpoints";
import { qk, type PracticeKey } from "../keys";

export async function fetchPracticeContext(q: PracticeKey, signal?: AbortSignal): Promise<PracticeContextDTO> {
  const schema = process.env.NODE_ENV === "production" ? undefined : PracticeContextSchema;
  const { data } = await api(endpoints.practiceContext, { query: q, schema, signal });
  return data as PracticeContextDTO;
}

export function practiceContextQuery(q: PracticeKey) {
  return queryOptions({
    queryKey: qk.practice.context(q),
    queryFn: ({ signal }): Promise<PracticeContextDTO> => fetchPracticeContext(q, signal),
    staleTime: Infinity,
    meta: { object: "the practice position" },
  });
}
