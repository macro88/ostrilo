import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  getRelayList,
  publishRelayList,
  publishStarterList,
} from "@/infrastructure/messaging/client";
import type { RelayLookup } from "@/application/services/relay-list-lookup";
import type { RelayPublishResult } from "@/application/ports/relay";
import type { RelayPermissions } from "@/domain/relay";
import { PublicRelayRows } from "./PublicRelayRows";

const warnings = {
  unreadable:
    "Ostrilo could not read the relay list. Check it in the app that published it, then refresh.",
  unreachable:
    "Some relays did not answer. Check your discovery relays and refresh.",
};

function usePublicRelayEditor(keyId: string) {
  const [current, setCurrent] = useState<RelayLookup>();
  const [draft, setDraft] = useState<RelayPermissions[]>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [results, setResults] = useState<RelayPublishResult[]>();
  useEffect(() => {
    let active = true;
    getRelayList(keyId).then(
      (value) => {
        if (active) setCurrent(value);
      },
      () => {
        if (active) setCurrent({ status: "unreachable" });
      },
    );
    return () => {
      active = false;
    };
  }, [keyId, refresh]);

  const reload = () => {
    setCurrent(undefined);
    setRefresh((value) => value + 1);
  };
  const acceptLatest = () => {
    setChanged(false);
    setDraft(undefined);
  };
  const publish = async () => {
    if (busy || !current) return;
    setBusy(true);
    setResults(undefined);
    try {
      const result =
        current.status === "none"
          ? await publishStarterList(keyId)
          : current.status === "found" && draft
            ? await publishRelayList(keyId, draft, current.list.eventId)
            : undefined;
      if (!result) return;
      if (result.status === "blocked") {
        setCurrent({ status: result.reason });
        return;
      }
      if (result.status === "changed") {
        setCurrent(result.current);
        setChanged(true);
        return;
      }
      setResults(result.results);
      if (result.status === "published") {
        setDraft(undefined);
        reload();
      }
    } catch {
      setCurrent({ status: "unreachable" });
    } finally {
      setBusy(false);
    }
  };
  return {
    current,
    draft,
    setDraft,
    busy,
    changed,
    results,
    reload,
    publish,
    acceptLatest,
  };
}

function ConflictNotice({
  draft,
  onAccept,
}: {
  draft?: RelayPermissions[];
  onAccept: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-lg bg-[var(--ink-amber-soft)] p-3 text-[var(--ink-amber)]"
    >
      Another app changed this list. Review the latest entries before reapplying
      your edits.
      {draft && (
        <ul>
          {draft.map((row) => (
            <li key={row.url}>
              {row.url} · {row.read && "read "} {row.write && "write"}
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" onClick={onAccept}>
        Use latest list
      </Button>
    </div>
  );
}

export function PublicRelayEditor({
  keyId,
  discovery,
}: {
  keyId: string;
  discovery: string[];
}) {
  const editor = usePublicRelayEditor(keyId);
  const { current, draft, setDraft, busy, changed, results, acceptLatest } =
    editor;
  return (
    <div className="space-y-3 text-sm">
      <LookupNotice current={current} />
      {changed && <ConflictNotice draft={draft} onAccept={acceptLatest} />}
      {current?.status === "found" && (
        <>
          {current.list.droppedCount > 0 && (
            <p>
              Publishing will remove {current.list.droppedCount} unreadable
              tags.
            </p>
          )}
          <fieldset disabled={busy || changed} className="space-y-3">
            <PublicRelayRows
              entries={
                changed ? current.list.entries : (draft ?? current.list.entries)
              }
              discovery={discovery}
              onEdit={setDraft}
            />
          </fieldset>
          <p className="text-muted-foreground">
            {draft ? "Not published. " : ""}Choose two to four write relays for
            this key.
          </p>
        </>
      )}
      <EditorActions editor={editor} />
      {results && (
        <div>
          <output>
            Published to {results.filter((r) => r.accepted).length} of{" "}
            {results.length} relays.
          </output>
          <ul>
            {results.map((result) => (
              <li key={result.url}>
                <span className="font-mono">{result.url}</span> ·{" "}
                {result.accepted ? "Accepted" : "Failed"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function LookupNotice({ current }: { current?: RelayLookup }) {
  return (
    <>
      {!current && <output>Looking up this key’s relay list…</output>}
      {current?.status === "none" && (
        <p>
          Publishing a starter list uses the discovery relays listed below. It
          can replace a list held on relays Ostrilo did not ask.
        </p>
      )}
      {(current?.status === "unreachable" ||
        current?.status === "unreadable") && (
        <p
          role="alert"
          className="rounded-lg bg-[var(--ink-amber-soft)] p-3 text-[var(--ink-amber)]"
        >
          {warnings[current.status]}
        </p>
      )}
    </>
  );
}

function EditorActions({
  editor,
}: {
  editor: ReturnType<typeof usePublicRelayEditor>;
}) {
  const { current, draft, setDraft, busy, changed, reload, publish } = editor;
  return (
    <div className="flex flex-wrap gap-2">
      {(current?.status === "found" || current?.status === "none") && (
        <Button
          disabled={
            busy ||
            changed ||
            (current.status === "found" && !draft?.some((e) => e.write))
          }
          onClick={publish}
        >
          {current.status === "none"
            ? "Publish starter list"
            : "Publish relay list"}
        </Button>
      )}
      <Button
        variant="ghost"
        disabled={busy || !current || (!!draft && current.status === "found")}
        onClick={() => {
          setDraft(undefined);
          reload();
        }}
      >
        Refresh
      </Button>
    </div>
  );
}
