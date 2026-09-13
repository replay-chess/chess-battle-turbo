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
  /** Height override for a directory whose terms require the badge at its issued size. */
  className?: string;
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
    className: "h-11",
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
  {
    // nicklaunches.com free launch (DR 74): verbatim per-product snippet, verified before submit.
    href: "https://nicklaunches.com/products/replaychess/?utm_source=playchess.tech&utm_medium=badge&utm_campaign=featured",
    src: "https://nicklaunches.com/badges/featured.png",
    alt: "ReplayChess on Nick Launches",
    width: 244,
    height: 56,
  },
  {
    // auraplusplus.com free launch (DR 72): link to the project page is what their verifier checks.
    href: "https://auraplusplus.com/projects/replaychess",
    src: "https://auraplusplus.com/images/badges/featured-on-light.svg",
    alt: "Featured on Aura++",
    width: 265,
    height: 58,
  },
  {
    // launchigniter.com free launch (DR 74): per-product badge, verified from the schedule page.
    href: "https://launchigniter.com/product/replaychess?ref=badge-replaychess",
    src: "https://launchigniter.com/api/badge/replaychess?theme=light",
    alt: "Featured on LaunchIgniter",
    width: 212,
    height: 55,
  },
  {
    // postyourstartup.co free listing (DR 71): per-startup badge; verify from their dashboard.
    href: "https://postyourstartup.co/startup/replaychess-1?ref=badge",
    src: "https://postyourstartup.co/api/badge/replaychess-1?theme=light",
    alt: "Featured on PostYourStartup",
    width: 212,
    height: 55,
  },
  {
    // newtool.site free tier (DR 68): verify from the payment page after deploy.
    href: "https://newtool.site/item/replaychess",
    src: "https://newtool.site/badges/newtool-light.svg",
    alt: "Featured on NewTool.site",
    width: 160,
    height: 54,
  },
  {
    // similarlabs.com free listing (DR 68): verify from the submit modal after deploy.
    href: "https://similarlabs.com",
    src: "https://similarlabs.com/similarlabs-embed-badge-light.svg",
    alt: "Featured on SimilarLabs",
    width: 180,
    height: 54,
  },
  {
    // saasfame.com free tier (DR 68): 180-day review queue; verify from the payment page.
    href: "https://saasfame.com/item/replaychess",
    src: "https://saasfame.com/badge-light.svg",
    alt: "Featured on saasfame.com",
    width: 160,
    height: 54,
  },
  {
    // OpenHunts — club badge required to skip the ~60-week free queue
    href: "https://openhunts.com",
    src: "https://cdn.openhunts.com/badges/club.webp",
    alt: "OpenHunts Club Member",
    width: 486,
    height: 105,
  },
  {
    // First Look — free listing is dofollow while the badge stays up (checked weekly)
    href: "https://firstlook.tools",
    src: "https://firstlook.tools/badge/badge_light.svg",
    alt: "Featured on First Look",
    width: 200,
    height: 54,
  },
  {
    // NavFolders — badge required for the free (dofollow) plan
    href: "https://navfolders.com",
    src: "https://navfolders.com/badge/nav_light.svg",
    alt: "Featured on NavFolders",
    width: 200,
    height: 54,
  },
  {
    // StartupBase — badge moves the free launch into the priority queue (~4-5 weeks vs 10+)
    href: "https://startupbase.io/products/replaychess?utm_source=startupbase&utm_medium=badge&utm_campaign=featured-badge-light",
    src: "https://statics.startupbase.io/site/badges/featured-on-sb.svg",
    alt: "Featured on StartupBase",
    width: 212,
    height: 55,
  },
  {
    // DirOnix — badge required for the free launch (2 dofollow links)
    href: "https://dironix.com",
    src: "https://dironix.com/bage.png",
    alt: "Featured on dironix.com",
    width: 200,
    height: 54,
  },
  {
    // SaaSBison — badge required for the free listing; must stay permanently
    href: "https://saasbison.com",
    src: "https://saasbison.com/badge.png",
    alt: "Featured on SaaSBison",
    width: 200,
    height: 54,
  },
  {
    // EasyDoFollow — listing goes live with a dofollow link once the badge is found
    href: "https://easydofollow.dev/games/replaychess",
    src: "https://easydofollow.dev/badge/easydofollow-badge-light.svg",
    alt: "Featured on EasyDoFollow",
    width: 188,
    height: 56,
  },
  {
    // DanielLaunches — badge required to unlock the free launch date step
    href: "https://daniellaunches.com",
    src: "https://daniellaunches.com/badge-light.svg",
    alt: "Featured on DanielLaunches",
    width: 220,
    height: 48,
  },
  {
    // StartupTrusted — badge required for the free (manually reviewed) listing
    href: "https://startuptrusted.com?ref=playchess.tech",
    src: "https://startuptrusted.com/api/badge?type=featured&style=light",
    alt: "ReplayChess on StartupTrusted",
    width: 240,
    height: 54,
  },
];

export const DIRECTORY_TEXT_LINKS: { href: string; label: string; title?: string }[] = [];

export function DirectoryBadges() {
  const count = DIRECTORY_BADGES.length + DIRECTORY_TEXT_LINKS.length;
  if (count === 0) return null;

  // ~2.5s per badge keeps the pace readable however many directories we add.
  const duration = `${Math.max(30, Math.round(count * 2.5))}s`;

  // The track holds two copies of the list and translates by half its width,
  // so the loop never jumps. The second copy is aria-hidden and untabbable.
  const items = (copy: number) => [
    ...DIRECTORY_BADGES.map((badge) => (
      <li key={`${copy}-${badge.href}`} className="flex shrink-0 items-center">
        {/* eslint-disable-next-line react/jsx-no-target-blank -- keep the referrer: directories verify badge clicks by it */}
        <a
          href={badge.href}
          target="_blank"
          rel="noopener"
          tabIndex={copy === 0 ? 0 : -1}
          className="inline-flex items-center opacity-70 hover:opacity-100 transition-opacity"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- third-party hosted badge, must stay a plain <img> */}
          <img
            src={badge.src}
            alt={badge.alt}
            width={badge.width}
            height={badge.height}
            // Eager on purpose: lazy images inside the moving track never fire their load trigger.
            className={`${badge.className ?? "h-7"} w-auto`}
          />
        </a>
      </li>
    )),
    ...DIRECTORY_TEXT_LINKS.map((link) => (
      <li key={`${copy}-${link.href}`} className="flex shrink-0 items-center">
        {/* eslint-disable-next-line react/jsx-no-target-blank -- keep the referrer: directories verify badge clicks by it */}
        <a
          href={link.href}
          target="_blank"
          rel="noopener"
          title={link.title}
          tabIndex={copy === 0 ? 0 : -1}
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="text-[11px] px-2.5 py-1 border border-cb-border text-cb-text-muted hover:text-cb-text-secondary hover:border-cb-border-strong transition-colors whitespace-nowrap"
        >
          {link.label}
        </a>
      </li>
    )),
  ];

  return (
    <section
      aria-label={`Directories that list ReplayChess (${count})`}
      className="mt-10 pt-6 border-t border-cb-border"
    >
      <p
        style={{ fontFamily: "'Geist', sans-serif" }}
        className="text-[10px] uppercase tracking-[0.2em] text-cb-text-faint mb-3"
      >
        Listed on
      </p>
      <div className="rc-marquee" style={{ ["--rc-marquee-duration" as string]: duration }}>
        <ul className="rc-marquee-track list-none p-0 m-0">
          {items(0)}
          <li aria-hidden="true" className="contents">
            <ul className="contents list-none p-0 m-0">{items(1)}</ul>
          </li>
        </ul>
      </div>
    </section>
  );
}
