import { useState } from "react";
import { Input } from "@/ui/components/ui/input";
import { Label } from "@/ui/components/ui/label";

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
          <label
            htmlFor={`${id}-upload`}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm border border-border rounded-lg cursor-pointer hover:bg-muted transition-colors ${
              disabled || isUploading ? "opacity-50 cursor-not-allowed" : ""
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
            <button
              type="button"
              onClick={handleRemove}
              disabled={disabled || isUploading}
              className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20 transition-colors disabled:opacity-50"
              title="Remove image"
            >
              Remove
            </button>
          )}
        </div>

        {isUploading && uploadProgress > 0 && (
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

        <p className="text-xs text-muted-foreground">{helpText}</p>
      </div>
    </div>
  );
}
