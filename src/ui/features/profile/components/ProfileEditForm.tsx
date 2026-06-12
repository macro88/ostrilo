import type { ProfileMetadata } from "@/domain/profile/types";
import { Button } from "@/components/ui/button";
import { ImageUploadField } from "./ImageUploadField";
import { Input } from "@/ui/components/ui/input";
import { Label } from "@/ui/components/ui/label";

interface ProfileEditFormProps {
  formData: ProfileMetadata;
  isSaving: boolean;
  saveError: string | null;
  onChange: (field: keyof ProfileMetadata, value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

export function ProfileEditForm({
  formData,
  isSaving,
  saveError,
  onChange,
  onCancel,
  onSave,
}: ProfileEditFormProps) {
  return (
    <div className="screen-shell">
      <div className="screen-header text-center">
        <h2 className="screen-title">Edit Profile</h2>
        <p className="screen-description">Update your Nostr identity</p>
      </div>

      {saveError && (
        <div className="ink-card p-4 bg-[var(--ink-red-soft)] text-[var(--ink-red)]">
          <p className="text-sm text-destructive">{saveError}</p>
        </div>
      )}

      <div className="ink-card p-4 space-y-4">
        <div>
          <Label htmlFor="name">Display Name</Label>
          <Input
            id="name"
            value={formData.name || ""}
            onChange={(e) => onChange("name", e.target.value)}
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
            onChange={(e) => onChange("about", e.target.value)}
            placeholder="Tell us about yourself"
            maxLength={500}
            rows={4}
            disabled={isSaving}
            aria-label="About"
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
          onChange={(value) => onChange("picture", value)}
          disabled={isSaving}
          placeholder="https://example.com/avatar.jpg"
        />

        <div>
          <Label htmlFor="banner">Banner Image URL</Label>
          <Input
            id="banner"
            value={formData.banner || ""}
            onChange={(e) => onChange("banner", e.target.value)}
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
            onChange={(e) => onChange("website", e.target.value)}
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
            onChange={(e) => onChange("nip05", e.target.value)}
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
            onChange={(e) => onChange("lud16", e.target.value)}
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
        <Button onClick={onSave} disabled={isSaving} className="flex-1">
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
