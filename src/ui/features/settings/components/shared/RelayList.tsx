import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";

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

    if (!relay.startsWith("wss://")) {
      setError("Relay URL must start with wss://");
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
    </div>
  );
}
