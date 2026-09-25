import { useState } from "react";
import { useProfile } from "@/ui/hooks/useProfile";
import type { ProfileMetadata } from "@/domain/profile/types";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";
import { ProfileEditForm } from "./ProfileEditForm";
import { ProfileSummary, type ProfileEditField } from "./ProfileSummary";
import { userFacingError } from "@/ui/lib/user-facing-error";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";

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
  const [focusField, setFocusField] = useState<ProfileEditField | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Supplied already encoded by the background. `hexToNpub` used to do this
  // here: it decoded hex with a non-null assertion, caught every error, and
  // returned the raw hex string as a 'fallback', so a caller could not tell a
  // successful encode from a failed one and the page silently showed a hex
  // key where an npub was requested.
  const npub = selectedUnlockedKey?.publicKeyBech32 ?? "";

  const handleRefresh = async () => {
    await refresh();
  };

  /**
   * Opens the editor, optionally on the field the user pressed.
   *
   * An empty row is a control, so pressing "Add Website" has to land on the
   * website input rather than on the top of a form the user then has to
   * search.
   */
  const handleEditClick = (field?: ProfileEditField) => {
    setFormData(createProfileFormData(profile));
    setFocusField(field);
    setIsEditing(true);
    setSaveError(null);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setSaveError(null);
    setFormData({});
    setFocusField(undefined);
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
      setFocusField(undefined);
    } catch (err) {
      console.error("Failed to save profile:", err);
      setSaveError(
        userFacingError(err, "Could not save the profile. Try again.", {
          [RPC_ERROR_CODES.INVALID_PARAMS]:
            "Some fields are not valid. Image and website links must start with https://.",
          [RPC_ERROR_CODES.NETWORK_ERROR]:
            "No relay accepted the update. Your edits are still here; check your relays and try again.",
          [RPC_ERROR_CODES.NO_KEY_SELECTED]: "Choose an active key before saving the profile.",
          [RPC_ERROR_CODES.LOCKED]: "The vault is locked. Unlock it and save again.",
        })
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
        <div className="screen-header">
          <h2 className="screen-title">Profile Settings</h2>
          <p className="screen-description">
            Select a key to manage its Nostr profile.
          </p>
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
        focusField={focusField}
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
