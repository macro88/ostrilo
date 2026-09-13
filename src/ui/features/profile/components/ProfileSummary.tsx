import type { ProfileMetadata } from "@/domain/profile/types";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { ProfileField } from "./ProfileField";
import { RemoteUrlField } from "./RemoteUrlField";

interface ProfileSummaryProps {
  profile: ProfileMetadata | null;
  loading: boolean;
  error: string | null;
  npub: string;
  onEdit: () => void;
  onRefresh: () => void;
}

export function ProfileSummary({
  profile,
  loading,
  error,
  npub,
  onEdit,
  onRefresh,
}: ProfileSummaryProps) {
  const truncatedNpub = npub ? `${npub.slice(0, 10)}...${npub.slice(-6)}` : "";
  const showLoadingField = loading && !profile;

  return (
    <div className="screen-shell">
      <div className="screen-header text-center">
        {/*
          The avatar is the local seal with the profile initial. A relay chooses
          the picture URL, and this page holds the signing session, so loading
          it here would tell an attacker-selected host the user's IP address
          every time the profile surface renders. The URL stays inspectable
          below instead.
        */}
        <div className="seal inline-flex shrink-0 items-center justify-center bg-secondary text-secondary-foreground mx-auto mb-3 h-16 w-16 text-2xl">
          {(profile?.name || profile?.display_name)?.[0]?.toUpperCase() || "?"}
        </div>
        <h2 className="screen-title">Profile Settings</h2>
        {truncatedNpub && (
          <p className="mx-auto my-2 w-fit rounded-lg bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
            {truncatedNpub}
          </p>
        )}
        <p className="screen-description">Manage your Nostr identity</p>
      </div>

      {error && (
        <div className="ink-card p-4 bg-[var(--ink-red-soft)] text-[var(--ink-red)]">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            variant="link"
            onClick={onRefresh}
            className="mt-2 h-auto p-0 text-xs text-destructive"
          >
            Try again
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <ProfileField
          label="Display Name"
          loading={showLoadingField}
          value={profile?.name || profile?.display_name || "Not set"}
        />
        <ProfileField
          label="About"
          loading={showLoadingField}
          value={profile?.about || "Add a bio"}
        />
        <RemoteUrlField
          label="Website"
          value={profile?.website}
          emptyText="Add your website"
          openLabel="Open website in a new tab"
        />
        <RemoteUrlField
          label="Picture URL"
          value={profile?.picture}
          emptyText="No picture URL set. Images are never loaded in this window."
          openLabel="Open picture in a new tab"
        />

        {profile?.nip05 && (
          <ProfileField label="NIP-05" loading={false} value={profile.nip05} />
        )}

        {profile?.lud16 && (
          <ProfileField
            label="Lightning Address"
            loading={false}
            value={profile.lud16}
          />
        )}

        <div className="flex gap-2">
          <Button onClick={onEdit} disabled={loading} className="flex-1">
            Edit Profile
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh profile from relays"
            aria-label="Refresh profile from relays"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
