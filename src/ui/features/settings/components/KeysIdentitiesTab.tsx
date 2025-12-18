import { Key, Plus } from "lucide-react";
import { KeySelectorCard } from "@/ui/features/settings/components/shared";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";
import { useProfileMetadata } from "@/ui/hooks/useProfileMetadata";
import { renameKey, deleteKey } from "@/infrastructure/messaging/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/ui/dialog";
import { CreateKeyForm } from "@/ui/components/dialogs/CreateKeyForm";
import { ImportKeyForm } from "@/ui/components/dialogs/ImportKeyForm";
import { useState } from "react";

type AddKeyMode = "choice" | "create" | "import" | null;

export function KeysIdentitiesTab() {
  const { keys, selectKey } = useKeyManager();
  const pubkeys = keys.map((key) => key.publicKeyHex);
  const { profiles } = useProfileMetadata(pubkeys);
  const [addKeyMode, setAddKeyMode] = useState<AddKeyMode>(null);

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

  const handleKeySuccess = () => {
    setAddKeyMode(null);
  };

  const handleBack = () => {
    setAddKeyMode("choice");
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold mb-2">Keys & Identities</h2>
          <p className="text-sm text-muted-foreground">
            Manage your Nostr identities
          </p>
        </div>
        <Button onClick={() => setAddKeyMode("choice")}>
          <Plus className="h-4 w-4 mr-2" />
          Add Key
        </Button>
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

      {/* Add Key Dialog */}
      <Dialog open={addKeyMode !== null} onOpenChange={(open) => !open && setAddKeyMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {addKeyMode === "choice" && "Add Key"}
              {addKeyMode === "create" && "Create New Key"}
              {addKeyMode === "import" && "Import Existing Key"}
            </DialogTitle>
            <DialogDescription>
              {addKeyMode === "choice" && "Choose how to add a new key to your vault"}
              {addKeyMode === "create" && "Generate a new Nostr key pair"}
              {addKeyMode === "import" && "Import an existing Nostr private key"}
            </DialogDescription>
          </DialogHeader>

          {addKeyMode === "choice" && (
            <div className="space-y-3">
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => setAddKeyMode("create")}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create New Key
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => setAddKeyMode("import")}
              >
                <Key className="h-4 w-4 mr-2" />
                Import Existing Key
              </Button>
            </div>
          )}

          {addKeyMode === "create" && (
            <CreateKeyForm onBack={handleBack} onSuccess={handleKeySuccess} />
          )}

          {addKeyMode === "import" && (
            <ImportKeyForm onBack={handleBack} onSuccess={handleKeySuccess} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
