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
}[] = [];

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
              className="inline-flex h-8 items-center opacity-70 hover:opacity-100 transition-opacity"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- third-party hosted badge, must stay a plain <img> */}
              <img
                src={badge.src}
                alt={badge.alt}
                width={badge.width}
                height={badge.height}
                loading="lazy"
                className="h-8 w-auto"
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
