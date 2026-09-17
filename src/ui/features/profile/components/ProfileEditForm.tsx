import type { ReactNode } from "react";
import type { ProfileMetadata } from "@/domain/profile/types";
import { PROFILE_FIELD_BOUNDS } from "@/domain/profile/types";
import { Button } from "@/components/ui/button";
import { ImageUploadField } from "./ImageUploadField";
import { Input } from "@/ui/components/ui/input";
import { Label } from "@/ui/components/ui/label";
import type { ProfileEditField } from "./ProfileSummary";

interface ProfileEditFormProps {
  formData: ProfileMetadata;
  isSaving: boolean;
  saveError: string | null;
  onChange: (field: keyof ProfileMetadata, value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  /**
   * HTTPS endpoint that receives uploaded images. Undefined means no image host
   * is configured, which is the default: the upload control is then unavailable
   * and the user pastes a URL instead.
   */
  uploadEndpoint?: string;
  /**
   * Field the editor opens on, when it was reached from one empty row of the
   * summary rather than from the screen's primary action.
   */
  focusField?: ProfileEditField;
}

/**
 * Label row with an optional right-aligned counter.
 *
 * The counter is mono and reads `12/50`; the word "characters" is present for
 * screen readers only, so the row stays one line wide and still announces as
 * a count of characters.
 */
function FieldHeader({
  htmlFor,
  children,
  count,
  max,
}: {
  htmlFor: string;
  children: ReactNode;
  count?: number;
  max?: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <Label htmlFor={htmlFor}>{children}</Label>
      {max !== undefined && (
        <span className="relative font-mono text-[11px] text-muted-foreground">
          {count ?? 0}/{max}
          <span className="sr-only"> characters</span>
        </span>
      )}
    </div>
  );
}

const TEXTAREA_CLASS =
  "min-h-20 w-full resize-y rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-[var(--ink-violet-soft)] disabled:pointer-events-none disabled:opacity-50";

export function ProfileEditForm({
  formData,
  isSaving,
  saveError,
  onChange,
  onCancel,
  onSave,
  uploadEndpoint,
  focusField,
}: ProfileEditFormProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="min-w-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-4 [overscroll-behavior:contain] [scrollbar-gutter:stable]">
        <div className="screen-header">
          <h2 className="screen-title">Edit Profile</h2>
          <p className="screen-description">
            Published to your relays for anyone to read.
          </p>
        </div>

        {saveError && (
          <div
            role="alert"
            className="rounded-[10px] bg-[var(--ink-red-soft)] px-3 py-2.5 text-[13px] text-[var(--ink-red)]"
          >
            {saveError}
          </div>
        )}

        <div className="ink-card space-y-4 p-4">
          <div className="space-y-2">
            <FieldHeader
              htmlFor="name"
              count={formData.name?.length}
              max={PROFILE_FIELD_BOUNDS.NAME}
            >
              Display Name
            </FieldHeader>
            <Input
              id="name"
              value={formData.name || ""}
              onChange={(e) => onChange("name", e.target.value)}
              placeholder="Your display name"
              maxLength={PROFILE_FIELD_BOUNDS.NAME}
              disabled={isSaving}
              autoFocus={focusField === "name"}
            />
          </div>

          <div className="space-y-2">
            <FieldHeader
              htmlFor="about"
              count={formData.about?.length}
              max={PROFILE_FIELD_BOUNDS.ABOUT}
            >
              About
            </FieldHeader>
            <textarea
              id="about"
              value={formData.about || ""}
              onChange={(e) => onChange("about", e.target.value)}
              placeholder="A line or two about you"
              maxLength={PROFILE_FIELD_BOUNDS.ABOUT}
              rows={3}
              disabled={isSaving}
              autoFocus={focusField === "about"}
              className={TEXTAREA_CLASS}
            />
          </div>

          {/*
            No preview: loading an entered image URL inside an extension page is
            the same leak the display surface removed.
          */}
          <ImageUploadField
            id="picture"
            label="Profile Picture URL"
            value={formData.picture || ""}
            onChange={(value) => onChange("picture", value)}
            disabled={isSaving}
            placeholder="https://example.com/avatar.jpg"
            uploadEndpoint={uploadEndpoint}
            autoFocus={focusField === "picture"}
          />

          <div className="space-y-2">
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

          <div className="space-y-2">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              value={formData.website || ""}
              onChange={(e) => onChange("website", e.target.value)}
              placeholder="https://yourwebsite.com"
              type="url"
              disabled={isSaving}
              autoFocus={focusField === "website"}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="nip05">NIP-05 Identifier</Label>
            <Input
              id="nip05"
              value={formData.nip05 || ""}
              onChange={(e) => onChange("nip05", e.target.value)}
              placeholder="you@example.com"
              type="email"
              disabled={isSaving}
            />
            <p className="text-[11.5px] text-muted-foreground">
              Verified Nostr address
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lud16">Lightning Address</Label>
            <Input
              id="lud16"
              value={formData.lud16 || ""}
              onChange={(e) => onChange("lud16", e.target.value)}
              placeholder="you@getalby.com"
              type="email"
              disabled={isSaving}
            />
            <p className="text-[11.5px] text-muted-foreground">
              Receive Bitcoin tips
            </p>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 gap-2 px-4 pb-4 pt-2">
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={isSaving}
          className="h-11 flex-1"
        >
          Cancel
        </Button>
        <Button onClick={onSave} disabled={isSaving} className="h-11 flex-[2]">
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
