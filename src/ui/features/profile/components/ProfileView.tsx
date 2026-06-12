import { useState } from "react";
import { useProfile } from "@/ui/hooks/useProfile";
import type { ProfileMetadata } from "@/domain/profile/types";
import { hexToNpub } from "@/domain/utils/crypto";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";
import { User } from "lucide-react";
import { ProfileEditForm } from "./ProfileEditForm";
import { ProfileSummary } from "./ProfileSummary";

function createProfileFormData(
  profile: ProfileMetadata | null
): ProfileMetadata {
  return {
    name: profile?.name || "",
    display_name: profile?.display_name || "",
    about: profile?.about || "",
    picture: profile?.picture || "",
    banner: profile?.banner || "",
    website: profile?.website || "",
    nip05: profile?.nip05 || "",
    lud16: profile?.lud16 || "",
  };
}

export function ProfileView() {
  const { selectedUnlockedKey } = useKeyManager();
  const selectedPubkey = selectedUnlockedKey?.publicKeyHex || null;

  const [isEditing, setIsEditing] = useState(false);
  const { profile, loading, error, updateProfile, refresh } =
    useProfile(selectedPubkey);

  const [formData, setFormData] = useState<ProfileMetadata>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const npub = selectedPubkey ? hexToNpub(selectedPubkey) : "";

  const handleRefresh = async () => {
    await refresh();
  };

  const handleEditClick = () => {
    setFormData(createProfileFormData(profile));
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
          <div className="seal inline-flex shrink-0 items-center justify-center bg-secondary text-secondary-foreground mx-auto mb-3 h-14 w-14">
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
      <ProfileEditForm
        formData={formData}
        isSaving={isSaving}
        saveError={saveError}
        onChange={handleInputChange}
        onCancel={handleCancelEdit}
        onSave={handleSave}
      />
    );
  }

  return (
    <ProfileSummary
      profile={profile}
      loading={loading}
      error={error}
      npub={npub}
      onEdit={handleEditClick}
      onRefresh={handleRefresh}
    />
  );
}
