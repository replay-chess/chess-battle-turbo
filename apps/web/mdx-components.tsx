import type { MDXComponents } from "mdx/types";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { InteractiveAnalysisBoardEmbed } from "@/app/blog/_components/InteractiveAnalysisBoardEmbed";
import { MoveSequencePreview } from "@/app/blog/_components/MoveSequencePreview";

function textFromChildren(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number")
    return String(children);
  if (Array.isArray(children)) return children.map(textFromChildren).join("");
  if (children && typeof children === "object" && "props" in children) {
    return textFromChildren(
      (children as { props: { children?: ReactNode } }).props.children,
    );
  }
  return "";
}

function headingId(children: ReactNode) {
  return textFromChildren(children)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function MdxLink({
  href = "",
  children,
  ...props
}: ComponentPropsWithoutRef<"a">) {
  const className =
    "text-cb-text underline decoration-cb-border-strong underline-offset-4 transition-colors hover:decoration-cb-text";
  if (href.startsWith("/")) {
    return (
      <Link href={href} className={className} {...props}>
        {children}
      </Link>
    );
  }
  return (
    <a
      href={href}
      className={className}
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  );
}

export function ArticleImage({
  src,
  alt,
  width = 1200,
  height = 675,
  caption,
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  caption?: string;
}) {
  return (
    <figure className="my-10">
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes="(max-width: 768px) 100vw, 768px"
        className="h-auto w-full border border-cb-border object-cover"
      />
      {caption && (
        <figcaption className="mt-3 font-sans text-xs leading-5 text-cb-text-muted">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

export function PositionLesson({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <aside className="my-8 border-l-2 border-cb-accent bg-cb-hover px-5 py-4">
      <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-cb-text-muted">
        Position lesson
      </p>
      <p className="mt-1 font-serif text-xl text-cb-text">{title}</p>
      <div className="mt-3 font-sans text-sm leading-7 text-cb-text-secondary">
        {children}
      </div>
    </aside>
  );
}

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: ({ children }) => (
      <h1 className="font-serif text-4xl text-cb-text">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2
        id={headingId(children)}
        className="mb-4 mt-12 scroll-mt-28 font-serif text-3xl leading-tight text-cb-text"
      >
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3
        id={headingId(children)}
        className="mb-3 mt-8 scroll-mt-28 font-serif text-2xl leading-tight text-cb-text"
      >
        {children}
      </h3>
    ),
    p: ({ children }) => (
      <p className="mb-5 font-sans text-base leading-8 text-cb-text-secondary">
        {children}
      </p>
    ),
    a: MdxLink,
    ul: ({ children }) => (
      <ul className="mb-6 ml-5 list-disc space-y-2 font-sans text-base leading-7 text-cb-text-secondary">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-6 ml-5 list-decimal space-y-2 font-sans text-base leading-7 text-cb-text-secondary">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="pl-1">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className="my-8 border-l-2 border-cb-border-strong pl-5 font-serif text-xl italic leading-8 text-cb-text-secondary">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-10 border-cb-border" />,
    strong: ({ children }) => (
      <strong className="font-semibold text-cb-text">{children}</strong>
    ),
    table: ({ children }) => (
      <div className="my-8 overflow-x-auto border border-cb-border">
        <table className="w-full border-collapse font-sans text-sm text-cb-text-secondary">
          {children}
        </table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border-b border-cb-border bg-cb-hover px-4 py-3 text-left font-medium text-cb-text">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-b border-cb-border px-4 py-3 align-top">
        {children}
      </td>
    ),
    code: ({ children }) => (
      <code className="bg-cb-hover px-1.5 py-0.5 font-mono text-sm text-cb-text">
        {children}
      </code>
    ),
    ArticleImage,
    PositionLesson,
    InteractiveAnalysisBoard: InteractiveAnalysisBoardEmbed,
    MoveSequencePreview,
    ...components,
  };
}
