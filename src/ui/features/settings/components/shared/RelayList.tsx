import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { isValidRelayUrl } from "@/domain/utils/validation";
import { RELAY_BOUNDS } from "@/domain/relay/constants";

interface RelayListProps {
  relays: string[];
  onAdd: (relay: string) => void;
  onRemove: (relay: string) => void;
}

export function RelayList({ relays, onAdd, onRemove }: RelayListProps) {
  const [newRelay, setNewRelay] = useState("");
  const [error, setError] = useState("");

  const handleAdd = () => {
    const relay = newRelay.trim();

    if (!relay) {
      setError("Enter a relay URL before adding it.");
      return;
    }

    // The shared domain validator, not a local prefix check, so the message the
    // user sees and the rule the extension enforces cannot drift apart.
    if (!isValidRelayUrl(relay)) {
      setError(
        "Enter a secure relay address: wss://host, with no username or password."
      );
      return;
    }

    if (relays.includes(relay)) {
      setError("That relay is already in the list.");
      return;
    }

    if (relays.length >= RELAY_BOUNDS.MAX_CONFIGURED_RELAYS) {
      setError(
        `You can configure at most ${RELAY_BOUNDS.MAX_CONFIGURED_RELAYS} relays.`
      );
      return;
    }

    onAdd(relay);
    setNewRelay("");
    setError("");
  };

  return (
    <div className="space-y-3">
      {/* Relay list: one grouped card, mono URLs (DESIGN_RULES §4, §7). */}
      {relays.length > 0 ? (
        <ul className="ink-card" aria-label="Configured relays">
          {relays.map((relay) => (
            <li key={relay} className="ink-row">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                {relay}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onRemove(relay)}
                className="size-9 -mr-2"
                aria-label={`Remove ${relay}`}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ink-card">
          <p className="ink-row text-[13px] text-muted-foreground">
            No relays configured.
          </p>
        </div>
      )}

      {/* Add new relay: the screen's one primary action. */}
      <div className="flex gap-2">
        <Input
          placeholder="wss://relay.example.com"
          value={newRelay}
          className="h-11 font-mono text-[13px] md:text-[13px]"
          onChange={(e) => {
            setNewRelay(e.target.value);
            if (error) setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleAdd();
            }
          }}
          aria-label="Relay URL"
          aria-describedby="relay-url-help"
        />
        <Button onClick={handleAdd} aria-label="Add relay" className="px-5">
          Add Relay
        </Button>
      </div>
      <p
        id="relay-url-help"
        className={
          error
            ? "px-0.5 text-[13px] leading-snug text-destructive"
            : "px-0.5 text-[13px] leading-snug text-muted-foreground"
        }
        role={error ? "alert" : undefined}
      >
        {error || "Relays must use secure WebSocket URLs that start with wss://."}
      </p>
      {/*
        Profile queries are spread across the configured relays so that no one
        relay learns every identity you hold. That only means anything with more
        than one relay, and saying so is the honest version of the trade.
      */}
      <p className="px-0.5 text-[13px] leading-snug text-muted-foreground text-pretty">
        {relays.length <= 1
          ? "With one relay configured, that relay sees every identity this extension looks up. Add more relays to spread those lookups out."
          : "Profile lookups are spread across these relays so no single relay sees every identity you hold."}
      </p>
    </div>
  );
}
