import { useEffect, useRef, useState } from "react";
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

      const response = await fetch("https://nostr.build/api/v2/upload/files", {
        method: "POST",
        body: formData,
      });

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
            {isUploading ? "Uploading..." : "Upload Image"}
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

        <p className="text-xs text-muted-foreground">{helpText}</p>
      </div>
    </div>
  );
}
