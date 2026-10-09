import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A key the vault holds, as far as this list needs to name it. */
export interface DisclosureIdentity {
  id: string;
  label: string;
  publicKeyBech32: string;
  isUnreadable?: boolean;
}

interface DisclosureGrantsProps {
  /** The key ids this site may read, from its stored policy. */
  keyIds: readonly string[];
  /** Keys the vault holds now. A grant for a key not in here is for a removed one. */
  identities: readonly DisclosureIdentity[];
  onRevoke?: (keyId: string) => void;
}

/** `npub1ppgfek6a…772ha9`: mono, middle-truncated, copyable (DESIGN_RULES §7). */
function truncateNpub(npub: string): string {
  return npub ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : "";
}

/**
 * Which identity each public-key grant belongs to, one revocable row per grant.
 *
 * A grant is for one key, so it is named by that key - label first, short npub
 * under it - and withdrawn on its own: revoking one leaves the site's grants for
 * other keys standing. A grant whose key has since been deleted is still listed
 * and still revocable, as "Removed key", rather than dropping out of sight.
 */
export function DisclosureGrants({
  keyIds,
  identities,
  onRevoke,
}: DisclosureGrantsProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const copy = async (identity: DisclosureIdentity) => {
    try {
      await navigator.clipboard.writeText(identity.publicKeyBech32);
    } catch {
      // Clipboard refused. The npub stays on screen to select by hand.
      return;
    }
    setCopiedId(identity.id);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
      {keyIds.map((keyId) => {
        const identity = identities.find((i) => i.id === keyId);
        const name = identity?.label || (identity ? "Unnamed key" : "Removed key");
        const showNpub = identity && !identity.isUnreadable;
        return (
          <li
            key={keyId}
            data-testid={`disclosure-grant-${keyId}`}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {name}
              </p>
              {showNpub ? (
                <div className="mt-0.5 flex items-center gap-1">
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {truncateNpub(identity.publicKeyBech32)}
                  </span>
                  <button
                    type="button"
                    onClick={() => copy(identity)}
                    aria-label={`Copy public key for ${name}`}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {copiedId === identity.id ? (
                      <Check className="size-3.5 text-ink-mint" aria-hidden="true" />
                    ) : (
                      <Copy className="size-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              ) : (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {identity
                    ? "This key could not be read."
                    : "This key is no longer in your vault."}
                </p>
              )}
            </div>
            {onRevoke && (
              <Button
                size="sm"
                variant="outline"
                aria-label={`Revoke public key access for ${name}`}
                onClick={() => onRevoke(keyId)}
              >
                Revoke
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
