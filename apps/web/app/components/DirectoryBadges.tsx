/**
 * Reciprocal directory links. Several free directories only publish (or only
 * mark dofollow) a listing after their crawler finds their badge or a text
 * link on our site. Every entry here is load-bearing for a live listing —
 * never remove one without first checking that listing in the tracker
 * (marketing/directory-playbook-*.csv).
 *
 * Badge entries copy the snippet each directory's "embed" modal generates,
 * verbatim: their verifiers substring-match href/src and reject variations.
 * Plain <a> tags on purpose (no next/link, no rel="nofollow").
 */
export const DIRECTORY_BADGES: {
  href: string;
  src: string;
  alt: string;
  width?: number;
  height?: number;
}[] = [
  {
    // twelve.tools free tier (DR 82): listing goes live once their verifier sees this badge.
    href: "https://twelve.tools",
    src: "https://twelve.tools/badge0-white.svg",
    alt: "Featured on Twelve Tools",
    width: 148,
    height: 40,
  },
  {
    // tooldirs.com free tier (DR 66): verifier checks for this exact badge before publishing.
    href: "https://tooldirs.com",
    src: "https://tooldirs.com/badge/badge_dark.svg",
    alt: "Featured on ToolDirs",
    width: 200,
    height: 54,
  },
  {
    // wired.business free tier (DR 77): same verifier family as twelve.tools.
    href: "https://wired.business",
    src: "https://wired.business/badge0-dark.svg",
    alt: "Featured on Wired Business",
    width: 200,
    height: 54,
  },
  {
    // fazier.com free launch (DR 55): verbatim from their "Copy embed code" — the deep-link href is what they check.
    href: "https://fazier.com/launches/www.playchess.tech",
    src: "https://fazier.com/api/v1//public/badges/launch_badges.svg?badge_type=launched&theme=light",
    alt: "Fazier badge",
    width: 120,
  },
  {
    // neeed.directory (DR 72): free listing is nofollow until this badge is verified from the product page.
    href: "https://neeed.directory",
    src: "https://neeed.directory/badges/neeed-badge-light.svg",
    alt: "Featured on neeed.directory",
    width: 139,
  },
  {
    // startupfa.st free launch (DR 71): requires this badge (150×44, dofollow) before submission.
    href: "https://startupfa.st",
    src: "https://startupfa.st/images/badges/powered-by-light.svg",
    alt: "Powered by Startup Fast",
    width: 150,
    height: 44,
  },
  {
    // domainrank.app free tier (DR 64): auto-verified badge, 1 dofollow link. Verbatim snippet.
    href: "https://domainrank.app",
    src: "https://domainrank.app/api/badge/playchess.tech?theme=dark",
    alt: "playchess.tech Domain Rating",
    width: 360,
    height: 80,
  },
  {
    // easylaunch.dev (DR 51): listing goes live with a dofollow link once this badge is found.
    href: "https://easylaunch.dev/games/replaychess",
    src: "https://easylaunch.dev/badge/easylaunch-badge-light.svg",
    alt: "Featured on EasyLaunch",
    width: 188,
    height: 56,
  },
  {
    // listmysaas.xyz free tier (DR 48): verify from their dashboard after deploy.
    href: "https://listmysaas.xyz/",
    src: "https://listmysaas.xyz/listmysaasbadgenormal.svg",
    alt: "Featured on ListMySaaS",
    width: 125,
    height: 44,
  },
];

export const DIRECTORY_TEXT_LINKS: { href: string; label: string; title?: string }[] = [];

export function DirectoryBadges() {
  const count = DIRECTORY_BADGES.length + DIRECTORY_TEXT_LINKS.length;
  if (count === 0) return null;

  return (
    <section
      aria-label={`Directories that list ReplayChess (${count})`}
      className="mt-10 pt-6 border-t border-cb-border"
    >
      <p
        style={{ fontFamily: "'Geist', sans-serif" }}
        className="text-[10px] uppercase tracking-[0.2em] text-cb-text-faint mb-4"
      >
        Listed on
      </p>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-3 list-none p-0 m-0">
        {DIRECTORY_BADGES.map((badge) => (
          <li key={badge.href} className="flex items-center">
            {/* eslint-disable-next-line react/jsx-no-target-blank -- keep the referrer: directories verify badge clicks by it */}
            <a
              href={badge.href}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center opacity-80 hover:opacity-100 transition-opacity"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- third-party hosted badge, must stay a plain <img> */}
              {/* Rendered at the directory's declared size: some verifiers reject badges displayed smaller than issued. */}
              <img
                src={badge.src}
                alt={badge.alt}
                width={badge.width}
                height={badge.height}
                loading="lazy"
                className="max-h-14 w-auto"
              />
            </a>
          </li>
        ))}
        {DIRECTORY_TEXT_LINKS.map((link) => (
          <li key={link.href}>
            {/* eslint-disable-next-line react/jsx-no-target-blank -- keep the referrer: directories verify badge clicks by it */}
            <a
              href={link.href}
              target="_blank"
              rel="noopener"
              title={link.title}
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-[11px] px-2.5 py-1 border border-cb-border text-cb-text-muted hover:text-cb-text-secondary hover:border-cb-border-strong transition-colors"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
