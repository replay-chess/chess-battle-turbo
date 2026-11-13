"use client";
// The /dev/import controls (phase-04 plan §7.7.4): one row per provider with the four modes, a time-to-live, and the
// worker's table as it stands. Talks only to /api/dev/import-fault (which signs the worker call server-side).
//
// Client code must not import @repo/contracts/internal (server-only: HMAC with service keys), so the table's shape
// is restated here and the page (a server component) hands over the TTL cap; the route validates both sides with
// the contract (DevFaultBody in, DevFaultData out).
import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";

type FaultMode = "5xx" | "timeout" | "429" | "off";
type FaultTable = { faults: { provider: "chesscom" | "lichess"; mode: Exclude<FaultMode, "off">; until: string }[] };

const PATH = "/api/dev/import-fault";
const PROVIDERS = [
  { id: "chesscom", label: "Chess.com" },
  { id: "lichess", label: "Lichess" },
] as const;
const MODES: { mode: FaultMode; label: string }[] = [
  { mode: "5xx", label: "503" },
  { mode: "429", label: "429" },
  { mode: "timeout", label: "Timeout" },
  { mode: "off", label: "Off" },
];
const TTLS = ["60", "300", "600"] as const;
type Ttl = (typeof TTLS)[number];

function remaining(until: string, now: number): string {
  const sec = Math.max(0, Math.round((Date.parse(until) - now) / 1000));
  return sec >= 60 ? `${Math.floor(sec / 60)} min ${sec % 60} s` : `${sec} s`;
}

export function FaultPanel({ ttlMaxSec }: { ttlMaxSec: number }) {
  const [table, setTable] = useState<FaultTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ttl, setTtl] = useState<Ttl>("300");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const ctl = new AbortController();
    api(PATH, { signal: ctl.signal })
      .then((r) => setTable((r.data as FaultTable | undefined) ?? null))
      .catch((e: unknown) => {
        if (!(e instanceof ApiError && e.code === "aborted")) setError(e instanceof ApiError ? e.message : "The worker did not answer.");
      });
    return () => ctl.abort();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  async function apply(provider: "chesscom" | "lichess", mode: FaultMode) {
    setBusy(true);
    setError(null);
    try {
      const r = await api(PATH, { method: "POST", body: { v: 1, provider, mode, ttlSec: Math.min(Number(ttl), ttlMaxSec) } });
      setTable((r.data as FaultTable | undefined) ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The worker did not answer.");
    } finally {
      setBusy(false);
    }
  }

  const active = (provider: string) =>
    table?.faults.find((f) => f.provider === provider && Date.parse(f.until) > now) ?? null;

  return (
    <div className="flex flex-col gap-4" data-testid="dev-import-faults">
      {error ? (
        <Banner tone="bad" layout="note" title="Could not reach the worker's fault table">
          {error}
        </Banner>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-cb-text-muted">Lasts</span>
        <Segmented<Ttl>
          aria-label="How long a new fault lasts"
          value={ttl}
          onValueChange={setTtl}
          items={TTLS.map((v) => ({ value: v, label: `${Number(v) / 60} min` }))}
        />
      </div>
      {PROVIDERS.map((p) => {
        const fault = active(p.id);
        return (
          <Card key={p.id} data-testid={`fault-${p.id}`}>
            <CardHeader
              title={p.label}
              action={
                <span className="text-sm tabular-nums text-cb-text-muted" aria-live="polite">
                  {fault ? `${fault.mode === "5xx" ? "503" : fault.mode} · ${remaining(fault.until, now)} left` : "No fault"}
                </span>
              }
            />
            <CardBody>
              <div className="flex flex-wrap gap-2">
                {MODES.map((m) => (
                  <Button
                    key={m.mode}
                    size="sm"
                    variant={m.mode === "off" ? "secondary" : fault?.mode === m.mode ? "primary" : "secondary"}
                    disabled={busy || table === null}
                    aria-pressed={m.mode !== "off" && fault?.mode === m.mode}
                    onClick={() => void apply(p.id, m.mode)}
                    data-testid={`fault-${p.id}-${m.mode}`}
                  >
                    {m.label}
                  </Button>
                ))}
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
