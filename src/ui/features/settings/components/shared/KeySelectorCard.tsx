import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/ui/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Check, Copy, Pencil, Trash2, X } from "lucide-react";

export interface KeyRecord {
  id: string;
  label: string;
  publicKeyBech32: string;
  publicKeyHex: string;
  /**
   * The stored record's public key could not be read, so there is no npub.
   * Optional so existing callers that never had the field keep compiling;
   * the list treats absent as readable.
   */
  isUnreadable?: boolean;
}

export interface KeyProfile {
  display_name?: string;
  name?: string;
  /**
   * Relay-supplied avatar URL. Retained so it can be inspected on the profile
   * surface; never used as an image source here.
   */
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

/** `npub1ppgfek6a…772ha9`: mono, middle-truncated, copyable (DESIGN_RULES §7). */
function truncateNpub(npub: string): string {
  return npub ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : "";
}

/**
 * The keys in the vault as one grouped card of rows. The active key is
 * marked with a mint ACTIVE chip rather than a tinted row: mint is the one
 * colour that means "on" (DESIGN_RULES §2).
 *
 * Deleting does not `confirm()` here. The caller collects the password in a
 * ReauthDialog that states the consequence, and the background refuses the
 * deletion without it; a native dialog in front of that was a second
 * confirmation with worse copy.
 */
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
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const copyNpub = async (key: KeyRecord) => {
    try {
      await navigator.clipboard.writeText(key.publicKeyBech32);
    } catch {
      // Clipboard refused. The npub stays on screen to select by hand.
      return;
    }
    setCopiedKeyId(key.id);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedKeyId(null), 1500);
  };

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
    // The button is disabled for the last key; this guards the programmatic path.
    if (keys.length === 1 || !onDelete) return;

    try {
      await onDelete(keyId);
    } catch (error) {
      console.error("Failed to delete key:", error);
      alert("Failed to delete key. Please try again.");
    }
  };

  return (
    <ul className="ink-card" aria-label="Manage your Nostr keys">
      {keys.map((key) => {
        const profile = profiles.get(key.publicKeyHex);
        const displayName =
          profile?.display_name || profile?.name || key.label || "Unnamed Key";
        const isActive = key.id === selectedKeyId;
        const isEditing = editingKeyId === key.id;
        const isLastKey = keys.length === 1;
        const copied = copiedKeyId === key.id;

        return (
          <li key={key.id} className="ink-row">
            {/*
              Local seal avatar only. The picture URL comes from a relay, and this
              list is where the user picks which identity signs; loading it would
              leak the user's IP address to a host the relay chose.
            */}
            <Avatar shape="seal" className="h-10 w-10">
              <AvatarFallback
                className={cn(
                  "text-sm font-bold",
                  isActive
                    ? "bg-secondary text-secondary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSaveEdit(key.id);
                      if (e.key === "Escape") handleCancelEdit();
                    }}
                    className="h-9 max-w-xs"
                    placeholder="Enter label"
                    aria-label={`New label for ${displayName}`}
                    autoFocus
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleSaveEdit(key.id)}
                    aria-label={`Save label for ${displayName}`}
                  >
                    <Check aria-hidden="true" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleCancelEdit}
                    aria-label={`Cancel editing ${displayName}`}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold leading-snug">
                      {displayName}
                    </span>
                    {isActive && (
                      <span className="seal-chip seal-chip-success">Active</span>
                    )}
                  </div>
                  {key.isUnreadable ? (
                    /*
                      A record whose stored public key is not valid hex is
                      named as unreadable rather than shown as an npub. The
                      decoder this replaced substituted zero bytes for
                      unparseable characters, so a corrupt record rendered a
                      real, well-formed npub for a key nobody holds - which
                      the user would read as their own identity.
                    */
                    <p className="mt-0.5 text-[13px] text-destructive">
                      Unreadable record: stored public key is not valid
                    </p>
                  ) : (
                    <div className="mt-0.5 flex items-center gap-1">
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {truncateNpub(key.publicKeyBech32)}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyNpub(key)}
                        aria-label={`Copy public key for ${displayName}`}
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                      >
                        {copied ? (
                          <Check className="size-3.5 text-ink-mint" aria-hidden="true" />
                        ) : (
                          <Copy className="size-3.5" aria-hidden="true" />
                        )}
                      </button>
                      <span className="text-xs text-ink-mint" role="status">
                        {copied ? "Copied" : ""}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            {!isEditing && (
              <div className="flex shrink-0 items-center gap-1">
                {!isActive && onSelectKey && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onSelectKey(key.id)}
                    className="h-8 px-3 text-xs"
                  >
                    Set Active
                  </Button>
                )}
                {onRename && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleStartEdit(key.id, key.label)}
                    aria-label={`Rename ${displayName}`}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                )}
                {onDelete && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDelete(key.id)}
                    disabled={isLastKey}
                    title={
                      isLastKey
                        ? "The only key in the vault cannot be deleted."
                        : undefined
                    }
                    className="hover:text-destructive"
                    aria-label={`Delete ${displayName}`}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
