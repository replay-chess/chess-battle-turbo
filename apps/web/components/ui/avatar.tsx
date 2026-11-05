"use client";

// Avatar (SPEC 3.5, 6.2; 02 §5.18 `.av` / `.avt` / `.avc`).
import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { AVATAR_GRADIENT_CLASSES, gradientBackground, initials } from "./avatar-gradient";

export type AvatarProps = {
  name: string;
  src?: string | null;
  /** Default 32. */
  size?: 28 | 32 | 36 | 56 | 72;
  /** Default "gradient". */
  variant?: "neutral" | "ink" | "gradient";
  /** Gradient hash seed, default name. Pass a stable id (user or reference id) when there is one. */
  seed?: string;
  /** Default true → aria-hidden; false → role="img" aria-label={name}. Keep the name visible beside a decorative avatar. */
  decorative?: boolean;
  className?: string;
};

const SIZE: Record<NonNullable<AvatarProps["size"]>, string> = {
  28: "size-7",
  32: "size-8",
  36: "size-9",
  56: "size-14",
  72: "size-18",
};

/** Serif initials scale with the disc; mono initials stay label-sized until 56. */
const SERIF_TEXT: Record<NonNullable<AvatarProps["size"]>, string> = {
  28: "text-xs",
  32: "text-sm",
  36: "text-[0.9375rem]",
  56: "text-2xl",
  72: "text-[1.75rem]",
};
const MONO_TEXT: Record<NonNullable<AvatarProps["size"]>, string> = {
  28: "text-2xs",
  32: "text-label",
  36: "text-label",
  56: "text-sm",
  72: "text-base",
};

/**
 * A round avatar: an image when `src` loads, otherwise initials.
 * `gradient` picks one of six pairs from a hash of `seed`; `neutral` is the
 * mono `.av` disc; `ink` is the accent-filled opponent chip.
 */
export function Avatar({
  name,
  src,
  size = 32,
  variant = "gradient",
  seed,
  decorative = true,
  className,
}: AvatarProps) {
  // Remember which src failed, so a new src gets a fresh attempt without an effect.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;

  const a11y = decorative
    ? { "aria-hidden": true as const }
    : showImage
      ? {}
      : { role: "img" as const, "aria-label": name };

  return (
    <span
      {...a11y}
      data-variant={variant}
      style={variant === "gradient" && !showImage ? { backgroundImage: gradientBackground(seed ?? name) } : undefined}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full leading-none select-none",
        SIZE[size],
        variant === "neutral" && ["border border-cb-border-strong bg-cb-fill font-mono text-cb-text-soft", MONO_TEXT[size]],
        variant === "ink" && ["bg-cb-accent font-mono text-cb-accent-fg", MONO_TEXT[size]],
        variant === "gradient" && [AVATAR_GRADIENT_CLASSES, SERIF_TEXT[size]],
        className,
      )}
    >
      {showImage ? (
        <Image
          src={src!}
          width={size}
          height={size}
          alt={decorative ? "" : name}
          unoptimized
          draggable={false}
          onError={() => setFailedSrc(src ?? null)}
          // An image that failed before hydration never fires onError: check it on mount.
          ref={(img) => {
            if (img && img.complete && img.naturalWidth === 0) setFailedSrc(src ?? null);
          }}
          className="size-full rounded-full object-cover"
        />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  );
}
