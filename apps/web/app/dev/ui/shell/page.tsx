import type { Metadata } from "next";
import { AppShellView } from "@/components/shell/AppShellView";
import type { DestinationKey } from "@/lib/shell/types";
import { DemoContent, type DemoContentKind } from "./DemoContent";
import { DEMO_USERS, DEMO_USER_IDS, type DemoUserId } from "./demo-users";

export const metadata: Metadata = { title: "Shell Demo", robots: { index: false, follow: false } };

type Params = Record<string, string | string[] | undefined>;

function pick<T extends string>(value: string | string[] | undefined, allowed: readonly T[]): T | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

const CONTENT: readonly DemoContentKind[] = ["page", "list", "empty"];
const CURRENT: readonly DestinationKey[] = ["play", "tournaments", "legends", "openings", "profile"];
const BACK: readonly DestinationKey[] = ["play", "tournaments", "legends", "openings"];

/**
 * /dev/ui/shell (SPEC 3.9): the real AppShellView with demo users.
 * `user=member|trial|admin|norating|payment`, `content=page|list|empty`,
 * `current=play|tournaments|legends|openings|profile`, `back=play|tournaments|legends|openings`.
 */
export default async function ShellDemoPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const userId = pick<DemoUserId>(params.user, DEMO_USER_IDS) ?? "member";
  const content = pick(params.content, CONTENT) ?? "page";
  const current = pick(params.current, CURRENT);
  const back = pick(params.back, BACK);

  return (
    <AppShellView user={DEMO_USERS[userId]} demo currentKey={current} backTo={back}>
      <DemoContent content={content} />
    </AppShellView>
  );
}
