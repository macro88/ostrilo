import { useEffect, useRef, type CSSProperties } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff } from "lucide-react";
import { NO_AUTOFILL_PROPS } from "@/components/ui/password-input";

/** Characters per block in the transcription panel. */
const GROUP_SIZE = 8;

interface BackupKeyDisplayProps {
  /**
   * Reads the nsec out of the flow's ref. A function, not the value: passing the
   * string as a prop would park it in this element's `memoizedProps`, where it
   * outlives every `useRef` the flow clears and is visible to anything walking
   * the fiber tree.
   */
  getNsec: () => string | null;
  /** Bumped by the flow on each successful reveal, to re-run the DOM write. */
  revealNonce: number;
  showPrivateKey: boolean;
  onToggleShowPrivateKey: () => void;
  /** Shows the grouped, selectable form used for hand transcription. */
  showTranscription: boolean;
}

/** `nsec1abcd efgh ...` - short blocks are markedly easier to copy by hand. */
export function groupForTranscription(value: string): string {
  const groups: string[] = [];
  for (let i = 0; i < value.length; i += GROUP_SIZE) {
    groups.push(value.slice(i, i + GROUP_SIZE));
  }
  return groups.join(" ");
}

/**
 * The revealed nsec, masked by default.
 *
 * Two things here are deliberate and easy to undo by accident:
 *
 *  1. **No `type="password"`.** That attribute is the primary signal browser
 *     password managers key off, so a read-only field using it to mask an nsec
 *     is close to a guarantee of capture into a vault the user never chose.
 *     This is a text input masked by `-webkit-text-security`.
 *  2. **While masked, the DOM does not hold the key.** The masking property is
 *     prefixed and its Firefox support is recent, so the mask is belt; the
 *     braces are that the element's value is a run of bullets until the user
 *     asks to see the key. Nothing reading the DOM finds an nsec in the masked
 *     state, whatever the CSS does.
 *
 * The value is written imperatively and wiped in the effect cleanup, so leaving
 * the step does not leave the key in a detached DOM node waiting for the
 * collector.
 */
export function BackupKeyDisplay({
  getNsec,
  revealNonce,
  showPrivateKey,
  onToggleShowPrivateKey,
  showTranscription,
}: BackupKeyDisplayProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const transcriptionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    const transcription = transcriptionRef.current;
    const nsec = getNsec() ?? "";

    if (input) {
      input.value = showPrivateKey ? nsec : "•".repeat(nsec.length);
    }
    if (transcription) {
      transcription.textContent = showTranscription
        ? groupForTranscription(nsec)
        : "";
    }

    return () => {
      if (input) input.value = "";
      if (transcription) transcription.textContent = "";
    };
  }, [getNsec, revealNonce, showPrivateKey, showTranscription]);

  return (
    <div>
      {/* The label doubles as the panel's header (DESIGN_RULES §4: section
          labels replace card headers). */}
      <Label
        htmlFor="privateKey"
        className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground"
      >
        Private Key (nsec format)
      </Label>
      <div className="relative mt-2">
        <Input
          id="privateKey"
          type="text"
          ref={inputRef}
          readOnly
          defaultValue=""
          style={
            {
              WebkitTextSecurity: showPrivateKey ? "none" : "disc",
            } as CSSProperties
          }
          className="h-11 pr-11 font-mono text-[13px] tracking-wide"
          {...NO_AUTOFILL_PROPS}
        />
        <button
          type="button"
          onClick={onToggleShowPrivateKey}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground"
          aria-label={showPrivateKey ? "Hide private key" : "Show private key"}
        >
          {showPrivateKey ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      </div>

      {showTranscription && (
        <div className="code-panel mt-3">
          <div className="section-label mb-1.5 font-sans">Write it down</div>
          <div
            ref={transcriptionRef}
            data-testid="nsec-transcription"
            className="select-all break-all font-mono text-xs leading-6 text-foreground"
          />
        </div>
      )}
    </div>
  );
}
