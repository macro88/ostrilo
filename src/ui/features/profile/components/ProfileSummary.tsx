import type { ProfileMetadata } from "@/domain/profile/types";
import { Button } from "@/components/ui/button";
import { Pubkey } from "@/components/common/pubkey";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { isAllowedRemoteUrl } from "@/domain/profile/types";
import type { ProfilePictureStatus } from "../hooks/useProfilePicture";
import { ProfileField, ProfileTextField } from "./ProfileField";
import { RemoteUrlField } from "./RemoteUrlField";

/** A field of the published profile, as the summary addresses it. */
export type ProfileEditField = "display_name" | "about" | "website" | "picture";

interface ProfileSummaryProps {
  profile: ProfileMetadata | null;
  loading: boolean;
  error: string | null;
  npub: string;
  onEdit: (field?: ProfileEditField) => void;
  onRefresh: () => void;
  /** Where the local copy of the picture stands; see `useProfilePicture`. */
  pictureStatus: ProfilePictureStatus;
  /** Loads the picture once and keeps a small copy for the header. */
  onRefreshPicture: () => void;
}

/**
 * The `name` field, when the Display Name row is not already showing it.
 *
 * That row prefers `display_name`, so a profile with both would otherwise hide
 * its username entirely, and editing it would look like a save that did nothing.
 */
function distinctUsername(profile: ProfileMetadata | null): string | undefined {
  const name = profile?.name;
  return profile?.display_name && name && name !== profile.display_name ? name : undefined;
}

function pictureStatusText(status: ProfilePictureStatus): string {
  switch (status.kind) {
    case "working":
      return "Loading the picture to keep a copy...";
    case "saved":
      return "The header now shows this picture.";
    case "failed":
      return status.note;
    case "idle":
      return "";
  }
}

/**
 * The privacy statement for the picture, and the one control that loads it.
 *
 * This is the only place Ostrilo loads a remote image, so it says so: the load
 * happens on a save or on this button, once, and what stays is a small local
 * copy. A failure keeps the seal in the header and says why here, where the
 * user acted, not in the header.
 */
function PictureCopyBlock({
  canRefresh,
  status,
  onRefresh,
}: {
  canRefresh: boolean;
  status: ProfilePictureStatus;
  onRefresh: () => void;
}) {
  const working = status.kind === "working";
  return (
    <div className="flex items-start justify-between gap-3 px-1">
      <div className="min-w-0 space-y-1 text-[11.5px] text-muted-foreground">
        <p>
          Ostrilo loads your picture once, when you save or refresh it, and
          keeps a small copy for the header.
        </p>
        <output
          className={cn(
            "block break-words empty:hidden",
            status.kind === "failed" && "text-[var(--ink-amber)]"
          )}
        >
          {pictureStatusText(status)}
        </output>
      </div>
      {canRefresh && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={working}
          className="shrink-0"
        >
          Refresh picture
        </Button>
      )}
    </div>
  );
}

/**
 * The identity strip: the local seal, and the npub as a real control.
 *
 * The name is deliberately absent. The header names the active key on every
 * tab and the published name is a row of the card below, so printing it here
 * as well said the same thing three times on one screen. What is nowhere else
 * on this screen is the npub, so that is what this block carries - mono,
 * middle-truncated, with copy and QR, the treatment §7 asks for.
 *
 * The seal is the local mark with the profile's initial, never the relay's
 * picture: a relay chooses that URL, and this page holds the signing session,
 * so loading it would tell an attacker-selected host the user's IP address
 * every time the profile surface renders. The URL stays inspectable in the
 * card below.
 */
function IdentityStrip({ initial, npub }: { initial: string; npub: string }) {
  return (
    <section className="ink-card overflow-hidden" aria-label="Active identity">
      <div className="ink-row">
        <span
          className="seal flex h-10 w-10 shrink-0 items-center justify-center bg-secondary text-base font-bold text-secondary-foreground"
          aria-hidden="true"
        >
          {initial}
        </span>
        <Pubkey pubkey={npub} className="min-w-0 flex-1" />
      </div>
    </section>
  );
}

function ProfileError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-[10px] bg-[var(--ink-red-soft)] px-3 py-2.5 text-[13px] text-[var(--ink-red)]"
    >
      <p className="min-w-0">{message}</p>
      <Button
        variant="link"
        onClick={onRetry}
        className="h-auto shrink-0 p-0 text-[13px] font-semibold text-[var(--ink-red)]"
      >
        Try again
      </Button>
    </div>
  );
}

function PublicProfileCard({
  profile,
  profileName,
  username,
  loading,
  onEdit,
}: {
  profile: ProfileMetadata | null;
  profileName: string;
  username: string | undefined;
  loading: boolean;
  onEdit: (field?: ProfileEditField) => void;
}) {
  return (
    <div className="ink-card overflow-hidden" aria-busy={loading}>
      <ProfileTextField
        label="Display Name"
        loading={loading}
        value={profileName}
        onAdd={() => onEdit("display_name")}
      />
      {username && <ProfileField label="Username" loading={false} value={username} />}
      <ProfileTextField
        label="About"
        loading={loading}
        value={profile?.about}
        multiline
        onAdd={() => onEdit("about")}
      />

      <RemoteUrlField
        label="Website"
        loading={loading}
        value={profile?.website}
        onAdd={() => onEdit("website")}
        openLabel="Open website in a new tab"
      />
      <RemoteUrlField
        label="Picture URL"
        loading={loading}
        value={profile?.picture}
        onAdd={() => onEdit("picture")}
        openLabel="Open picture in a new tab"
      />

      {profile?.nip05 && (
        <ProfileField label="NIP-05" loading={false} value={profile.nip05} />
      )}
      {profile?.lud16 && (
        <ProfileField label="Lightning Address" loading={false} value={profile.lud16} />
      )}
    </div>
  );
}

export function ProfileSummary({
  profile,
  loading,
  error,
  npub,
  onEdit,
  onRefresh,
  pictureStatus,
  onRefreshPicture,
}: ProfileSummaryProps) {
  // Only the first fetch has nothing to show. A refresh over a cached profile
  // keeps the values on screen and spins the refresh control instead. While it
  // lasts every row is a placeholder and the primary is held: the card is in
  // one state, never half loaded.
  const showLoadingField = loading && !profile;
  // Same preference as the key switcher in the header, so the two never name
  // the same identity differently.
  const profileName = profile?.display_name || profile?.name || "";
  const username = distinctUsername(profile);
  const isUnpublished =
    !showLoadingField &&
    !profileName &&
    !profile?.about &&
    !profile?.website &&
    !profile?.picture;

  return (
    <div className="flex h-full flex-col">
      {/*
        One scroll container holds both the content and the action row. The
        row is sticky to the container's bottom edge: with a short profile it
        sits directly under the card, with a long one it stays in reach while
        the rows scroll beneath it.
      */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden [overscroll-behavior:contain] [scrollbar-gutter:stable]">
        {/* space-y-3, not 4: at 400x600 the four rows, the note under them and
            the action row come to just over the viewport at space-y-4, which
            cut the privacy line in half at rest. */}
        <div className="space-y-3 px-4 pt-4">
          <div className="screen-header">
            <h2 className="screen-title">Profile Settings</h2>
            {/*
              An empty screen is an invitation to act, so it says what the
              screen is for. Once something is published the rows say it
              better than a sentence could.
            */}
            {isUnpublished && (
              <p className="screen-description">
                Publish a name and bio so apps can show who you are.
              </p>
            )}
          </div>

          {error && <ProfileError message={error} onRetry={onRefresh} />}

          <IdentityStrip
            initial={profileName[0]?.toUpperCase() || "?"}
            npub={npub}
          />

          <section className="space-y-2">
            <p className="section-label">Public profile</p>
            <PublicProfileCard
              profile={profile}
              profileName={profileName}
              username={username}
              loading={showLoadingField}
              onEdit={onEdit}
            />
            <PictureCopyBlock
              canRefresh={!showLoadingField && isAllowedRemoteUrl(profile?.picture)}
              status={pictureStatus}
              onRefresh={onRefreshPicture}
            />
          </section>
        </div>

        <div className="sticky bottom-0 flex gap-2 bg-background px-4 pb-4 pt-3">
          <Button
            variant="outline"
            onClick={onRefresh}
            disabled={loading}
            className="h-11 w-11 shrink-0 px-0"
            title="Refresh profile from relays"
            aria-label="Refresh profile from relays"
          >
            <RefreshCw
              className={cn("h-4 w-4", loading && "motion-safe:animate-spin")}
            />
          </Button>
          <Button
            onClick={() => onEdit()}
            disabled={showLoadingField}
            className="h-11 flex-1"
          >
            Edit Profile
          </Button>
        </div>
      </div>
    </div>
  );
}
