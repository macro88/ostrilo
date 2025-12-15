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

interface AddKeyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (keyId: string) => void;
}

type FlowStep = "choose" | "create" | "import";

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
              className="w-full h-20 flex flex-col items-center justify-center gap-2"
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
              className="w-full h-20 flex flex-col items-center justify-center gap-2"
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
