import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  normalizedRelayUrl,
  RelayUrlSchema,
  RELAY_BOUNDS,
  type RelayPermissions,
  isRoutableRelayHost,
} from "@/domain/relay";

export function PublicRelayRows({
  entries,
  discovery,
  onEdit,
}: {
  entries: RelayPermissions[];
  discovery: string[];
  onEdit: (entries: RelayPermissions[]) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const add = () => {
    if (!RelayUrlSchema.safeParse(url.trim()).success) {
      setError("Enter a secure wss:// relay URL.");
      return;
    }
    const value = normalizedRelayUrl(url.trim());
    if (entries.some((e) => e.url === value)) {
      setError("This relay is already listed.");
      return;
    }
    onEdit([...entries, { url: value, read: true, write: true }]);
    setUrl("");
    setError("");
  };
  return (
    <>
      <ul className="ink-card">
        {entries.map((entry) => (
          <li className="ink-row flex-wrap" key={entry.url}>
            <div className="min-w-0 flex-1">
              <span className="break-all font-mono text-[13px]">
                {entry.url}
              </span>
              {!isRoutableRelayHost(entry.url) &&
                !discovery.some((d) => normalizedRelayUrl(d) === entry.url) && (
                  <p className="text-xs text-muted-foreground">
                    Not used by Ostrilo
                  </p>
                )}
            </div>
            <select
              aria-label={`Access for ${entry.url}`}
              className="rounded-md bg-background p-1 text-sm"
              value={
                entry.read && entry.write
                  ? "both"
                  : entry.read
                    ? "read"
                    : "write"
              }
              onChange={(e) =>
                onEdit(
                  entries.map((row) =>
                    row === entry
                      ? {
                          ...row,
                          read: e.target.value !== "write",
                          write: e.target.value !== "read",
                        }
                      : row,
                  ),
                )
              }
            >
              <option value="both">Read and write</option>
              <option value="read">Read only</option>
              <option value="write">Write only</option>
            </select>
            <Button
              variant="ghost"
              aria-label={`Remove public relay ${entry.url}`}
              onClick={() => onEdit(entries.filter((row) => row !== entry))}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input
          aria-label="Public relay URL"
          placeholder="wss://relay.example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button
          type="submit"
          variant="ghost"
          disabled={entries.length >= RELAY_BOUNDS.MAX_RELAY_LIST_ENTRIES}
        >
          Add
        </Button>
      </form>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
