import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Globe, Plus, X } from "lucide-react";

interface RelayListProps {
  relays: string[];
  onAdd: (relay: string) => void;
  onRemove: (relay: string) => void;
}

export function RelayList({ relays, onAdd, onRemove }: RelayListProps) {
  const [newRelay, setNewRelay] = useState("");

  const handleAdd = () => {
    if (newRelay.trim() && newRelay.startsWith("wss://")) {
      onAdd(newRelay.trim());
      setNewRelay("");
    }
  };

  return (
    <div className="space-y-3">
      {/* Relay list */}
      <div className="space-y-2">
        {relays.map((relay) => (
          <div
            key={relay}
            className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-muted/50 p-3"
          >
            <span className="text-sm font-mono truncate flex-1">{relay}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRemove(relay)}
              className="h-8 w-8 p-0"
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
          onChange={(e) => setNewRelay(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleAdd();
            }
          }}
        />
        <Button onClick={handleAdd} size="icon" aria-label="Add relay">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
