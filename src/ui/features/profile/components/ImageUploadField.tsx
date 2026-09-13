import { useEffect, useRef, useState } from "react";
import { Input } from "@/ui/components/ui/input";
import { Label } from "@/ui/components/ui/label";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { isAllowedRemoteUrl } from "@/domain/profile/types";

interface ImageUploadFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  helpText?: string;
  /**
   * HTTPS endpoint that receives the uploaded image.
   *
   * Undefined by default: sending a user's image to a third party is a decision
   * the user makes, not a constant in a component, and a fresh install makes no
   * outbound request to anyone but the configured relays.
   */
  uploadEndpoint?: string;
}

/**
 * Return the host that would receive an upload, or null when the endpoint is
 * missing or not an `https:` URL.
 */
function uploadHost(endpoint: string | undefined): string | null {
  if (!endpoint) {
    return null;
  }

  try {
    const parsed = new URL(endpoint);
    return parsed.protocol === "https:" ? parsed.host : null;
  } catch {
    return null;
  }
}

export function ImageUploadField({
  id,
  label,
  value,
  onChange,
  disabled = false,
  placeholder = "https://example.com/image.jpg",
  helpText = "Paste an https:// image URL. Max 5MB (JPEG, PNG, GIF, WebP) if you upload.",
  uploadEndpoint,
}: ImageUploadFieldProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const destinationHost = uploadHost(uploadEndpoint);
  const canUpload = destinationHost !== null;

  useEffect(() => {
    if (!isUploading) {
      return;
    }

    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => Math.min(prev + 10, 90));
    }, 200);

    return () => {
      clearInterval(progressInterval);
    };
  }, [isUploading]);

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!uploadEndpoint || !destinationHost) {
      setUploadError("No image host is configured.");
      event.target.value = "";
      return;
    }

    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!validTypes.includes(file.type)) {
      setUploadError(
        "Please select a valid image file (JPEG, PNG, GIF, or WebP)"
      );
      event.target.value = "";
      return;
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setUploadError("Image must be smaller than 5MB");
      event.target.value = "";
      return;
    }

    // Name the destination before anything leaves the machine.
    const confirmed = window.confirm(
      `Send this image to ${destinationHost}?\n\nThe image and your IP address will be visible to that host.`
    );
    if (!confirmed) {
      event.target.value = "";
      return;
    }

    try {
      setIsUploading(true);
      setUploadError(null);
      setUploadProgress(0);

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(uploadEndpoint, {
        method: "POST",
        body: formData,
      });

      setUploadProgress(100);

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const result = await response.json();
      const returnedUrl = result?.data?.[0]?.url;

      // The upload service is a remote party too: the URL it hands back goes
      // through the same https-only allowlist as anything a relay supplies,
      // and is never fetched or rendered by this page.
      if (result?.status === "success" && isAllowedRemoteUrl(returnedUrl)) {
        onChange(returnedUrl);
        setUploadProgress(0);
      } else {
        throw new Error(
          "The image host returned a URL that is not an https:// address"
        );
      }
    } catch (err) {
      console.error("Image upload error:", err);
      setUploadError(
        err instanceof Error ? err.message : "Failed to upload image"
      );
      setUploadProgress(0);
    } finally {
      setIsUploading(false);
      // Reset the file input so the same file can be selected again if needed
      event.target.value = "";
    }
  };

  const handleRemove = () => {
    onChange("");
    setUploadError(null);
  };

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="space-y-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          type="url"
          disabled={disabled || isUploading}
        />

        <div className="flex gap-2">
          {canUpload && (
            <>
              <button
                type="button"
                className={`inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold transition-colors ${
                  disabled || isUploading
                    ? "cursor-not-allowed opacity-50"
                    : "hover:bg-accent"
                }`}
                disabled={disabled || isUploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                {isUploading ? "Uploading..." : `Upload to ${destinationHost}`}
              </button>
              <input
                id={`${id}-upload`}
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handleFileUpload}
                disabled={disabled || isUploading}
                className="hidden"
                aria-label={`${label} file upload`}
              />
            </>
          )}
          {value && (
            <Button
              variant="outline"
              type="button"
              onClick={handleRemove}
              disabled={disabled || isUploading}
              className="hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20"
              title="Remove image"
            >
              Remove
            </Button>
          )}
        </div>

        {isUploading && uploadProgress > 0 && (
          <progress
            className="h-2 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
            value={uploadProgress}
            max={100}
            aria-label="Image upload progress"
          />
        )}

        {uploadError && (
          <p className="text-xs text-destructive">{uploadError}</p>
        )}

        {!canUpload && (
          <p className="text-xs text-muted-foreground">
            No image host is configured, so there is nowhere to upload to. Paste
            an https:// image URL instead.
          </p>
        )}

        <p className="text-xs text-muted-foreground">{helpText}</p>
      </div>
    </div>
  );
}
