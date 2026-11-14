"use client";

// W2 `POST /api/train/sessions` from the hub (Start / Continue Today's Plan) and the bank (Review n Due, Drill These n)
// (phase-05 plan §5.2 S2/S3, §5.3, §5.6). Not optimistic: the session id is made on the server, so the button shows its
// pending spinner and the runner opens once the payload is back; the payload is seeded into `qk.train.session(ref)` so
// the runner's first render needs no fetch.
//
// Idempotency (api §2.8): a UUID v4 `Idempotency-Key` is made on the first click and reused for 10 s for the SAME body,
// so a double click or a retry after a lost response returns the same session. `422 idempotency_key_reused` (the key
// met a different body) → a new key and one retry. `429` stays inline (useRetryCountdown on the host); 402 and 5xx go
// through the global reaction (paywall redirect, toast with the Event ID).
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SessionCreateInput, SessionPayload } from "@repo/contracts/http/train";
import { SessionPayload as SessionPayloadSchema } from "@repo/contracts/http/train";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { noteCreatedSession } from "@/features/train/created-sessions";
import { specSource } from "@/features/train/session-spec";
import { keyFor, runnerHref, type KeyState } from "./session";

export async function createTrainSession(body: SessionCreateInput, idempotencyKey: string): Promise<SessionPayload> {
  const { data } = await api(endpoints.trainSessionCreate, {
    method: "POST",
    body,
    idempotencyKey,
    schema: process.env.NODE_ENV === "production" ? undefined : SessionPayloadSchema,
  });
  return data as SessionPayload;
}

export function useStartSession(options: { onStarted?: (payload: SessionPayload) => void } = {}) {
  const router = useRouter();
  const qc = useQueryClient();
  const last = useRef<KeyState | null>(null);

  const mutation = useMutation({
    mutationFn: async (body: SessionCreateInput): Promise<SessionPayload> => {
      const serial = JSON.stringify(body);
      last.current = keyFor(last.current, serial, Date.now());
      try {
        return await createTrainSession(body, last.current.key);
      } catch (err) {
        if (!isApiError(err) || err.code !== "idempotency_key_reused") throw err;
        last.current = keyFor(null, serial, Date.now());
        return createTrainSession(body, last.current.key);
      }
    },
    onSuccess: (payload, body) => {
      noteCreatedSession(payload.ref, specSource(body));
      qc.setQueryData(qk.train.session(payload.ref), payload);
      void qc.invalidateQueries({ queryKey: qk.train.today(), refetchType: "none" });
      options.onStarted?.(payload);
      router.push(runnerHref(payload));
    },
    meta: { verb: "start", object: "the session" },
  });

  return mutation;
}
