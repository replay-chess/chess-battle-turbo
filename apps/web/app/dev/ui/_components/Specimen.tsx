import Link from "next/link";
import { cn } from "@/lib/utils";
import { ThemeSwitch } from "./ThemeSwitch";

export type GallerySectionId = "foundations" | "controls" | "overlays" | "shell" | "layout";

export const GALLERY_SECTIONS: { id: GallerySectionId; title: string }[] = [
  { id: "foundations", title: "Foundations" },
  { id: "controls", title: "Controls" },
  { id: "overlays", title: "Overlays" },
  { id: "shell", title: "Shell" },
  { id: "layout", title: "Layout" },
];

export function GallerySection({
  id,
  title,
  children,
}: {
  id: GallerySectionId;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-testid={`gallery-${id}`}
      aria-labelledby={`gallery-${id}-title`}
      className="flex flex-col gap-6"
    >
      <h2 id={`gallery-${id}-title`} className="font-serif text-heading">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Specimen({
  title,
  testId,
  note,
  children,
  className,
}: {
  title: string;
  testId: string;
  note?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <figure data-testid={testId} className={cn("flex flex-col gap-3 border border-cb-border bg-cb-surface p-4", className)}>
      <figcaption className="text-overline">{title}</figcaption>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
      {note ? <p className="text-ui text-cb-text-soft">{note}</p> : null}
    </figure>
  );
}

const NAV_LINK = "inline-flex min-h-11 items-center px-2 text-ui text-cb-text-soft hover:text-cb-text";

/** Header, theme switch and main; shared by /dev/ui and /dev/ui/sections/*. */
export function GalleryFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div data-testid="ui-gallery" className="min-h-screen bg-cb-bg text-cb-text">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-4 border-b border-cb-border bg-cb-bg px-4 py-3 sm:px-8">
        <h1 className="font-serif text-heading">{title}</h1>
        <nav aria-label="Gallery" className="flex flex-wrap items-center gap-1">
          {GALLERY_SECTIONS.map((s) => (
            <Link key={s.id} href={`/dev/ui#${s.id}`} className={NAV_LINK}>
              {s.title}
            </Link>
          ))}
          <Link href="/dev/ui/shell" className={NAV_LINK}>
            Shell Demo
          </Link>
          <Link href="/dev/ui/stage" className={NAV_LINK}>
            Stage Demo
          </Link>
        </nav>
        <ThemeSwitch />
      </header>
      <main className="mx-auto flex max-w-7xl flex-col gap-16 px-4 py-10 sm:px-8">{children}</main>
    </div>
  );
}
