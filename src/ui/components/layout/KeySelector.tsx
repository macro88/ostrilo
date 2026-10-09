import { useState, memo } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/ui/components/ui/avatar";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";
import { useProfileMetadata } from "@/ui/hooks/useProfileMetadata";
import { useOwnAvatar } from "@/ui/hooks/useOwnAvatar";
import { OwnAvatarImage } from "@/ui/components/common/OwnAvatarImage";
import { cn } from "@/lib/utils";
import type { UIKeyInfo } from "@/ui/state/KeyManagerContext";

/**
 * Props for the KeySelector component
 */
interface KeySelectorProps {
  /**
   * Optional callback invoked when the "Add Key" button is clicked.
   * If not provided, the "Add Key" button will not be shown.
   */
  onAddKey?: () => void;
}

const ACTIVE_KEY_NAME_ID = "active-key-name";

/**
 * Multi-Key Selector Component
 *
 * The active identity, rendered as the header's account control: seal avatar,
 * display name and a chevron, opening a list of every key in the vault.
 *
 * The visible name is also the screen's level-2 heading. The heading wraps the
 * trigger and points `aria-labelledby` at the name, so it is announced (and
 * found by tests) as the key's name rather than as the trigger's own
 * "Select active key" label.
 *
 * @remarks
 * Uses Radix UI DropdownMenu for accessible dropdown behavior. Profile
 * metadata is fetched via useProfileMetadata and cached for 5 minutes. All
 * keys share the same vault password and are encrypted at rest.
 *
 * The header avatar is the selected key's own picture when the user has a local
 * copy of it, and the seal with the key's initial otherwise. The copy is a
 * `data:` image made on the Profile page when the user saved or refreshed their
 * profile. A relay chooses the profile picture URL, and this is the surface on
 * which the user confirms which identity is about to sign, so no request is
 * ever made to that host from here: nothing on this surface loads a remote
 * image. The list rows below are always the seal.
 */
export const KeySelector = memo(function KeySelector({
  onAddKey,
}: KeySelectorProps) {
  const { keys, selectedUnlockedKey, selectKey } = useKeyManager();
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  // Fetch profile metadata for all keys
  const pubkeys = keys.map((key: UIKeyInfo) => key.publicKeyHex);
  const { profiles } = useProfileMetadata(pubkeys);

  const ownAvatar = useOwnAvatar(
    selectedUnlockedKey && !selectedUnlockedKey.isUnreadable
      ? selectedUnlockedKey.publicKeyHex
      : null
  );

  const handleSelectKey = async (keyId: string) => {
    if (keyId === selectedUnlockedKey?.id || isSwitching) return;

    try {
      setIsSwitching(true);
      await selectKey(keyId);
      setIsOpen(false);
    } catch (error) {
      console.error("Failed to switch key:", error);
    } finally {
      setIsSwitching(false);
    }
  };

  // Get display info for a key
  const getKeyDisplay = (key: UIKeyInfo) => {
    // A key whose public key cannot be read has no profile to look up and no
    // npub to show. It is named for what it is, with its ID: "Unnamed" here
    // read as an empty vault and was never the truth about this record.
    if (key.isUnreadable) {
      return {
        displayName: "Unreadable key",
        truncatedNpub: `ID ${key.id.slice(0, 8)}`,
      };
    }
    const profile = profiles.get(key.publicKeyHex);
    const displayName =
      profile?.display_name || profile?.name || key.label || "Unnamed Key";
    const truncatedNpub = key.publicKeyBech32
      ? `${key.publicKeyBech32.slice(0, 12)}...${key.publicKeyBech32.slice(-4)}`
      : "";

    return { displayName, truncatedNpub };
  };

  if (!selectedUnlockedKey) {
    return null;
  }

  const currentKeyDisplay = getKeyDisplay(selectedUnlockedKey);

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <h2
        className="min-w-0 text-[15px] font-bold leading-tight"
        aria-labelledby={ACTIVE_KEY_NAME_ID}
      >
        <DropdownMenuTrigger
          className={cn(
            "flex h-11 min-w-0 max-w-full items-center gap-2 rounded-lg pl-2 pr-2 text-left",
            "transition-colors duration-150 hover:bg-muted",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
            isSwitching && "cursor-wait opacity-50"
          )}
          disabled={isSwitching}
          aria-label="Select active key"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls="key-selector-listbox"
        >
          <Avatar shape="seal" className="size-7">
            <OwnAvatarImage
              avatar={ownAvatar}
              alt={currentKeyDisplay.displayName}
              size={28}
              fallback={
                <AvatarFallback className="bg-secondary text-xs font-bold text-secondary-foreground">
                  {currentKeyDisplay.displayName.charAt(0).toUpperCase()}
                </AvatarFallback>
              }
            />
          </Avatar>
          <span id={ACTIVE_KEY_NAME_ID} className="truncate">
            {currentKeyDisplay.displayName}
          </span>
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-[var(--ink-3)] transition-transform duration-150",
              isOpen && "rotate-180"
            )}
            aria-hidden="true"
          />
        </DropdownMenuTrigger>
      </h2>

      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-[288px] max-w-[calc(100vw-1rem)] p-1.5"
        role="listbox"
        id="key-selector-listbox"
        aria-label="Available keys"
      >
        {keys.map((key: UIKeyInfo) => {
          const isSelected = key.id === selectedUnlockedKey.id;
          const keyDisplay = getKeyDisplay(key);

          return (
            <DropdownMenuItem
              key={key.id}
              onClick={() => handleSelectKey(key.id)}
              className={cn(
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors duration-150",
                "hover:bg-muted focus:bg-muted focus:outline-none",
                isSelected && "bg-muted"
              )}
              role="option"
              aria-selected={isSelected}
              aria-label={`${keyDisplay.displayName} - ${
                keyDisplay.truncatedNpub
              }${isSelected ? " (currently selected)" : ""}`}
            >
              <Avatar shape="seal" className="size-8">
                <AvatarFallback className="bg-secondary text-xs font-bold text-secondary-foreground">
                  {keyDisplay.displayName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {keyDisplay.displayName}
                </span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {keyDisplay.truncatedNpub}
                </span>
              </div>
              <span className="flex w-5 shrink-0 justify-center">
                {isSelected && (
                  <Check
                    className="size-4 text-[var(--ink-violet)]"
                    aria-hidden="true"
                  />
                )}
              </span>
            </DropdownMenuItem>
          );
        })}

        {onAddKey && (
          <>
            <DropdownMenuSeparator className="my-1.5" />
            <DropdownMenuItem
              onClick={onAddKey}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-[var(--ink-violet)] transition-colors duration-150 hover:bg-muted focus:bg-muted focus:outline-none"
              aria-label="Add new key"
            >
              <span className="flex size-8 shrink-0 items-center justify-center">
                <Plus
                  className="size-4 text-[var(--ink-violet)]"
                  aria-hidden="true"
                />
              </span>
              <span className="text-sm font-semibold">Add Key</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
