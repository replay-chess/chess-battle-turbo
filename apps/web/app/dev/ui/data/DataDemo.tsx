"use client";

// /dev/ui/data (plan §4.11, T13–T16): the client data layer, end to end against the real routes.
//
// - Query States: every QueryState branch from fake query objects (no network).
// - Rate Limit · Fault: GET /api/openings with x-rc-fault: 429 (+ a fresh __rcfault) → inline RetryCountdown; once the
//   wait ends (`inline_ready`) the next click goes through without the fault and loads the catalogue.
// - Rate Limit · Real Limiter: GET /api/health?deep=1, the `health-deep` bucket (6 / 60 s per IP); the 7th click
//   within a minute shows the server's own Retry-After.
// - Session: "Simulate 401" (x-rc-fault: 401) runs the real guard: Clerk reload, one refetch, still 401 → modal. The
//   draft input is saved to sessionStorage before sign-in and restored after (the pattern P7's coach reuses).
// - Errors: "Force 500" → error toast with the event id; "Force 503" → the maintenance toast (logged only in P1).
// - Legacy Envelope: what unwrapLegacy() makes of the three success shapes.
//
// `?state=session_expired` opens the modal directly (demo; used by the device suite, which has no test hooks).
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { HealthData } from "@repo/contracts/http/system";
import { OpeningsIndexData } from "@repo/contracts/http/openings";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { QueryState, type QueryLike } from "@/components/data/QueryState";
import { RetryCountdown } from "@/components/system/RetryCountdown";
import { useRetryCountdown } from "@/components/system/useRetryCountdown";
import { draftKey, onBeforeSignIn, openSessionExpired } from "@/components/system/session-guard";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/errors";
import { unwrapLegacy } from "@/lib/api/legacy";
import { devSchema } from "@/lib/api/schema";

const DRAFT_ROUTE = "/dev/ui/data";

// ---------------------------------------------------------------------------------------------------------------

export function DataDemo() {
  const params = useSearchParams();
  const demoState = params.get("state");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    if (demoState === "session_expired") openSessionExpired("demo");
  }, [demoState]);

  return (
    <div className="flex flex-col gap-10" data-testid="data-demo">
      {hydrated ? <span hidden data-testid="data-demo-ready" /> : null}
      <p className="max-w-2xl text-body text-cb-text-soft">
        The client data layer against the real routes. Faults use the <code className="font-mono">x-rc-fault</code>{" "}
        test hook, which the server honours only with <code className="font-mono">ALLOW_TEST_HOOKS=1</code> on a dev or
        test build.
      </p>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FaultRateLimitCard />
        <RealRateLimitCard />
        <SessionCard />
        <ErrorsCard />
      </div>
      <QueryStatesCard />
      <LegacyCard />
    </div>
  );
}

function DemoCard({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Card padding="none" aria-labelledby={`${id}-title`} data-testid={id}>
      <CardHeader id={`${id}-title`} title={title} />
      <CardBody className="flex flex-col gap-3.5">{children}</CardBody>
    </Card>
  );
}

const RESULT = "m-0 min-h-5 font-mono text-ui text-cb-text-soft";

// ---------------------------------------------------------------------------------------------------------------
// Rate limit · fault (T13)
// ---------------------------------------------------------------------------------------------------------------

function FaultRateLimitCard() {
  const load = useMutation({
    mutationFn: async (forceFault: boolean) => {
      const { data } = await api(endpoints.openings, {
        schema: devSchema(OpeningsIndexData),
        fault: forceFault ? 429 : undefined,
      });
      return data;
    },
    meta: { object: "openings", verb: "load", errorUi: "inline" },
  });
  const rl = useRetryCountdown(load, { routeId: "catalog.openings.index" });
  const count = load.data?.openings.length;

  return (
    <DemoCard id="data-fault-429" title="Rate Limit · Fault">
      <p className="m-0 text-ui text-cb-text-soft">
        Forces a 429 on GET /api/openings. After the wait, the next click goes through without the fault.
      </p>
      <Button
        {...rl.controlProps}
        loading={load.isPending}
        loadingLabel="Loading…"
        onClick={() => {
          if (rl.limited || load.isPending) return;
          load.mutate(!rl.ready);
        }}
        className="self-start"
        data-testid="data-load-openings"
      >
        Load Openings (Force 429)
      </Button>
      <RetryCountdown countdown={rl} data-testid="data-load-openings-countdown" />
      <p className={RESULT} data-testid="data-openings-result" data-count={count ?? undefined}>
        {count !== undefined
          ? `${count.toLocaleString("en-US")} openings loaded`
          : load.error && !rl.error
            ? `Failed: ${(load.error as Error).message}`
            : null}
      </p>
    </DemoCard>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Rate limit · real limiter (T13, second half)
// ---------------------------------------------------------------------------------------------------------------

function RealRateLimitCard() {
  const [clicks, setClicks] = useState(0);
  const check = useMutation({
    mutationFn: async () => {
      const { data } = await api(endpoints.health, { query: { deep: "1" }, schema: devSchema(HealthData) });
      return data;
    },
    meta: { object: "database check", verb: "run", errorUi: "inline" },
  });
  const rl = useRetryCountdown(check, { routeId: "health.get" });
  const db = check.data?.db;

  return (
    <DemoCard id="data-real-429" title="Rate Limit · Real Limiter">
      <p className="m-0 text-ui text-cb-text-soft">
        GET /api/health?deep=1 is limited to 6 requests a minute per connection. The 7th shows the server’s wait.
      </p>
      <Button
        variant="secondary"
        {...rl.controlProps}
        loading={check.isPending}
        loadingLabel="Checking…"
        onClick={() => {
          if (rl.limited || check.isPending) return;
          setClicks((n) => n + 1);
          check.mutate();
        }}
        className="self-start"
        data-testid="data-check-db"
      >
        Check Database
      </Button>
      <RetryCountdown countdown={rl} data-testid="data-check-db-countdown" />
      <p className={RESULT} data-testid="data-check-db-result" data-clicks={clicks}>
        {db
          ? `Database ${db.ok ? "OK" : "down"} · ${Math.round(db.ms)} ms · request ${clicks}`
          : check.error && !rl.error
            ? `Failed: ${(check.error as Error).message}`
            : null}
      </p>
    </DemoCard>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Session (T15)
// ---------------------------------------------------------------------------------------------------------------

function readDraft(): string {
  try {
    const key = draftKey(DRAFT_ROUTE);
    const v = sessionStorage.getItem(key);
    if (v !== null) sessionStorage.removeItem(key);
    return v ?? "";
  } catch {
    return "";
  }
}

function SessionCard() {
  const [nonce, setNonce] = useState(0);
  const [draft, setDraft] = useState("");
  const draftRef = useRef(draft);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Restore after sign-in; save before the modal navigates to sign-in.
  useEffect(() => {
    const restored = readDraft();
    if (restored) setDraft(restored);
    return onBeforeSignIn(() => {
      if (draftRef.current) sessionStorage.setItem(draftKey(DRAFT_ROUTE), draftRef.current);
    });
  }, []);

  // A query, so the guard's "refetch once after the session reload" path runs for real.
  const probe = useQuery({
    queryKey: ["dev", "simulate-401", nonce],
    queryFn: async () => (await api(endpoints.health, { fault: 401 })).data,
    enabled: nonce > 0,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    meta: { object: "session probe" },
  });

  return (
    <DemoCard id="data-session" title="Session">
      <p className="m-0 text-ui text-cb-text-soft">
        A 401 that a session reload does not fix opens the signed-out dialog. The draft below comes back after
        sign-in.
      </p>
      <Field label="Draft" hint="Kept in this tab across sign-in">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} data-testid="data-draft" />
      </Field>
      <Button
        variant="secondary"
        onClick={() => setNonce((n) => n + 1)}
        className="self-start"
        data-testid="data-simulate-401"
      >
        Simulate 401
      </Button>
      <p className={RESULT} data-testid="data-simulate-401-result">
        {nonce > 0 ? (probe.isFetching ? "Checking the session…" : probe.status) : null}
      </p>
    </DemoCard>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Errors (T16)
// ---------------------------------------------------------------------------------------------------------------

function ErrorsCard() {
  const retry500 = useRef<() => void>(() => {});
  const force500 = useMutation({
    mutationFn: async () => (await api(endpoints.openings, { fault: 500 })).data,
    meta: { object: "openings", verb: "load", retry: () => retry500.current() },
  });
  useEffect(() => {
    retry500.current = () => force500.mutate();
  }, [force500]);

  const force503 = useMutation({
    mutationFn: async () => (await api(endpoints.openings, { fault: 503 })).data,
    meta: { object: "openings", verb: "load" },
  });

  return (
    <DemoCard id="data-errors" title="Errors">
      <p className="m-0 text-ui text-cb-text-soft">
        A failed action raises an error toast with the event id from x-request-id. A 503 maintenance answer shows the
        maintenance notice.
      </p>
      <div className="flex flex-wrap gap-2.5">
        <Button
          variant="secondary"
          loading={force500.isPending}
          loadingLabel="Loading…"
          onClick={() => force500.mutate()}
          data-testid="data-force-500"
        >
          Force 500
        </Button>
        <Button
          variant="secondary"
          loading={force503.isPending}
          loadingLabel="Loading…"
          onClick={() => force503.mutate()}
          data-testid="data-force-503"
        >
          Force 503
        </Button>
      </div>
      <p className={RESULT} data-testid="data-force-500-result">
        {force500.error instanceof ApiError ? `x-request-id ${force500.error.requestId ?? "none"}` : null}
      </p>
    </DemoCard>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// QueryState branches (plan §5.7), from fake queries
// ---------------------------------------------------------------------------------------------------------------

type DemoState = "loading" | "offline" | "error" | "rate_limited" | "empty" | "success" | "refetching";

const DEMO_STATES: { value: DemoState; label: string }[] = [
  { value: "loading", label: "Loading" },
  { value: "offline", label: "Offline" },
  { value: "error", label: "Error" },
  { value: "rate_limited", label: "Rate Limited" },
  { value: "empty", label: "Empty" },
  { value: "success", label: "Success" },
  { value: "refetching", label: "Refetching" },
];

type DemoRow = { id: string; name: string };
const ROWS: DemoRow[] = [
  { id: "c20", name: "King’s Pawn Game" },
  { id: "b20", name: "Sicilian Defence" },
  { id: "d06", name: "Queen’s Gambit" },
];

function fakeQuery(state: DemoState, nonce: number): QueryLike<DemoRow[]> {
  const base = { isPlaceholderData: false, refetch: () => undefined };
  switch (state) {
    case "loading":
      return { ...base, data: undefined, error: null, isPending: true, isError: false, isFetching: true, fetchStatus: "fetching" };
    case "offline":
      return { ...base, data: undefined, error: null, isPending: true, isError: false, isFetching: false, fetchStatus: "paused" };
    case "error":
      return {
        ...base,
        data: undefined,
        error: new ApiError({ status: 500, code: "internal", requestId: `5f1c2a9b-demo-${nonce}` }),
        isPending: false,
        isError: true,
        isFetching: false,
        fetchStatus: "idle",
      };
    case "rate_limited":
      return {
        ...base,
        data: undefined,
        error: new ApiError({
          status: 429,
          code: "rate_limited",
          retryAfterSec: 30,
          details: { bucket: "demo" },
          requestId: `demo-429-${nonce}`,
        }),
        isPending: false,
        isError: true,
        isFetching: false,
        fetchStatus: "idle",
      };
    case "empty":
      return { ...base, data: [], error: null, isPending: false, isError: false, isFetching: false, fetchStatus: "idle" };
    case "success":
      return { ...base, data: ROWS, error: null, isPending: false, isError: false, isFetching: false, fetchStatus: "idle" };
    case "refetching":
      return { ...base, data: ROWS, error: null, isPending: false, isError: false, isFetching: true, fetchStatus: "fetching" };
  }
}

function QueryStatesCard() {
  const [state, setState] = useState<DemoState>("loading");
  const [nonce, setNonce] = useState(0);
  const query = fakeQuery(state, nonce);

  return (
    <DemoCard id="data-query-states" title="Query States">
      <Segmented
        aria-label="Query state"
        value={state}
        onValueChange={(v) => {
          setState(v);
          setNonce((n) => n + 1);
        }}
        items={DEMO_STATES}
        className="flex-wrap"
        data-testid="data-query-state-picker"
      />
      <div className="min-h-64 border border-cb-border">
        <QueryState
          query={query}
          object="openings"
          isEmpty={(rows) => rows.length === 0}
          empty={<EmptyState title="No Openings Yet" body="Openings you study show up here." ghostRows={2} />}
          data-testid="data-query-state"
        >
          {(rows) => (
            <ul className="m-0 flex list-none flex-col p-0">
              {rows.map((r) => (
                <li key={r.id} className="flex min-h-12 items-center gap-3 border-b border-cb-border px-3.5 last:border-b-0">
                  <span className="font-mono text-ui text-cb-text-soft uppercase">{r.id}</span>
                  <span className="text-body">{r.name}</span>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </div>
    </DemoCard>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Legacy envelope adapter
// ---------------------------------------------------------------------------------------------------------------

const LEGACY_SAMPLES: { label: string; body: unknown }[] = [
  { label: "Envelope", body: { data: { openings: 3641 }, meta: { total: 3641 } } },
  { label: "Legacy success", body: { success: true, data: { openings: 3641 } } },
  { label: "Raw object", body: { entitled: true, status: "active" } },
  { label: "Legacy failure (sent with 200)", body: { success: false, error: "Not configured" } },
];

function LegacyCard() {
  return (
    <DemoCard id="data-legacy" title="Legacy Envelope">
      <p className="m-0 text-ui text-cb-text-soft">
        api() reads routes that have not moved to the envelope yet. A legacy failure sent with 200 throws.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {LEGACY_SAMPLES.map((s) => (
          <figure key={s.label} className="m-0 flex min-w-0 flex-col gap-1.5">
            <figcaption className="text-overline">{s.label}</figcaption>
            <pre className="m-0 overflow-x-auto border border-cb-border bg-cb-fill p-3 font-mono text-xs">
              {JSON.stringify(s.body)}
              {"\n→ "}
              {JSON.stringify(unwrapLegacy(s.body))}
            </pre>
          </figure>
        ))}
      </div>
    </DemoCard>
  );
}
