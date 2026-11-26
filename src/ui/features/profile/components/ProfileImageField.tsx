import { useEffect, useRef } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { Label } from "@/ui/components/ui/label";
import type {
  UploadField,
  UploadState,
} from "../blossom-upload.controller";
import type { BlossomUpload } from "../hooks/useBlossomUpload";

interface ProfileImageFieldProps {
  id: string;
  /** Which profile field this writes: the picture or the banner. */
  field: UploadField;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  upload: Pick<BlossomUpload, "state" | "begin" | "cancel" | "dismiss">;
}

const ACCEPTED_TYPES = "image/jpeg,image/png,image/gif,image/webp";

function progressText(state: Extract<UploadState, { stage: "working" }>): string {
  switch (state.step) {
    case "preparing":
      return "Preparing image...";
    case "authorising":
      return "Authorising...";
    case "uploading":
      return `Uploading to ${state.host}...`;
  }
}

/**
 * An image address that can be pasted or uploaded.
 *
 * Pasting works with no upload at all. An upload goes through the form's one
 * upload slot, so while any upload runs the Upload action is off on both image
 * fields and only the field that owns it offers Cancel. There is no preview: an
 * extension page does not load an address the user typed.
 */
export function ProfileImageField({
  id,
  field,
  label,
  value,
  onChange,
  disabled = false,
  placeholder,
  upload,
}: ProfileImageFieldProps) {
  const { state } = upload;
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const owns = state.stage !== "idle" && state.field === field;
  const working = owns && state.stage === "working";
  const busy =
    state.stage === "inspecting" ||
    state.stage === "choosing" ||
    state.stage === "working";

  // The Upload action is replaced by Cancel while this field's upload runs, so
  // keyboard focus moves with it instead of falling to the page.
  useEffect(() => {
    if (working) cancelRef.current?.focus();
  }, [working]);

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    // Focus returns here when the dialog closes.
    uploadRef.current?.focus();
    void upload.begin(file, field);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => {
          if (owns && (state.stage === "done" || state.stage === "failed")) {
            upload.dismiss();
          }
          onChange(event.target.value);
        }}
        placeholder={placeholder}
        type="url"
        disabled={disabled || working}
        aria-describedby={`${id}-help`}
      />

      {working ? (
        <output className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
            {progressText(state)}
          </span>
          <Button
            ref={cancelRef}
            variant="outline"
            size="sm"
            onClick={upload.cancel}
          >
            Cancel
          </Button>
        </output>
      ) : (
        <div className="flex gap-2">
          <Button
            ref={uploadRef}
            id={`${id}-upload`}
            variant="outline"
            className="min-w-0 flex-1"
            disabled={disabled || busy}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-4" aria-hidden="true" />
            <span className="truncate">Upload image</span>
          </Button>
          {value && (
            <Button
              variant="outline"
              title="Remove image"
              disabled={disabled || busy}
              onClick={() => {
                if (owns) upload.dismiss();
                onChange("");
              }}
            >
              Remove
            </Button>
          )}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_TYPES}
        onChange={handleFile}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />

      {owns && state.stage === "done" && (
        <output className="block text-[12.5px] text-[var(--ink-mint)]">
          {state.message}
        </output>
      )}
      {owns && state.stage === "failed" && (
        <p role="alert" className="text-[12.5px] text-[var(--ink-red)]">
          {state.message}
        </p>
      )}

      <p id={`${id}-help`} className="text-[11.5px] text-muted-foreground">
        Paste an https:// address, or upload a JPEG, PNG, GIF or WebP up to 5 MB.
      </p>
    </div>
  );
}
