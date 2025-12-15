import { useState, useEffect } from "react";
import { useProfile } from "@/ui/hooks/useProfile";
import type { ProfileMetadata } from "@/domain/profile/types";
import { Input } from "@/ui/components/ui/input";
import { Label } from "@/ui/components/ui/label";
import { ImageUploadField } from "./ImageUploadField";
import { hexToNpub } from "@/domain/utils/crypto";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";

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
  const truncatedNpub = npub
    ? `${npub.slice(0, 10)}...${npub.slice(-6)}`
    : "";

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
      <div className="h-full overflow-y-auto p-3 space-y-3">
        <div className="text-center">
          <div className="w-16 h-16 bg-muted rounded-full mx-auto mb-2"></div>
          <h2 className="text-xl font-semibold">Profile Settings</h2>
          <p className="text-muted-foreground text-sm">No key selected</p>
        </div>
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="h-full overflow-y-auto p-3 space-y-3">
        <div className="text-center mb-4">
          <h2 className="text-xl font-semibold">Edit Profile</h2>
          <p className="text-muted-foreground text-sm">
            Update your Nostr identity
          </p>
        </div>

        {saveError && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
            <p className="text-sm text-destructive">{saveError}</p>
          </div>
        )}

        <div className="space-y-3">
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
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary"
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
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground py-2 px-4 rounded-lg font-medium text-sm disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
          <button
            onClick={handleCancelEdit}
            disabled={isSaving}
            className="px-4 py-2 border border-border rounded-lg font-medium text-sm hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Display mode
  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      <div className="text-center">
        {profile?.picture ? (
          <img
            src={profile.picture}
            alt="Profile"
            className="w-16 h-16 rounded-full mx-auto mb-2 object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="w-16 h-16 bg-muted rounded-full mx-auto mb-2 flex items-center justify-center text-2xl">
            {profile?.name?.[0]?.toUpperCase() || "?"}
          </div>
        )}
        <h2 className="text-xl font-semibold">Profile Settings</h2>
        {truncatedNpub && (
          <p className="text-xs text-muted-foreground font-mono mb-1">
            {truncatedNpub}
          </p>
        )}
        <p className="text-muted-foreground text-sm">
          Manage your Nostr identity
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={handleRefresh}
            className="mt-2 text-xs text-destructive underline"
          >
            Try again
          </button>
        </div>
      )}

      <div className="space-y-2">
        <div className="bg-card border border-border rounded-lg p-3">
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

        <div className="bg-card border border-border rounded-lg p-3">
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

        <div className="bg-card border border-border rounded-lg p-3">
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
          <div className="bg-card border border-border rounded-lg p-3">
            <h3 className="font-medium mb-1 text-sm">NIP-05</h3>
            <p className="text-xs text-muted-foreground">{profile.nip05}</p>
          </div>
        )}

        {profile?.lud16 && (
          <div className="bg-card border border-border rounded-lg p-3">
            <h3 className="font-medium mb-1 text-sm">Lightning Address</h3>
            <p className="text-xs text-muted-foreground">{profile.lud16}</p>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleEditClick}
            disabled={loading}
            className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground py-2 px-4 rounded-lg font-medium text-sm disabled:opacity-50"
          >
            Edit Profile
          </button>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="px-4 py-2 border border-border rounded-lg font-medium text-sm hover:bg-muted disabled:opacity-50"
            title="Refresh profile from relays"
          >
            ↻
          </button>
        </div>
      </div>
    </div>
  );
}
