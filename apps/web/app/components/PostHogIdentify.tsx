"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import posthog from "posthog-js";

/**
 * Ties PostHog events to the signed-in Clerk user and clears the identity on
 * sign-out. PostHog itself is initialised in instrumentation-client.ts.
 */
export function PostHogIdentify() {
  const { isLoaded, user } = useUser();

  useEffect(() => {
    if (!isLoaded || !process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
    if (user) {
      posthog.identify(user.id, { username: user.username ?? undefined });
    } else if (posthog._isIdentified()) {
      posthog.reset();
    }
  }, [isLoaded, user]);

  return null;
}
