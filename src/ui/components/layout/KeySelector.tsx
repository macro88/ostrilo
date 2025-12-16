import { useState, useEffect, memo, useMemo } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/ui/components/ui/avatar";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";
import { useProfileMetadata } from "@/ui/hooks/useProfileMetadata";
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

/**
 * Multi-Key Selector Component
 * 
 * Displays a dropdown menu that allows users to switch between multiple Nostr keys.
 * Shows the currently active key with profile avatar and display name, fetched from
 * Nostr relays. Integrates with the KeyManagerContext for key operations.
 * 
 * @component
 * @example
 * ```tsx
 * <KeySelector onAddKey={() => setShowAddDialog(true)} />
 * ```
 * 
 * Features:
 * - Profile-aware key display with avatars and names from Nostr metadata
 * - Dropdown menu with all available keys
 * - Visual indicator (checkmark) for currently selected key
 * - Optional "Add Key" action at bottom of dropdown
 * - Loading states during key switching
 * - Keyboard navigation support (Arrow keys, Enter, Escape)
 * - WCAG 2.1 AA compliant with proper ARIA attributes
 * - Memoized for performance optimization
 * 
 * @remarks
 * This component uses Radix UI DropdownMenu for accessible dropdown behavior.
 * Profile metadata is fetched via useProfileMetadata hook and cached for 5 minutes.
 * All keys share the same vault password and are encrypted at rest.
 */
export const KeySelector = memo(function KeySelector({
  onAddKey,
}: KeySelectorProps) {
  const { keys, selectedUnlockedKey, selectKey } = useKeyManager();
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  // Fetch profile metadata for all keys
  const pubkeys = keys.map((key: UIKeyInfo) => key.publicKeyHex);
  const { profiles, isLoading: isLoadingProfiles } =
    useProfileMetadata(pubkeys);

  const handleSelectKey = async (keyId: string) => {
    if (keyId === selectedUnlockedKey?.id || isSwitching) return;

    try {
      setIsSwitching(true);
      await selectKey(keyId);
      setIsOpen(false);
    } catch (error) {
      console.error("Failed to switch key:", error);
      // TODO: Show toast notification
    } finally {
      setIsSwitching(false);
    }
  };

  // Get display info for a key
  const getKeyDisplay = (key: UIKeyInfo) => {
    const profile = profiles.get(key.publicKeyHex);
    const displayName =
      profile?.display_name || profile?.name || key.label || "Unnamed Key";
    const avatarUrl = profile?.picture;
    const truncatedNpub = key.publicKeyBech32
      ? `${key.publicKeyBech32.slice(0, 12)}...${key.publicKeyBech32.slice(-4)}`
      : "";

    return { displayName, avatarUrl, truncatedNpub };
  };

  if (!selectedUnlockedKey) {
    return null;
  }

  const currentKeyDisplay = getKeyDisplay(selectedUnlockedKey);

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg",
          "border border-border bg-card",
          "hover:bg-accent hover:border-primary/50 transition-all duration-200",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          isSwitching && "opacity-50 cursor-wait"
        )}
        disabled={isSwitching}
        aria-label="Select active key"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls="key-selector-listbox"
      >
        <Avatar className="h-6 w-6">
          {currentKeyDisplay.avatarUrl && (
            <AvatarImage
              src={currentKeyDisplay.avatarUrl}
              alt={currentKeyDisplay.displayName}
            />
          )}
          <AvatarFallback className="text-xs">
            {currentKeyDisplay.displayName.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col items-start min-w-0">
          <span className="text-sm font-medium truncate max-w-[120px]">
            {currentKeyDisplay.displayName}
          </span>
          <span className="text-xs text-muted-foreground">
            {currentKeyDisplay.truncatedNpub}
          </span>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180"
          )}
          aria-hidden="true"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="w-[280px]"
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
                "flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors duration-150",
                "hover:bg-accent/80 focus:bg-accent focus:outline-none",
                isSelected && "bg-accent"
              )}
              role="option"
              aria-selected={isSelected}
              aria-label={`${keyDisplay.displayName} - ${
                keyDisplay.truncatedNpub
              }${isSelected ? " (currently selected)" : ""}`}
            >
              <div className="flex items-center justify-center w-5">
                {isSelected && (
                  <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                )}
              </div>
              <Avatar className="h-8 w-8">
                {keyDisplay.avatarUrl && (
                  <AvatarImage
                    src={keyDisplay.avatarUrl}
                    alt={keyDisplay.displayName}
                  />
                )}
                <AvatarFallback className="text-xs">
                  {keyDisplay.displayName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col items-start min-w-0 flex-1">
                <span className="text-sm font-medium truncate w-full">
                  {keyDisplay.displayName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {keyDisplay.truncatedNpub}
                </span>
              </div>
            </DropdownMenuItem>
          );
        })}

        {onAddKey && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onAddKey}
              className="flex items-center gap-3 px-3 py-2 cursor-pointer text-primary hover:bg-accent/80 transition-colors duration-150 focus:outline-none focus:bg-accent"
              aria-label="Add new key"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="text-sm font-medium">Add Key</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
