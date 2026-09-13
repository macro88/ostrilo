import { useAppSettings } from "@/hooks/useAppSettings";
import { formatOrigin } from "@/domain/display/origin";
import { useKeyManager } from "../../authentication/hooks/useKeyManager";
import { Button } from "@/components/ui/button";
import { Pubkey } from "@/components/common/pubkey";
import { SealMark } from "@/components/common/SealMark";
import { useActivityLog } from "@/ui/features/activity/hooks/useActivityLog";
import { getKindName } from "@/domain/types";
import {
  Activity,
  Check,
  ChevronRight,
  Globe,
  Key,
  Shield,
  X,
} from "lucide-react";

export function HomeView() {
  const { settings, isLoading: settingsLoading } = useAppSettings();
  const {
    hasKeys,
    selectedUnlockedKey,
    isLoading: keysLoading,
  } = useKeyManager();
  const { entries, loading: activityLoading } = useActivityLog();

  const isLoading = settingsLoading || keysLoading;

  if (isLoading) {
    return (
      <div className="screen-shell">
        <div className="ink-card p-4 text-center">
          <p className="text-sm text-muted-foreground">Loading home…</p>
        </div>
      </div>
    );
  }

  const activeKeyLabel = selectedUnlockedKey?.label || "No active key";
  const activeNpub = selectedUnlockedKey?.publicKeyBech32;
  const recentEntries = entries.slice(0, 3);

  return (
    <div className="screen-shell">
      <section className="flex items-center gap-4 py-3">
        <SealMark label={activeKeyLabel} size="lg" className="h-16 w-16 text-2xl" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold leading-tight">
            {activeKeyLabel}
          </h2>
          {activeNpub ? (
            <Pubkey pubkey={activeNpub} className="mt-1" />
          ) : (
            <p className="text-sm text-muted-foreground">
              Create or import a key to start signing locally.
            </p>
          )}
        </div>
      </section>

      <section className="ink-card overflow-hidden">
        <HomeRow
          icon={Key}
          label="Keys"
          value={hasKeys ? "1 active" : "None yet"}
        />
        <HomeRow
          icon={Globe}
          label="Relays"
          value={`${settings.relays.length} configured`}
        />
        <HomeRow
          icon={Shield}
          label="Site permissions"
          value={
            settings.origins.length > 0
              ? `${settings.origins.length} trusted`
              : "None granted"
          }
        />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Recent activity
          </h3>
          <Button variant="ghost" size="sm" className="h-8 px-2">
            See all
          </Button>
        </div>
        <div className="ink-card overflow-hidden">
          {activityLoading && recentEntries.length === 0 ? (
            <div className="ink-row text-sm text-muted-foreground">
              Loading activity…
            </div>
          ) : recentEntries.length === 0 ? (
            <div className="ink-row">
              <SealMark icon={Activity} tone="muted" />
              <div>
                <p className="text-sm font-semibold">No activity yet</p>
                <p className="text-xs text-muted-foreground">
                  Signing history will appear here.
                </p>
              </div>
            </div>
          ) : (
            recentEntries.map((entry) => (
              <div key={entry.id} className="ink-row">
                <SealMark
                  icon={entry.decision === "allow" ? Check : X}
                  tone={entry.decision === "allow" ? "success" : "danger"}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {entry.decision === "allow" ? "Signed" : "Denied"}{" "}
                    {getKindName(entry.kind).toLowerCase()}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {/* Full origin, scheme included. The activity log is
                        where a user checks what happened, and "example.com"
                        does not say whether it was the real one. */}
                    <span className="font-mono">
                      {formatOrigin(entry.origin).display}
                    </span>
                  </p>
                </div>
                <time className="font-mono text-xs text-muted-foreground">
                  {formatRelativeTime(entry.timestamp)}
                </time>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function HomeRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Key;
  label: string;
  value: string;
}) {
  return (
    <div className="ink-row">
      <Icon className="h-5 w-5 shrink-0 text-[var(--ink-violet)]" />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
        {label}
      </span>
      <span className="truncate text-sm font-semibold text-muted-foreground">
        {value}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}
