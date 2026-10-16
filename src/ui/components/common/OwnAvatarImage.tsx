import { useState, type ReactNode } from "react";
import { isAvatarDataUrl, type AvatarRow } from "@/domain/profile/avatar";

interface OwnAvatarImageProps {
  avatar: AvatarRow | null;
  /** The display name, so the image is named for the identity it belongs to. */
  alt: string;
  /** Edge in pixels. Fixed, so the image can never size its container. */
  size: number;
  /** The seal mark: shown until the copy has loaded, and whenever there is none. */
  fallback: ReactNode;
}

function CopyImage({
  avatar,
  alt,
  size,
  fallback,
}: OwnAvatarImageProps & { avatar: AvatarRow }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");

  return (
    <>
      {status !== "loaded" && fallback}
      {status !== "failed" && (
        <img
          src={avatar.dataUrl}
          alt={alt}
          width={size}
          height={size}
          decoding="async"
          referrerPolicy="no-referrer"
          className="absolute inset-0 size-full object-cover"
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("failed")}
        />
      )}
    </>
  );
}

/**
 * The user's own picture, drawn from its stored local copy.
 *
 * The source is always a `data:` URL: anything else is refused here as well as
 * where the copy is stored, so no caller can make this element request a host.
 *
 * The seal shows until the copy has decoded and again if it fails to, but not
 * once the image is up: the picture is shown as the user made it, so a
 * transparent one does not have the seal's initial showing through. A new copy
 * for the same key (a refresh) starts over, so an earlier decode failure does
 * not hide it.
 */
export function OwnAvatarImage({ avatar, alt, size, fallback }: OwnAvatarImageProps) {
  if (!avatar || !isAvatarDataUrl(avatar.dataUrl)) return <>{fallback}</>;

  return (
    <CopyImage
      key={`${avatar.pubkey}:${avatar.at}:${avatar.dataUrl.length}`}
      avatar={avatar}
      alt={alt}
      size={size}
      fallback={fallback}
    />
  );
}
