import { Key } from "lucide-react";
import { KeySelectorCard } from "@/ui/features/settings/components/shared";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";
import { useProfileMetadata } from "@/ui/hooks/useProfileMetadata";
import { renameKey, deleteKey } from "@/infrastructure/messaging/client";

export function KeysIdentitiesTab() {
  const { keys, selectKey } = useKeyManager();
  const pubkeys = keys.map((key) => key.publicKeyHex);
  const { profiles } = useProfileMetadata(pubkeys);

  const handleRename = async (keyId: string, newLabel: string) => {
    await renameKey(keyId, newLabel);
  };

  const handleDelete = async (keyId: string) => {
    await deleteKey(keyId);
  };

  const handleSelectKey = async (keyId: string) => {
    try {
      await selectKey(keyId);
    } catch (error) {
      console.error("Failed to set active key:", error);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-2">Keys & Identities</h2>
        <p className="text-sm text-muted-foreground">
          Manage your Nostr identities
        </p>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Key className="h-4 w-4" />
        <h3 className="font-medium">Your Keys</h3>
      </div>

      <KeySelectorCard
        keys={keys}
        profiles={profiles}
        onSelectKey={handleSelectKey}
        onRename={handleRename}
        onDelete={handleDelete}
      />
    </div>
  );
}
