import { PricingContent } from "./PricingContent";

/**
 * The query string decides which state the page opens in (checkout return,
 * paywall landing, preselected plan). Reading it here, on the server, keeps
 * the hero, pricing card and FAQ in the HTML for crawlers; a client-side
 * `useSearchParams()` at the page root would bail the whole tree out to
 * client rendering and ship an empty document.
 */
interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function PricingPage({ searchParams }: Props) {
  const params = await searchParams;
  return (
    <PricingContent
      checkout={first(params.checkout)}
      status={first(params.status)}
      reason={first(params.reason)}
      redirectUrl={first(params.redirect_url)}
      plan={first(params.plan)}
    />
  );
}
