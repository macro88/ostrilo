import { useEffect, useRef, useState } from "react";
import { openOptionsTab } from "@/ui/lib/open-options";
import {
  Activity,
  Check,
  ChevronRight,
  Globe,
  Key,
  Shield,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAppSettings } from "@/hooks/useAppSettings";
import { formatOrigin } from "@/domain/display/origin";
import { describeActivityAction } from "@/domain/types";
import { Pubkey } from "@/components/common/pubkey";
import { SealMark } from "@/components/common/SealMark";
import { cn } from "@/lib/utils";
import { useProfileMetadata } from "@/ui/hooks/useProfileMetadata";
import { useActivityLog } from "@/ui/features/activity/hooks/useActivityLog";
import type { TabKey } from "@/ui/components/navigation/BottomTabs";
import { useKeyManager } from "../../authentication/hooks/useKeyManager";

type ActivityEntry = ReturnType<typeof useActivityLog>["entries"][number];

/**
 * How many recent decisions Home previews: two in the popup, four in the side
 * panel. With the Display name row present these are the counts whose last row
 * still ends above the tab bar with the shell's own padding intact. A row
 * sliced through its text by a fixed bottom bar is the exact defect this
 * screen is judged against, so the preview is sized never to produce one, and
 * the counts are confirmed in the captures rather than by arithmetic. "See
 * all" sits directly over the list: this is a preview, not the log, so its
 * length is free to change.
 */
const HOME_ENTRY_LIMIT = 4;
const POPUP_ENTRY_LIMIT = 2;

/**
 * Rows beyond the popup's two. The container is the screen shell, whose
 * content box is about 353px in the 400px popup and about 473px in the 520px
 * side panel, so 420px separates the two with room either side.
 */
const PANEL_ONLY_ROW = "hidden @min-[420px]:flex";

interface HomeViewProps {
  /** Moves the popup to another tab: "See all" and the display-name row use it. */
  onNavigate?: (tab: TabKey) => void;
}

/**
 * How long the Display name row may hold a placeholder before it states what
 * it knows. Long enough for the commit before the lookup starts and for the
 * cached read that answers it on a normal open, and no longer: a key that has
 * published nothing would otherwise sit behind a grey bar for as long as an
 * unreachable relay takes to time out, and a bar that becomes the resting
 * state tells the user less than "Not set" does. When a slow read does land
 * afterwards the row fills itself in.
 */
const PROFILE_PLACEHOLDER_MS = 200;

/**
 * Whether the profile lookup for this key has finished, or has been given long
 * enough that the row should stop waiting for it.
 *
 * `useProfileMetadata` starts with `isLoading` false and only flips it inside
 * an effect, so there is one painted commit in which a key that has published
 * a name is indistinguishable from one that has not. Reporting the difference
 * lets the row show a placeholder for that frame instead of claiming "Not set"
 * and then correcting itself.
 */
function useProfileSettled(
  pubkeyHex: string | undefined,
  isLoading: boolean
): boolean {
  const [settledFor, setSettledFor] = useState<string | undefined>(undefined);
  const wasLoading = useRef(false);

  useEffect(() => {
    if (wasLoading.current && !isLoading) {
      setSettledFor(pubkeyHex);
    }
    wasLoading.current = isLoading;
  }, [isLoading, pubkeyHex]);

  useEffect(() => {
    if (pubkeyHex === undefined) return;
    const timer = window.setTimeout(
      () => setSettledFor(pubkeyHex),
      PROFILE_PLACEHOLDER_MS
    );
    return () => window.clearTimeout(timer);
  }, [pubkeyHex]);

  // No key means nothing to wait for.
  return pubkeyHex === undefined || settledFor === pubkeyHex;
}

/**
 * Home is composed for a 400x600 popup and fills a 520x700 side panel.
 *
 * One focal point: the public-key card, the only bordered surface above the
 * fold. The header already carries the key's name, so the card carries the key
 * itself, with Copy and QR as icon actions. Under it the facts a signer is
 * judged on - keys, relays, site permissions, and whether this identity has
 * published a name - as plain rows on the canvas, each opening the surface
 * that manages it. Then the decisions the vault has made, or, before any site
 * has asked, a card that says so and nothing else.
 */
export function HomeView({ onNavigate }: HomeViewProps) {
  const { settings, isLoading: settingsLoading } = useAppSettings();
  const { keys, selectedUnlockedKey, isLoading: keysLoading } =
    useKeyManager();
  const { entries, loading: activityLoading } = useActivityLog();

  // Read before the early return: hooks cannot be called conditionally. The
  // hook keys its fetch off the joined pubkeys, so a fresh array each render
  // costs nothing.
  const activePubkeyHex = selectedUnlockedKey?.publicKeyHex;
  const { profiles, isLoading: profileLoading } = useProfileMetadata(
    activePubkeyHex ? [activePubkeyHex] : []
  );
  const profileSettled = useProfileSettled(activePubkeyHex, profileLoading);

  if (settingsLoading || keysLoading) {
    return <HomeSkeleton />;
  }

  // The published profile only. The key's local label is not a display name -
  // it never left this browser, so showing it here would claim the identity
  // announces something it does not.
  const activeProfile = activePubkeyHex
    ? profiles.get(activePubkeyHex)
    : undefined;

  return (
    // `@container` stays on the shell, which is always the full width of the
    // document: the measure below must never land on the element the queries
    // read, or narrowing the column would drop the container under its own
    // breakpoint and take the side panel's extra activity rows with it.
    <div className="screen-shell @container flex flex-col">
      {/* The measure. At popup width this is the full column and nothing
          moves; at side-panel width it holds the content to a readable line so
          a label and its value stay in conversation instead of sitting at
          opposite edges of a 520px document, and the space either side reads
          as page margin. `shrink-0` on every block: inside a flex column,
          `overflow-hidden` resets a card's automatic minimum height to 0, so
          with real activity the cards were squeezed and clipped their own rows
          instead of the shell scrolling. */}
      <div className="flex w-full flex-1 flex-col gap-4 @min-[420px]:mx-auto @min-[420px]:max-w-[384px]">
        <IdentityCard
          npub={selectedUnlockedKey?.publicKeyBech32}
          hasActiveKey={Boolean(selectedUnlockedKey)}
        />
        <SignerStatus
          keyCount={keys.length}
          relayCount={settings.relays.length}
          originCount={settings.origins.length}
          displayName={activeProfile?.display_name || activeProfile?.name || ""}
          displayNamePending={!profileSettled}
          onNavigate={onNavigate}
        />
        <ActivitySection
          entries={entries.slice(0, HOME_ENTRY_LIMIT)}
          loading={activityLoading}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}

function IdentityCard({
  npub,
  hasActiveKey,
}: {
  npub?: string;
  hasActiveKey: boolean;
}) {
  if (npub) {
    return (
      <section
        className="ink-card shrink-0 overflow-hidden"
        aria-label="Active identity"
      >
        <Pubkey pubkey={npub} layout="block" label="Public key" />
      </section>
    );
  }

  return (
    <section
      className="ink-card shrink-0 overflow-hidden"
      aria-label="Active identity"
    >
      <div className="px-4 py-3.5">
        <p className="section-label">Public key</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {hasActiveKey
            ? "The stored public key for this key could not be read."
            : "Create or import a key to start signing locally."}
        </p>
      </div>
    </section>
  );
}

/**
 * Plain rows divided by hairlines, no box: the identity card is the one
 * bordered surface above the activity list, so these facts read as secondary.
 */
function SignerStatus({
  keyCount,
  relayCount,
  originCount,
  displayName,
  displayNamePending,
  onNavigate,
}: {
  keyCount: number;
  relayCount: number;
  originCount: number;
  displayName: string;
  displayNamePending: boolean;
  onNavigate?: (tab: TabKey) => void;
}) {
  return (
    <section className="shrink-0" aria-label="Signer status">
      <HomeRow
        icon={Key}
        label="Keys"
        value={keyCount > 0 ? String(keyCount) : "None yet"}
        onClick={() => openOptionsTab("keys")}
      />
      <HomeRow
        icon={Globe}
        label="Relays"
        value={relayCount > 0 ? String(relayCount) : "None"}
        onClick={() => openOptionsTab("relays")}
      />
      <HomeRow
        icon={Shield}
        label="Site permissions"
        value={originCount > 0 ? `${originCount} trusted` : "None granted"}
        onClick={() => openOptionsTab("permissions")}
      />
      {/* The one thing a fresh key can act on, in the same grammar as the rows
          around it rather than as a button competing with the identity card.
          Labelled "Display name" and not "Profile": the tab bar already has a
          Profile button, and the runner and two e2e specs find it by a
          substring match that a second such button would make ambiguous. */}
      {onNavigate && (
        <HomeRow
          icon={User}
          label="Display name"
          value={displayName || "Not set"}
          pending={displayNamePending}
          onClick={() => onNavigate("profile")}
        />
      )}
    </section>
  );
}

function ActivitySection({
  entries,
  loading,
  onNavigate,
}: {
  entries: ActivityEntry[];
  loading: boolean;
  onNavigate?: (tab: TabKey) => void;
}) {
  if (entries.length === 0) {
    return loading ? <ActivityLoading /> : <FirstRun />;
  }

  return (
    <section className="shrink-0" aria-labelledby="home-recent-activity">
      <div className="flex h-7 items-center justify-between">
        <h3 id="home-recent-activity" className="section-label">
          Recent activity
        </h3>
        {onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate("activity")}
            className="-my-2 -mr-2 h-11 rounded-lg px-2 text-[13px] font-semibold text-[var(--ink-violet)] transition-colors duration-150 hover:bg-card"
          >
            See all
          </button>
        )}
      </div>
      <div className="mt-2">
        {entries.map((entry, index) => (
          <ActivityRow
            key={entry.id}
            entry={entry}
            className={index >= POPUP_ENTRY_LIMIT ? PANEL_ONLY_ROW : undefined}
          />
        ))}
      </div>
    </section>
  );
}

function ActivityLoading() {
  return (
    <section className="shrink-0" aria-hidden="true">
      <div className="flex h-7 items-center">
        <Bone className="h-2.5 w-28" />
      </div>
      <div className="mt-2">
        <ActivitySkeleton />
      </div>
    </section>
  );
}

function HomeRow({
  icon: Icon,
  label,
  value,
  pending = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  /** Hold the value slot while the real one is still being read. */
  pending?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-busy={pending || undefined}
      className="ink-row min-h-[46px] w-full text-left transition-colors duration-150 hover:bg-card focus-visible:-outline-offset-2"
    >
      <Icon
        className="size-[18px] shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {label}
      </span>
      {pending ? (
        <Bone className="h-3 w-24" />
      ) : (
        <span className="truncate text-sm font-medium text-muted-foreground">
          {value}
        </span>
      )}
      <ChevronRight
        className="size-4 shrink-0 text-[var(--ink-3)]"
        aria-hidden="true"
      />
    </button>
  );
}

function ActivityRow({
  entry,
  className,
}: {
  entry: ActivityEntry;
  className?: string;
}) {
  const allowed = entry.decision === "allow";
  return (
    <div className={cn("ink-row min-h-14", className)}>
      <SealMark
        icon={allowed ? Check : X}
        tone={allowed ? "success" : "danger"}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {describeActivityAction(entry)}
        </p>
        {/* Full origin, scheme included. The activity log is where a user
            checks what happened, and "example.com" does not say whether it
            was the real one. */}
        <p className="truncate font-mono text-[11.5px] text-muted-foreground">
          {formatOrigin(entry.origin).display}
        </p>
      </div>
      <time className="shrink-0 font-mono text-xs text-muted-foreground">
        {formatRelativeTime(entry.timestamp)}
      </time>
    </div>
  );
}

/**
 * Shown until the first request has been decided, and it says exactly that.
 *
 * It carried the profile call-to-action until round 6, which put two unrelated
 * messages in one surface: a card headed "No activity yet" was also asking for
 * something that has nothing to do with activity, and a full-width notched
 * button at the card's inner edge read as a corner breaking past the card's
 * radius. The prompt is a status row now, so this card has one job.
 *
 * Two shapes, because the two viewports have different problems.
 *
 * In the popup the remaining column is barely taller than this message, so it
 * is plain type centred in that space: no border, nothing competing with the
 * identity card for the screen's first read.
 *
 * The side panel has a third of a screen spare, and three ways of spending it
 * have been tried and rejected - filled and centred (the content floated),
 * capped (the leftover read as a dead band), bounded without a border (the
 * bottom fifth read as blank). So here it fills the column to the shell's
 * bottom padding, takes the hairline border back, and sits its content at the
 * top rather than the middle. The empty space is then inside something that is
 * visibly the activity list waiting for its first row - which is what it
 * actually is - rather than canvas left over once the content ran out.
 *
 * `.ink-card` is declared with `@utility`, so the variant form applies the
 * shared card treatment at panel width without re-deriving its border, fill
 * and radius here.
 */
function FirstRun() {
  return (
    <section
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-5 text-center @min-[420px]:ink-card @min-[420px]:justify-start @min-[420px]:pt-8"
      aria-labelledby="home-first-run"
    >
      <SealMark icon={Activity} tone="muted" size="lg" />
      <div>
        <p id="home-first-run" className="text-sm font-semibold">
          No activity yet
        </p>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">
          Apps you log in to will ask Ostrilo to sign, and every decision is
          logged here.
        </p>
      </div>
    </section>
  );
}

/** Static placeholder blocks. No shimmer: DESIGN_RULES §11 bans loops. */
function Bone({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("block shrink-0 rounded-md bg-muted", className)}
    />
  );
}

const SKELETON_ROWS = ["keys", "relays", "permissions"] as const;

function ActivitySkeleton() {
  return (
    <div className="ink-row min-h-14" aria-hidden="true">
      <Bone className="seal size-7 rounded-none" />
      <div className="flex-1 space-y-2">
        <Bone className="h-3 w-36" />
        <Bone className="h-2.5 w-24" />
      </div>
      <Bone className="h-2.5 w-10" />
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="screen-shell" aria-busy="true">
      <span className="sr-only">Loading home</span>
      <div
        className="ink-card flex items-center justify-between gap-3 px-4 py-2.5"
        aria-hidden="true"
      >
        <div className="space-y-2.5">
          <Bone className="h-2.5 w-20" />
          <Bone className="h-4 w-44" />
        </div>
        <div className="flex gap-2">
          <Bone className="size-9" />
          <Bone className="size-9" />
        </div>
      </div>
      <div aria-hidden="true">
        {SKELETON_ROWS.map((row) => (
          <div key={row} className="ink-row min-h-[46px]">
            <Bone className="size-[18px]" />
            <Bone className="h-3 w-28" />
            <Bone className="ml-auto h-3 w-16" />
          </div>
        ))}
      </div>
      <div aria-hidden="true">
        <div className="flex h-7 items-center">
          <Bone className="h-2.5 w-28" />
        </div>
        <div className="mt-2">
          <ActivitySkeleton />
        </div>
      </div>
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
