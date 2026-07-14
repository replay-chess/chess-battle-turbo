import Image from "next/image";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { BlogAuthor } from "@/lib/blog-types";

export function AuthorCard({ author }: { author: BlogAuthor }) {
  return (
    <aside
      aria-label={`About ${author.name}`}
      className="mt-14 border-y border-cb-border py-7"
    >
      <div className="flex items-center gap-5">
        <Image
          src={author.image.src}
          alt={author.image.alt}
          width={72}
          height={72}
          className="h-16 w-16 shrink-0 rounded-full object-cover sm:h-[72px] sm:w-[72px]"
        />
        <div>
          <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-cb-text-muted">
            Written by
          </p>
          <Link
            href={author.profilePath}
            className="mt-1 block font-serif text-2xl text-cb-text underline decoration-cb-border-strong underline-offset-4"
          >
            {author.name}
          </Link>
          <p className="mt-1 font-sans text-sm leading-6 text-cb-text-muted">
            {author.bio}
          </p>
          <a
            href={author.socialUrl}
            target="_blank"
            rel="me noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 font-sans text-xs text-cb-text-secondary underline decoration-cb-border-strong underline-offset-4 hover:text-cb-text"
          >
            Follow on X <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      </div>
    </aside>
  );
}
