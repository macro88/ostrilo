import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/ui/dialog";
import { SealMark } from "@/components/common/SealMark";
import { ChevronRight, FileKey, Key } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
 * One way to add a key. The same row the onboarding welcome uses to offer the
 * choice, so the second key is picked the way the first one was - except these
 * act on press, so the trailing mark is a chevron rather than a radio seal.
 */
function ChoiceRow({
  icon,
  title,
  description,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="ink-card flex w-full items-center gap-3 p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
      onClick={onClick}
    >
      <SealMark icon={icon} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </button>
  );
}

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

  let title = "Add New Key";
  let content = (
    <div className="space-y-3">
      <ChoiceRow
        icon={Key}
        title="Create New Key"
        description="Generate a fresh Nostr key"
        onClick={() => setStep("create")}
      />
      <ChoiceRow
        icon={FileKey}
        title="Import Existing Key"
        description="Paste an existing nsec or hex key"
        onClick={() => setStep("import")}
      />
    </div>
  );

  if (step === "create") {
    title = "Create New Key";
    content = (
      <CreateKeyForm onSuccess={handleSuccess} onBack={() => setStep("choose")} />
    );
  } else if (step === "import") {
    title = "Import Existing Key";
    content = (
      <ImportKeyForm onSuccess={handleSuccess} onBack={() => setStep("choose")} />
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      {/*
        No description: the title says everything the choice needs, and the
        forms label their own fields. `aria-describedby={undefined}` is how
        Radix is told that is deliberate.
      */}
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-[368px] gap-4 p-5 sm:max-w-[425px]"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="text-center text-[17px] font-bold">
            {title}
          </DialogTitle>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
