import { useState } from "react";
import { isAvatarDataUrl, type AvatarRow } from "@/domain/profile/avatar";

interface OwnAvatarImageProps {
  avatar: AvatarRow | null;
  /** The display name, so the image is named for the identity it belongs to. */
  alt: string;
  /** Edge in pixels. Fixed, so the image can never size its container. */
  size: number;
}

/**
 * The user's own picture, drawn from its stored local copy.
 *
 * The source is always a `data:` URL: anything else is refused here as well as
 * where the copy is stored, so no caller can make this element request a host.
 * It is laid over the seal fallback rather than replacing it, so a copy that
 * fails to decode leaves the seal showing instead of a broken image.
 *
 * Keyed by public key by the caller; the failure flag therefore resets when the
 * identity changes.
 */
export function OwnAvatarImage({ avatar, alt, size }: OwnAvatarImageProps) {
  const [failed, setFailed] = useState(false);
  if (failed || !avatar || !isAvatarDataUrl(avatar.dataUrl)) return null;

  return (
    <img
      src={avatar.dataUrl}
      alt={alt}
      width={size}
      height={size}
      decoding="async"
      referrerPolicy="no-referrer"
      className="absolute inset-0 size-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}
