// The account's avatar on /settings/connected (D4-26): initials on the V4 `.avc` gradient. Provider avatar images
// stay off until the Chess.com terms review (OD-2) clears: `renderableAvatarUrl()` returns null while
// PROVIDER_AVATARS_ENABLED is false, and the image host is not in next.config.js or the CSP. Decorative: the
// username is always printed beside it.
import { Avatar } from "@/components/ui/avatar";
import { AVATAR_GRADIENT_CLASSES, gradientBackground } from "@/components/ui/avatar-gradient";
import { accountInitials, renderableAvatarUrl } from "@/lib/accounts/avatars";
import { cn } from "@/lib/utils";

export function ProviderAvatar({ username, avatarUrl, seed }: { username: string; avatarUrl: string | null; seed: string }) {
  const src = renderableAvatarUrl(avatarUrl);
  if (src) return <Avatar name={username} src={src} size={36} seed={seed} className="size-10" />;
  return (
    <span
      aria-hidden="true"
      data-testid="account-initials"
      style={{ backgroundImage: gradientBackground(seed) }}
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-base leading-none tracking-[0.02em] select-none",
        AVATAR_GRADIENT_CLASSES,
      )}
    >
      {accountInitials(username)}
    </span>
  );
}
