import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/ui/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Edit, Check, X, Trash2 } from "lucide-react";

export interface KeyRecord {
  id: string;
  label: string;
  publicKeyBech32: string;
  publicKeyHex: string;
}

export interface KeyProfile {
  display_name?: string;
  name?: string;
  picture?: string;
}

interface KeySelectorCardProps {
  keys: KeyRecord[];
  selectedKeyId?: string;
  profiles: Map<string, KeyProfile>;
  onSelectKey?: (keyId: string) => void;
  onRename?: (keyId: string, newLabel: string) => void;
  onDelete?: (keyId: string) => void;
}

export function KeySelectorCard({
  keys,
  selectedKeyId,
  profiles,
  onSelectKey,
  onRename,
  onDelete,
}: KeySelectorCardProps) {
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const handleStartEdit = (keyId: string, currentLabel: string) => {
    setEditingKeyId(keyId);
    setEditLabel(currentLabel);
  };

  const handleCancelEdit = () => {
    setEditingKeyId(null);
    setEditLabel("");
  };

  const handleSaveEdit = async (keyId: string) => {
    if (onRename) {
      try {
        await onRename(keyId, editLabel);
        setEditingKeyId(null);
        setEditLabel("");
      } catch (error) {
        console.error("Failed to rename key:", error);
        alert("Failed to rename key. Please try again.");
      }
    }
  };

  const handleDelete = async (keyId: string) => {
    if (keys.length === 1) {
      alert("Cannot delete the last key. At least one key must remain.");
      return;
    }

    if (
      !confirm(
        "Are you sure you want to delete this key? This action cannot be undone."
      )
    ) {
      return;
    }

    if (onDelete) {
      try {
        await onDelete(keyId);
      } catch (error) {
        console.error("Failed to delete key:", error);
        alert("Failed to delete key. Please try again.");
      }
    }
  };

  return (
    <div className="space-y-3" role="list" aria-label="Manage your Nostr keys">
      {keys.map((key) => {
        const profile = profiles.get(key.publicKeyHex);
        const displayName =
          profile?.display_name || profile?.name || key.label || "Unnamed Key";
        const avatarUrl = profile?.picture;
        const isActive = key.id === selectedKeyId;
        const isEditing = editingKeyId === key.id;
        const truncatedNpub = key.publicKeyBech32
          ? `${key.publicKeyBech32.slice(0, 16)}...${key.publicKeyBech32.slice(
              -8
            )}`
          : "";

        return (
          <div
            key={key.id}
            className={cn(
              "flex items-center gap-3 p-3 rounded-lg border",
              isActive ? "border-primary bg-primary/5" : "border-border"
            )}
          >
            <Avatar className="h-10 w-10">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
              <AvatarFallback className="text-sm">
                {displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    className="h-8"
                    placeholder="Enter label"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleSaveEdit(key.id)}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleCancelEdit}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{displayName}</span>
                    {isActive && (
                      <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {truncatedNpub}
                  </p>
                </>
              )}
            </div>

            {!isEditing && (
              <div className="flex items-center gap-1">
                {!isActive && onSelectKey && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onSelectKey(key.id)}
                    className="text-xs h-8"
                  >
                    Set Active
                  </Button>
                )}
                {onRename && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleStartEdit(key.id, key.label)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                )}
                {onDelete && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(key.id)}
                    disabled={keys.length === 1}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
