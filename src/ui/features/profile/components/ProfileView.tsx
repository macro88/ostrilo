import { useState, useEffect } from "react";
import { useProfile } from "@/ui/hooks/useProfile";
import type { ProfileMetadata } from "@/domain/profile/types";
import { Input } from "@/ui/components/ui/input";
import { Label } from "@/ui/components/ui/label";
import { Button } from "@/components/ui/button";
import { ImageUploadField } from "./ImageUploadField";
import { hexToNpub } from "@/domain/utils/crypto";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";
import { RefreshCw, User } from "lucide-react";

export function ProfileView() {
  const { selectedUnlockedKey } = useKeyManager();
  const selectedPubkey = selectedUnlockedKey?.publicKeyHex || null;

  const [isEditing, setIsEditing] = useState(false);
  const { profile, loading, error, updateProfile, refresh } =
    useProfile(selectedPubkey);

  // Edit form state
  const [formData, setFormData] = useState<ProfileMetadata>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const npub = selectedPubkey ? hexToNpub(selectedPubkey) : "";
  const truncatedNpub = npub ? `${npub.slice(0, 10)}...${npub.slice(-6)}` : "";

  // Initialize form data when entering edit mode
  useEffect(() => {
    if (isEditing && profile) {
      setFormData({
        name: profile.name || "",
        display_name: profile.display_name || "",
        about: profile.about || "",
        picture: profile.picture || "",
        banner: profile.banner || "",
        website: profile.website || "",
        nip05: profile.nip05 || "",
        lud16: profile.lud16 || "",
      });
    }
  }, [isEditing, profile]);

  const handleRefresh = async () => {
    await refresh();
  };

  const handleEditClick = () => {
    setIsEditing(true);
    setSaveError(null);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setSaveError(null);
    setFormData({});
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setSaveError(null);

      // Remove empty fields before saving
      const cleanedData: ProfileMetadata = {};
      Object.entries(formData).forEach(([key, value]) => {
        if (value && value.trim() !== "") {
          cleanedData[key as keyof ProfileMetadata] = value.trim();
        }
      });

      await updateProfile(cleanedData);
      setIsEditing(false);
    } catch (err) {
      console.error("Failed to save profile:", err);
      setSaveError(
        err instanceof Error ? err.message : "Failed to save profile"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleInputChange = (field: keyof ProfileMetadata, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  if (!selectedPubkey) {
    return (
      <div className="screen-shell">
        <div className="screen-header text-center">
          <div className="icon-bubble mx-auto mb-3 h-14 w-14">
            <User className="h-6 w-6" />
          </div>
          <h2 className="screen-title">Profile Settings</h2>
          <p className="screen-description">Select a key to manage its Nostr profile.</p>
        </div>
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="screen-shell">
        <div className="screen-header text-center">
          <h2 className="screen-title">Edit Profile</h2>
          <p className="screen-description">
            Update your Nostr identity
          </p>
        </div>

        {saveError && (
          <div className="plush-card status-danger">
            <p className="text-sm text-destructive">{saveError}</p>
          </div>
        )}

        <div className="plush-card space-y-4">
          <div>
            <Label htmlFor="name">Display Name</Label>
            <Input
              id="name"
              value={formData.name || ""}
              onChange={(e) => handleInputChange("name", e.target.value)}
              placeholder="Your display name"
              maxLength={50}
              disabled={isSaving}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {formData.name?.length || 0}/50 characters
            </p>
          </div>

          <div>
            <Label htmlFor="about">About</Label>
            <textarea
              id="about"
              value={formData.about || ""}
              onChange={(e) => handleInputChange("about", e.target.value)}
              placeholder="Tell us about yourself"
              maxLength={500}
              rows={4}
              disabled={isSaving}
              className="min-h-28 w-full resize-y rounded-xl border border-input bg-card px-3 py-2 text-sm shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {formData.about?.length || 0}/500 characters
            </p>
          </div>

          <ImageUploadField
            id="picture"
            label="Profile Picture URL"
            value={formData.picture || ""}
            onChange={(value) => handleInputChange("picture", value)}
            disabled={isSaving}
            placeholder="https://example.com/avatar.jpg"
          />

          <div>
            <Label htmlFor="banner">Banner Image URL</Label>
            <Input
              id="banner"
              value={formData.banner || ""}
              onChange={(e) => handleInputChange("banner", e.target.value)}
              placeholder="https://example.com/banner.jpg"
              type="url"
              disabled={isSaving}
            />
          </div>

          <div>
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              value={formData.website || ""}
              onChange={(e) => handleInputChange("website", e.target.value)}
              placeholder="https://yourwebsite.com"
              type="url"
              disabled={isSaving}
            />
          </div>

          <div>
            <Label htmlFor="nip05">NIP-05 Identifier</Label>
            <Input
              id="nip05"
              value={formData.nip05 || ""}
              onChange={(e) => handleInputChange("nip05", e.target.value)}
              placeholder="you@example.com"
              type="email"
              disabled={isSaving}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Verified Nostr address
            </p>
          </div>

          <div>
            <Label htmlFor="lud16">Lightning Address</Label>
            <Input
              id="lud16"
              value={formData.lud16 || ""}
              onChange={(e) => handleInputChange("lud16", e.target.value)}
              placeholder="you@getalby.com"
              type="email"
              disabled={isSaving}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Receive Bitcoin tips
            </p>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="btn-plush flex-1"
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
          <Button
            variant="outline"
            onClick={handleCancelEdit}
            disabled={isSaving}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // Display mode
  return (
    <div className="screen-shell">
      <div className="screen-header text-center">
        {profile?.picture ? (
          <img
            src={profile.picture}
            alt="Profile"
            className="mx-auto mb-3 h-16 w-16 rounded-full border-2 border-border object-cover shadow-sm"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="icon-bubble mx-auto mb-3 h-16 w-16 text-2xl">
            {profile?.name?.[0]?.toUpperCase() || "?"}
          </div>
        )}
        <h2 className="screen-title">Profile Settings</h2>
        {truncatedNpub && (
          <p className="mx-auto my-2 w-fit rounded-full bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
            {truncatedNpub}
          </p>
        )}
        <p className="screen-description">
          Manage your Nostr identity
        </p>
      </div>

      {error && (
        <div className="plush-card status-danger">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            variant="link"
            onClick={handleRefresh}
            className="mt-2 h-auto p-0 text-xs text-destructive"
          >
            Try again
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <div className="plush-card-compact">
          <h3 className="font-medium mb-1 text-sm">Display Name</h3>
          {loading && !profile ? (
            <p className="text-xs text-muted-foreground animate-pulse">
              Loading...
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {profile?.name || profile?.display_name || "Not set"}
            </p>
          )}
        </div>

        <div className="plush-card-compact">
          <h3 className="font-medium mb-1 text-sm">About</h3>
          {loading && !profile ? (
            <p className="text-xs text-muted-foreground animate-pulse">
              Loading...
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {profile?.about || "Add a bio"}
            </p>
          )}
        </div>

        <div className="plush-card-compact">
          <h3 className="font-medium mb-1 text-sm">Website</h3>
          {loading && !profile ? (
            <p className="text-xs text-muted-foreground animate-pulse">
              Loading...
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {profile?.website || "Add your website"}
            </p>
          )}
        </div>

        {profile?.nip05 && (
          <div className="plush-card-compact">
            <h3 className="font-medium mb-1 text-sm">NIP-05</h3>
            <p className="text-xs text-muted-foreground">{profile.nip05}</p>
          </div>
        )}

        {profile?.lud16 && (
          <div className="plush-card-compact">
            <h3 className="font-medium mb-1 text-sm">Lightning Address</h3>
            <p className="text-xs text-muted-foreground">{profile.lud16}</p>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleEditClick}
            disabled={loading}
            className="btn-plush flex-1"
          >
            Edit Profile
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={handleRefresh}
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
