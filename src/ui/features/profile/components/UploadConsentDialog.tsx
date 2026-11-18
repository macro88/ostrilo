import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/ui/dialog";
import {
  BLOSSOM_SERVERS,
  blossomServerHost,
  type BlossomServerId,
} from "@/domain/blossom/servers";
import { cn } from "@/lib/utils";

interface UploadConsentDialogProps {
  /** An animated file goes unchanged, so its embedded details stay in it. */
  animated: boolean;
  /** The host the user confirmed last time. It is preselected, never assumed. */
  remembered?: BlossomServerId;
  onConfirm: (serverId: BlossomServerId) => void;
  onCancel: () => void;
}

/**
 * Asks where an image goes, and says what that host will see, before anything
 * is decoded, hashed, signed or sent. It appears for every upload, and it is
 * mounted only while open, so each opening starts from the remembered host.
 */
export function UploadConsentDialog({
  animated,
  remembered,
  onConfirm,
  onCancel,
}: UploadConsentDialogProps) {
  const [selected, setSelected] = useState<BlossomServerId | undefined>(remembered);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="w-[calc(100%-2rem)] gap-4 p-5 sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle className="text-[17px] font-bold">
            Upload this image
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            Choose where it goes. Ostrilo sends it only to the host you pick.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-2">
          <legend className="section-label mb-2">Upload to</legend>
          {BLOSSOM_SERVERS.map((server) => (
            <label
              key={server.id}
              htmlFor={`blossom-server-${server.id}`}
              className={cn(
                "grid min-h-11 cursor-pointer grid-cols-[auto_1fr] items-center gap-x-3 rounded-[10px] border px-3 py-2 text-[13px] transition-colors duration-150 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-[var(--ink-violet-soft)]",
                selected === server.id
                  ? "border-[var(--ink-violet)] bg-[var(--ink-violet-soft)]"
                  : "border-border bg-card"
              )}
            >
              <input
                id={`blossom-server-${server.id}`}
                type="radio"
                name="blossom-server"
                value={server.id}
                checked={selected === server.id}
                onChange={() => setSelected(server.id)}
                className="row-span-2 size-4 accent-[var(--ink-violet)]"
              />
              <span className="min-w-0 font-semibold">{server.name}</span>
              <span
                className={cn(
                  "min-w-0 truncate font-mono text-[11px]",
                  // --ink-2 on the soft violet fill is 4.12:1 in Deep Ink.
                  selected === server.id ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {blossomServerHost(server)}
              </span>
            </label>
          ))}
        </fieldset>

        <div className="space-y-2 text-[12.5px] text-muted-foreground">
          <p>The host will see the image, your IP address and your public key.</p>
          <p>
            The image will be public. Anyone with its address can open it, and a
            host may remove files or refuse to delete them, so keep the original.
          </p>
          <p>
            {animated
              ? "This image is animated, so it is uploaded unchanged. Details embedded in the file, such as location, stay in it."
              : "The image is re-encoded before upload, which removes embedded details such as location."}
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel} className="h-11 flex-1">
            Cancel
          </Button>
          <Button
            disabled={selected === undefined}
            onClick={() => {
              if (selected !== undefined) onConfirm(selected);
            }}
            className="h-11 flex-[2]"
          >
            Upload
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
