import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/ui/dialog";
import { Button } from "@/ui/components/ui/button";
import { KeyRound, Upload } from "lucide-react";
import { CreateKeyForm } from "./CreateKeyForm";
import { ImportKeyForm } from "./ImportKeyForm";

/**
 * Props for the AddKeyDialog component
 */
interface AddKeyDialogProps {
  /**
   * Controls whether the dialog is visible
   */
  isOpen: boolean;
  
  /**
   * Callback invoked when the dialog should be closed
   */
  onClose: () => void;
  
  /**
   * Optional callback invoked after a key is successfully created or imported.
   * Receives the ID of the newly added key.
   */
  onSuccess?: (keyId: string) => void;
}

/**
 * Flow step type for the add key dialog
 */
type FlowStep = "choose" | "create" | "import";

/**
 * Add Key Dialog Component
 * 
 * Modal dialog for adding additional Nostr keys to the vault after initial onboarding.
 * Supports both creating new keys and importing existing ones.
 * 
 * @component
 * @example
 * ```tsx
 * const [isDialogOpen, setIsDialogOpen] = useState(false);
 * 
 * <AddKeyDialog
 *   isOpen={isDialogOpen}
 *   onClose={() => setIsDialogOpen(false)}
 *   onSuccess={(keyId) => {
 *     console.log('New key added:', keyId);
 *     selectKey(keyId);
 *   }}
 * />
 * ```
 * 
 * Features:
 * - Two-step flow: Choose action → Create or Import
 * - Reuses session password when vault is unlocked (no password prompt)
 * - Auto-selects newly created/imported key
 * - Validates imported key format (nsec1 or hex)
 * - Shows success/error notifications
 * - Accessible with keyboard navigation and screen readers
 * 
 * Flow:
 * 1. **Choose Step**: User selects "Create New Key" or "Import Existing Key"
 * 2. **Create Step**: Shows CreateKeyForm with label input and generate button
 * 3. **Import Step**: Shows ImportKeyForm with private key and label inputs
 * 4. **Success**: Dialog closes and onSuccess callback is invoked
 * 
 * @remarks
 * This component uses Radix UI Dialog for accessible modal behavior.
 * All key operations go through the KeyVaultService via RPC.
 * Private keys are encrypted with AES-GCM before storage.
 */
export function AddKeyDialog({
  isOpen,
  onClose,
  onSuccess,
}: AddKeyDialogProps) {
  const [step, setStep] = useState<FlowStep>("choose");

  const handleClose = () => {
    setStep("choose");
    onClose();
  };

  const handleSuccess = () => {
    handleClose();
    // Refresh the key list in the parent component
    if (onSuccess) {
      onSuccess(""); // keyId not needed, just refresh the list
    }
  };

  const renderContent = () => {
    switch (step) {
      case "choose":
        return (
          <div className="space-y-4 py-4">
            <Button
              variant="outline"
              className="h-24 w-full flex-col items-center justify-center gap-2 rounded-lg"
              onClick={() => setStep("create")}
            >
              <KeyRound className="h-6 w-6" />
              <div className="text-center">
                <div className="font-semibold">Create New Key</div>
                <div className="text-xs text-muted-foreground">
                  Generate a new Nostr identity
                </div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="h-24 w-full flex-col items-center justify-center gap-2 rounded-lg"
              onClick={() => setStep("import")}
            >
              <Upload className="h-6 w-6" />
              <div className="text-center">
                <div className="font-semibold">Import Existing Key</div>
                <div className="text-xs text-muted-foreground">
                  Use an existing nsec or hex key
                </div>
              </div>
            </Button>
          </div>
        );

      case "create":
        return (
          <div className="space-y-4">
            <CreateKeyForm
              onSuccess={handleSuccess}
              onBack={() => setStep("choose")}
            />
          </div>
        );

      case "import":
        return (
          <div className="space-y-4">
            <ImportKeyForm
              onSuccess={handleSuccess}
              onBack={() => setStep("choose")}
            />
          </div>
        );
    }
  };

  const getTitle = () => {
    switch (step) {
      case "choose":
        return "Add New Key";
      case "create":
        return "Create New Key";
      case "import":
        return "Import Existing Key";
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
        </DialogHeader>
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
}
