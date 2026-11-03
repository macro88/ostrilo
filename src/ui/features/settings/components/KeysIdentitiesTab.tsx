import { Key, Plus } from "lucide-react";
import { KeySelectorCard } from "@/ui/features/settings/components/shared";
import {
  SettingsSection,
  SettingsTabHeader,
} from "@/ui/features/settings/components/shared/SettingsLayout";
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
import { useEffect, useRef, useState } from "react";
import { ReauthDialog } from "@/ui/components/dialogs/ReauthDialog";
import { useReauth } from "@/ui/hooks/useReauth";
import { KeyBackupDialog } from "@/ui/features/backup/components/KeyBackupDialog";
import { useKeyBackup } from "@/ui/features/backup/hooks/useKeyBackup";
import { useKeyBackupStatuses } from "@/ui/features/backup/hooks/useKeyBackupStatus";

type AddKeyMode = "choice" | "create" | "import" | null;

async function handleRename(keyId: string, newLabel: string) {
  await renameKey(keyId, newLabel);
}

interface KeysIdentitiesTabProps {
  /**
   * A key the page was opened to back up (the Home banner's action). It starts
   * the same password-gated flow as the row's Back up button.
   */
  backupRequestKeyId?: string | null;
  /** Called once the request has been acted on or found to name no key. */
  onBackupRequestHandled?: () => void;
}

export function KeysIdentitiesTab({
  backupRequestKeyId = null,
  onBackupRequestHandled,
}: KeysIdentitiesTabProps = {}) {
  const { keys, selectedUnlockedKey, selectKey } = useKeyManager();
  const pubkeys = keys.map((key) => key.publicKeyHex);
  const { profiles } = useProfileMetadata(pubkeys);
  const [addKeyMode, setAddKeyMode] = useState<AddKeyMode>(null);
  const reauth = useReauth();
  const backup = useKeyBackup(reauth);
  const backupStatuses = useKeyBackupStatuses();

  // Deleting a key is irreversible, and for a key that was never backed up
  // it destroys the identity. The background refuses the deletion without a
  // verified password regardless of what this dialog does.
  const handleDelete = async (keyId: string) => {
    const label = keys.find((k) => k.id === keyId)?.label ?? "this key";
    try {
      await reauth.request(
        {
          action: `Delete “${label}”.`,
          consequence:
            "If this key is not backed up, the identity is gone for good.",
        },
        (password) => deleteKey(keyId, password)
      );
    } catch {
      // Cancelled. Nothing was deleted.
    }
  };

  const handleBackup = (keyId: string) => {
    const key = keys.find((k) => k.id === keyId);
    if (key) void backup.start({ id: key.id, label: key.label });
  };

  // Acted on once per request: a re-render, or StrictMode's second effect run,
  // must not ask for the password twice.
  const actedOn = useRef<string | null>(null);
  useEffect(() => {
    if (!backupRequestKeyId || actedOn.current === backupRequestKeyId) return;
    actedOn.current = backupRequestKeyId;
    const key = keys.find((k) => k.id === backupRequestKeyId);
    if (key && !key.isUnreadable) {
      void backup.start({ id: key.id, label: key.label });
    }
    onBackupRequestHandled?.();
  }, [backupRequestKeyId, keys, backup, onBackupRequestHandled]);

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

  const count = keys.length === 1 ? "One key" : `${keys.length} keys`;

  return (
    <div>
      <SettingsTabHeader
        title="Keys & Identities"
        lede={`${count} in this vault. Requests are signed with the active key.`}
        action={
          <Button onClick={() => setAddKeyMode("choice")}>
            <Plus aria-hidden="true" />
            Add Key
          </Button>
        }
      />

      <SettingsSection label="Your keys">
        <KeySelectorCard
          keys={keys}
          selectedKeyId={selectedUnlockedKey?.id}
          profiles={profiles}
          onSelectKey={handleSelectKey}
          onRename={handleRename}
          onDelete={handleDelete}
          onBackup={handleBackup}
          backupStatusOf={backupStatuses.statusOf}
        />
      </SettingsSection>

      <ReauthDialog {...reauth.dialogProps} />

      <KeyBackupDialog
        target={backup.target}
        getPayload={backup.getPayload}
        lockedMidBackup={backup.lockedMidBackup}
        onRecorded={() => {
          backup.release();
          backupStatuses.refresh();
        }}
        onVaultLocked={backup.release}
        onClose={backup.close}
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
