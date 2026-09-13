import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";
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
      {/* Relay list */}
      <div className="space-y-2">
        {relays.map((relay) => (
          <div
            key={relay}
            className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-muted/50 p-3"
          >
            <span className="text-sm font-mono truncate flex-1">{relay}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRemove(relay)}
              className="h-8 w-8 p-0"
              aria-label={`Remove ${relay}`}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      {/* Add new relay */}
      <div className="flex gap-2">
        <Input
          placeholder="wss://relay.example.com"
          value={newRelay}
          onChange={(e) => {
            setNewRelay(e.target.value);
            if (error) setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleAdd();
            }
          }}
          aria-describedby="relay-url-help"
        />
        <Button onClick={handleAdd} size="icon" aria-label="Add relay">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <p
        id="relay-url-help"
        className={error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
        role={error ? "alert" : undefined}
      >
        {error || "Relays must use secure WebSocket URLs that start with wss://."}
      </p>
      {/*
        Profile queries are spread across the configured relays so that no one
        relay learns every identity you hold. That only means anything with more
        than one relay, and saying so is the honest version of the trade.
      */}
      <p className="text-sm text-muted-foreground">
        {relays.length <= 1
          ? "With one relay configured, that relay sees every identity this extension looks up. Add more relays to spread those lookups out."
          : "Profile lookups are spread across these relays so no single relay sees every identity you hold."}
      </p>
    </div>
  );
}
