import { useState, useRef, useEffect } from "react";
import { Input } from "@/ui/components/ui/input";
import { Label } from "@/ui/components/ui/label";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";

interface ImageUploadFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  helpText?: string;
}

export function ImageUploadField({
  id,
  label,
  value,
  onChange,
  disabled = false,
  placeholder = "https://example.com/image.jpg",
  helpText = "Upload an image or paste a URL. Max 5MB (JPEG, PNG, GIF, WebP)",
}: ImageUploadFieldProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!validTypes.includes(file.type)) {
      setUploadError(
        "Please select a valid image file (JPEG, PNG, GIF, or WebP)"
      );
      return;
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setUploadError("Image must be smaller than 5MB");
      return;
    }

    try {
      setIsUploading(true);
      setUploadError(null);
      setUploadProgress(0);

      const formData = new FormData();
      formData.append("file", file);

      // Simulate progress since nostr.build doesn't provide upload progress
      progressIntervalRef.current = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      const response = await fetch("https://nostr.build/api/v2/upload/files", {
        method: "POST",
        body: formData,
      });

      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      setUploadProgress(100);

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.status === "success" && result.data && result.data[0]?.url) {
        const imageUrl = result.data[0].url;
        onChange(imageUrl);
        setUploadProgress(0);
      } else {
        throw new Error("Invalid response from upload service");
      }
    } catch (err) {
      console.error("Image upload error:", err);
      setUploadError(
        err instanceof Error ? err.message : "Failed to upload image"
      );
      setUploadProgress(0);
    } finally {
      // Ensure interval is cleaned up in all cases
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
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
          <label
            htmlFor={`${id}-upload`}
            className={`inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-sm font-semibold shadow-sm transition-colors ${
              disabled || isUploading
                ? "opacity-50 cursor-not-allowed pointer-events-none"
                : "cursor-pointer hover:bg-accent"
            }`}
            aria-disabled={disabled || isUploading}
            onKeyDown={(e) => {
              if (disabled || isUploading) {
                e.preventDefault();
                return;
              }
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                document.getElementById(`${id}-upload`)?.click();
              }
            }}
            tabIndex={disabled || isUploading ? -1 : 0}
            role="button"
          >
            <Upload className="h-4 w-4" />
            {isUploading ? "Uploading..." : "Upload Image"}
          </label>
          <input
            id={`${id}-upload`}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={handleFileUpload}
            disabled={disabled || isUploading}
            className="hidden"
          />
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
          <div
            className="w-full bg-muted rounded-full h-2 overflow-hidden"
            role="progressbar"
            aria-valuenow={uploadProgress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Image upload progress"
          >
            <div
              className="bg-primary h-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        )}

        {uploadError && (
          <p className="text-xs text-destructive">{uploadError}</p>
        )}

        <p className="text-xs text-muted-foreground">{helpText}</p>
      </div>
    </div>
  );
}
