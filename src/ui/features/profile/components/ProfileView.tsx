import { useState, useEffect } from "react";
import { useProfile } from "@/ui/hooks/useProfile";
import { getSettings, listKeys } from "@/infrastructure/messaging/client";
import type { KeyRecord } from "@/domain/types";
import type { ProfileMetadata } from "@/domain/profile/types";
import { Input } from "@/ui/components/ui/input";
import { Label } from "@/ui/components/ui/label";

export function ProfileView() {
  const [selectedPubkey, setSelectedPubkey] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const { profile, loading, error, updateProfile, refresh } =
    useProfile(selectedPubkey);

  // Edit form state
  const [formData, setFormData] = useState<ProfileMetadata>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  
  // Picture upload state
  const [isUploadingPicture, setIsUploadingPicture] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Get selected key on mount
  useEffect(() => {
    const loadSelectedKey = async () => {
      try {
        const settings = await getSettings();
        const selectedKeyId = settings?.selectedKeyId;

        if (selectedKeyId) {
          const keys = await listKeys();
          const selectedKey = keys.find(
            (k: KeyRecord) => k.id === selectedKeyId
          );
          if (selectedKey) {
            setSelectedPubkey(selectedKey.pubkey);
          }
        }
      } catch (err) {
        console.error("Failed to load selected key:", err);
      }
    };

    loadSelectedKey();
  }, []);

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

  const handlePictureUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!validTypes.includes(file.type)) {
      setUploadError("Please select a valid image file (JPEG, PNG, GIF, or WebP)");
      return;
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setUploadError("Image must be smaller than 5MB");
      return;
    }

    try {
      setIsUploadingPicture(true);
      setUploadError(null);
      setUploadProgress(0);

      const formData = new FormData();
      formData.append("file", file);

      // Simulate progress since nostr.build doesn't provide upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      const response = await fetch("https://nostr.build/api/v2/upload/files", {
        method: "POST",
        body: formData,
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.status === "success" && result.data && result.data[0]?.url) {
        const imageUrl = result.data[0].url;
        handleInputChange("picture", imageUrl);
        setUploadProgress(0);
      } else {
        throw new Error("Invalid response from upload service");
      }
    } catch (err) {
      console.error("Picture upload error:", err);
      setUploadError(
        err instanceof Error ? err.message : "Failed to upload image"
      );
      setUploadProgress(0);
    } finally {
      setIsUploadingPicture(false);
      // Reset the file input so the same file can be selected again if needed
      event.target.value = "";
    }
  };

  const handleRemovePicture = () => {
    handleInputChange("picture", "");
    setUploadError(null);
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

          <div>
            <Label htmlFor="picture">Profile Picture URL</Label>
            <div className="space-y-2">
              <Input
                id="picture"
                value={formData.picture || ""}
                onChange={(e) => handleInputChange("picture", e.target.value)}
                placeholder="https://example.com/avatar.jpg"
                type="url"
                disabled={isSaving || isUploadingPicture}
              />
              
              <div className="flex gap-2">
                <label
                  htmlFor="picture-upload"
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm border border-border rounded-lg cursor-pointer hover:bg-muted transition-colors ${
                    isSaving || isUploadingPicture
                      ? "opacity-50 cursor-not-allowed"
                      : ""
                  }`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  {isUploadingPicture ? "Uploading..." : "Upload Image"}
                </label>
                <input
                  id="picture-upload"
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  onChange={handlePictureUpload}
                  disabled={isSaving || isUploadingPicture}
                  className="hidden"
                />
                {formData.picture && (
                  <button
                    type="button"
                    onClick={handleRemovePicture}
                    disabled={isSaving || isUploadingPicture}
                    className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20 transition-colors disabled:opacity-50"
                    title="Remove picture"
                  >
                    Remove
                  </button>
                )}
              </div>

              {isUploadingPicture && uploadProgress > 0 && (
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-primary h-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}

              {uploadError && (
                <p className="text-xs text-destructive">{uploadError}</p>
              )}

              <p className="text-xs text-muted-foreground">
                Upload an image or paste a URL. Max 5MB (JPEG, PNG, GIF, WebP)
              </p>
            </div>
          </div>

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
