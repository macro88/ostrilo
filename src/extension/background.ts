import { browser } from "wxt/browser";
import { sanitizeRelayUrls } from "@/domain/relay/url";
import { normalizeAutoLockMinutes } from "@/domain/types";
import { createStorageSuite } from "@/infrastructure/storage/adapters";
import {
  WebCryptoAesGcm,
  VaultKdf,
  NobleSchnorr,
  NobleSha256,
  ScureBech32,
} from "@/infrastructure/crypto/adapters";
import { KeyVaultService } from "@/application/services/key-vault.service";
import { PolicyService } from "@/application/services/policy.service";
import { SettingsService } from "@/application/services/settings.service";
import { ActivityLogService } from "@/application/services/activity-log.service";
import { UnlockThrottleService } from "@/application/services/unlock-throttle.service";
import { DisclosureRateLimitService } from "@/application/services/disclosure-rate-limit.service";
import { ProfileService } from "@/application/services/profile.service";
import { RelayManager } from "@/infrastructure/relay";
import {
  RpcRouter,
  createRpcMessageListener,
} from "@/infrastructure/messaging/rpc-router";
import { BROADCAST_EVENTS } from "@/infrastructure/messaging/events";
import {
  RPC_ERROR_CODES,
  createRpcErrorResponse,
} from "@/infrastructure/messaging/error-codes";
import {
  VaultRpcHandler,
  PolicyRpcHandler,
  SettingsRpcHandler,
  CryptoRpcHandler,
  StateRpcHandler,
  NostrRpcHandler,
  ApprovalRpcHandler,
  ActivityRpcHandler,
  ProfileRpcHandler,
} from "@/infrastructure/messaging/handlers";
import { ApprovalQueueService } from "@/application/services/approval-queue.service";

type RelaySettings = { relays?: unknown };

const APPROVAL_WINDOW_WIDTH = 960;
const APPROVAL_WINDOW_HEIGHT = 640;
const APPROVAL_BADGE_COLOR = "#5f50a0";

// Window tracking state for approval popup
let approvalWindowId: number | null = null;
let approvalWindowOperation: Promise<number | undefined> | null = null;

/**
 * Set when a signing request was refused because the vault is locked.
 *
 * This is the replacement for the page-triggered unlock popup: the user
 * finds out that a site wanted something, on their own toolbar, at a moment
 * of their choosing. Cleared on unlock.
 */
let lockedRequestPending = false;

/** Amber, per docs/design/DESIGN_RULES.md: a warning, not a success. */
const LOCKED_BADGE_COLOR = "#94682E";

/**
 * Update the browser action badge to mirror the current approval queue depth.
 *
 * Precedence: a pending approval outranks a refused-while-locked request.
 * An approval is a decision the user has to make now; the locked marker is
 * only a notice that something was turned away.
 */
async function updateApprovalBadge(count: number): Promise<void> {
  if (count > 0) {
    await Promise.all([
      browser.action.setBadgeText({ text: count.toString() }),
      browser.action.setBadgeBackgroundColor({
        color: APPROVAL_BADGE_COLOR,
      }),
      browser.action.setTitle({
        title: `Ostrilo - ${count} approval${count > 1 ? "s" : ""} pending`,
      }),
    ]);
    return;
  }

  if (lockedRequestPending) {
    await Promise.all([
      browser.action.setBadgeText({ text: "!" }),
      browser.action.setBadgeBackgroundColor({ color: LOCKED_BADGE_COLOR }),
      browser.action.setTitle({
        title: "Ostrilo - a site asked to sign while the vault was locked",
      }),
    ]);
    return;
  }

  await Promise.all([
    browser.action.setBadgeText({ text: "" }),
    browser.action.setTitle({ title: "Ostrilo Signer" }),
  ]);
}

/** Raise or clear the refused-while-locked marker. */
async function setLockedRequestPending(
  pending: boolean,
  count: number
): Promise<void> {
  if (lockedRequestPending === pending) return;
  lockedRequestPending = pending;
  await updateApprovalBadge(count);
}

/**
 * Focus or create the approval window based on mode settings.
 *
 * In sidepanel mode, this broadcasts a message to the active UI to switch
 * to the Activity tab instead of creating a popup window. In popup mode,
 * it reuses an existing approval window if open, or creates a new one.
 *
 * @param settings - SettingsService instance for checking sidePanel preference
 * @returns Promise resolving to the window ID (popup mode) or undefined (sidepanel mode)
 *
 * @remarks
 * - Sidepanel mode: Broadcasts switch-to-activity event, returns undefined
 * - Popup mode: Focuses existing window if available, or creates new 640x640 popup
 * - Window ID tracking ensures single approval window across multiple requests
 * - Window close events automatically clear the tracked window ID
 */
async function focusOrCreateApprovalWindow(
  settings: SettingsService,
  approvalQueue: ApprovalQueueService
): Promise<number | undefined> {
  if (approvalWindowOperation) {
    return approvalWindowOperation;
  }

  approvalWindowOperation = focusOrCreateApprovalWindowInner(
    settings,
    approvalQueue
  ).finally(() => {
    approvalWindowOperation = null;
  });

  return approvalWindowOperation;
}

async function focusOrCreateApprovalWindowInner(
  settings: SettingsService,
  approvalQueue: ApprovalQueueService
): Promise<number | undefined> {
  // Check if in sidepanel mode
  const appSettings = await settings.get();

  if (appSettings?.sidePanel) {
    // Send message to sidepanel/popup to switch to Activity tab
    browser.runtime
      .sendMessage({ __event: BROADCAST_EVENTS.SWITCH_TO_ACTIVITY })
      .catch(() => {
        // Ignore if no listeners
      });
    return undefined;
  }

  // Try to focus existing window
  if (approvalWindowId !== null) {
    try {
      await browser.windows.update(approvalWindowId, { focused: true });
      await updateApprovalBadge(approvalQueue.count());
      return approvalWindowId;
    } catch {
      // Window was closed by user
      approvalWindowId = null;
    }
  }

  // Create new approval window
  const approvalWindow = await browser.windows.create({
    url: browser.runtime.getURL("/approval.html"),
    type: "popup",
    width: APPROVAL_WINDOW_WIDTH,
    height: APPROVAL_WINDOW_HEIGHT,
    focused: true,
  });

  if (typeof approvalWindow?.id !== "number") {
    throw new Error("Approval window was created without a window ID");
  }

  approvalWindowId = approvalWindow.id;
  await updateApprovalBadge(approvalQueue.count());
  console.log(`[Background] Created new approval window ${approvalWindowId}`);
  return approvalWindowId;
}

/**
 * Close the tracked approval window when the queue has been fully handled.
 */
async function closeApprovalWindow(): Promise<void> {
  if (approvalWindowId === null) {
    return;
  }

  const windowId = approvalWindowId;
  approvalWindowId = null;

  try {
    await browser.windows.remove(windowId);
  } catch (error) {
    console.warn(
      `[Background] Approval window ${windowId} could not be closed`,
      error
    );
  }
}

// aislop-ignore-next-line eslint/no-undef -- wxt auto-import; declared in .wxt/types/imports.d.ts, which this scan excludes as generated code. pnpm run compile is the authority on undefined identifiers here.
export default defineBackground(() => {
  // Compose services
  const storage = createStorageSuite();
  const vault = new KeyVaultService(
    storage,
    WebCryptoAesGcm,
    VaultKdf,
    NobleSchnorr,
    NobleSha256,
    ScureBech32
  );
  const policy = new PolicyService(storage);
  const settings = new SettingsService(storage);
  const activityLog = new ActivityLogService(storage.local);

  // Align activity log capacity with settings at startup
  settings
    .get()
    .then((s) => {
      if (s?.maxActivityEntries) {
        activityLog.setMaxEntries(s.maxActivityEntries);
      }
    })
    .catch((err) => console.warn("Failed to sync activity log settings", err));

  const relayManager = new RelayManager([]);

  const syncRelayManager = (relaySettings?: RelaySettings) => {
    // Sanitize before the relay list is used: an unbounded list means every
    // named relay learns every managed pubkey. `sanitizeRelayUrls` trims,
    // de-duplicates, rejects anything that is not a bare `wss:` URL, and
    // bounds the count. RelayManager sanitizes again.
    const relayUrls = sanitizeRelayUrls(relaySettings?.relays);
    relayManager.setRelayUrls(relayUrls).catch((err) => {
      console.warn("Failed to sync relay settings", err);
    });
  };

  settings
    .get()
    .then(syncRelayManager)
    .catch((err) => console.warn("Failed to load relay settings", err));

  // Initialize profile service
  const profile = new ProfileService(storage, relayManager, vault);

  // Create service context
  // Persisted in storage.local, not a timer: setTimeout does not survive MV3
  // service-worker termination, so a timer-based lockout would evaporate.
  const unlockThrottle = new UnlockThrottleService(storage.local);

  // In memory, unlike the unlock throttle: the attack it bounds is a fast
  // polling loop, and a page polling fast enough to matter keeps this worker
  // alive. See the module comment.
  const disclosureRateLimit = new DisclosureRateLimitService();

  const serviceContext = {
    vault,
    policy,
    settings,
    activityLog,
    profile,
    unlockThrottle,
    disclosureRateLimit,
    onLockedPageRequest: () => {
      void setLockedRequestPending(true, approvalQueue.count());
    },
  };

  // Create approval queue service
  const approvalQueue = new ApprovalQueueService();

  // Locking denies whatever is waiting for approval.
  //
  // A pending request outlived the session that raised it: the badge kept
  // its count, the approval window kept its buttons, and approving after a
  // later unlock signed an event the user had already walked away from.
  // `clear()` resolves every pending entry as a denial, so the calling page
  // gets an answer rather than a hang.
  // A site asked to sign while the vault was locked. The page cannot open a
  // password prompt any more; this is how the user finds out.
  vault.onUnlock(() => {
    void setLockedRequestPending(false, approvalQueue.count());
  });

  vault.onLock(() => {
    approvalQueue.clear();
    void updateApprovalBadge(0);
    // Tell every open surface. Best-effort: with no listener this rejects,
    // and a page that misses it still notices on its next poll.
    browser.runtime
      .sendMessage({ __event: BROADCAST_EVENTS.VAULT_LOCKED })
      .catch(() => {});
  });

  // Set up callback to broadcast queue changes to UI
  approvalQueue.setChangeCallback(() => {
    updateApprovalBadge(approvalQueue.count()).catch((err) => {
      console.error("[Background] Failed to update approval badge:", err);
    });

    // Broadcast queue.updated message to all listeners (approval window, activity page, etc.)
    browser.runtime
      .sendMessage({ __event: BROADCAST_EVENTS.QUEUE_UPDATED })
      .catch(() => {
        // Ignore errors if no listeners are active
      });
  });

  // Track approval window lifecycle
  browser.windows.onRemoved.addListener((windowId) => {
    if (windowId === approvalWindowId) {
      console.log(`[Background] Approval window ${windowId} was closed`);
      approvalWindowId = null;
    }
  });

  // Setup modular RPC router
  const router = new RpcRouter();
  router.registerModule("vault", new VaultRpcHandler());
  router.registerModule("policy", new PolicyRpcHandler());
  router.registerModule("settings", new SettingsRpcHandler());
  router.registerModule("crypto", new CryptoRpcHandler()); // Crypto utility operations
  router.registerModule("state", new StateRpcHandler()); // State queries (lock status, etc.)
  router.registerModule("keys", new VaultRpcHandler()); // keys.list is handled by VaultRpcHandler
  router.registerModule(
    "nostr",
    new NostrRpcHandler(approvalQueue, () =>
      focusOrCreateApprovalWindow(settings, approvalQueue)
    )
  ); // NIP-07 operations with approval
  router.registerModule(
    "approval",
    new ApprovalRpcHandler(approvalQueue, {
      closeApprovalWindow,
      updateBadgeCount: () => updateApprovalBadge(approvalQueue.count()),
    })
  ); // Approval queue operations
  router.registerModule("activity", new ActivityRpcHandler()); // Activity log operations
  router.registerModule("profile", new ProfileRpcHandler()); // Profile metadata operations

  // Register the RPC message listener
  browser.runtime.onMessage.addListener(
    createRpcMessageListener(router, serviceContext)
  );

  // The `openUnlockPrompt` listener is deliberately gone.
  //
  // It opened the genuine password popup on request, and the request came
  // from the content script on behalf of any web page. So any page could
  // make the real master-password prompt appear, as often as it liked, with
  // no throttle - a nuisance, and a way to train the user to type their
  // master password at prompts they did not initiate. A locked vault now
  // answers `locked` and signals through the toolbar badge, which the page
  // cannot drive.
  browser.runtime.onMessage.addListener((message) => {
    if (message?.__command === "ostrilo.openApprovalWindow") {
      return focusOrCreateApprovalWindow(settings, approvalQueue)
        .then((windowId) => ({ ok: true, windowId }))
        .catch((err) =>
          createRpcErrorResponse(RPC_ERROR_CODES.APPROVAL_FAILED, {
            details:
              err instanceof Error
                ? err.message
                : "Failed to open approval window",
            method: "ostrilo.openApprovalWindow",
          })
        );
    }
  });

  // Side panel behavior management
  async function apply() {
    const result = await browser.storage.sync.get("isDocked");
    const docked = result.isDocked || false;
    const sp: any = (browser as any).sidePanel;
    if (!sp || typeof sp.setPanelBehavior !== "function") return;
    try {
      await sp.setPanelBehavior({ openPanelOnActionClick: docked });
      if (!docked) {
        // Best-effort hide
        if (typeof sp.setOptions === "function") {
          await sp.setOptions({ enabled: false });
        }
      }
    } catch (e) {
      console.warn("Ostrilo: behavior apply failed", e);
    }
  }

  // ==========================================================================
  // Auto-lock
  //
  // `autoLockMinutes` was a purely cosmetic setting: it drove two sliders and a
  // header label, and nothing enforced it. There was no chrome.alarms usage
  // anywhere, no browser.idle, and no timer that called lock(). The only call
  // to lock() in the whole codebase was the manual button. Meanwhile the README
  // advertised 'Automatic locking with configurable timeouts'.
  //
  // Two mechanisms, deliberately:
  //   1. An alarm fires and locks. This is the active path.
  //   2. getLockState() independently compares the stored lastActivity against
  //      the deadline on every access. This is the safety net: an MV3 worker can
  //      be evicted with the alarm pending, and a lock that depends only on a
  //      timer firing is a lock that can silently never happen.
  //
  // No key material, password or derived key is persisted to survive worker
  // termination. Eviction drops the keys, which is the desired outcome.
  // ==========================================================================
  const AUTO_LOCK_ALARM = 'ostrilo.autoLock';

  async function armAutoLock(): Promise<void> {
    const s = await settings.get();
    const minutes = normalizeAutoLockMinutes(s?.autoLockMinutes);
    await browser.alarms.clear(AUTO_LOCK_ALARM);
    // chrome.alarms enforces a minimum period; ask for the deadline but poll at
    // least once a minute so a short timeout is still honoured promptly by the
    // deadline check in getLockState().
    await browser.alarms.create(AUTO_LOCK_ALARM, {
      delayInMinutes: Math.max(minutes, 1),
      periodInMinutes: Math.max(Math.min(minutes, 5), 1),
    });
  }

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== AUTO_LOCK_ALARM) return;
    // getLockState() locks and zeroizes when the deadline has passed, so the
    // deadline logic lives in exactly one place.
    vault
      .getLockState()
      .then((state) => {
        if (state.isLocked) return browser.alarms.clear(AUTO_LOCK_ALARM);
      })
      .catch((err) => console.warn('[Background] auto-lock check failed', err));
  });

  // A fresh browser session starts locked. Session storage is normally cleared
  // by the browser, but do not rely on that for a security property.
  const startLocked = async () => {
    try {
      await vault.lock();
      await browser.alarms.clear(AUTO_LOCK_ALARM);
    } catch (err) {
      console.warn('[Background] failed to force locked state at startup', err);
    }
  };
  browser.runtime.onStartup.addListener(() => void startLocked());
  browser.runtime.onInstalled.addListener(() => void startLocked());

  // Re-arm whenever the timeout changes or activity is recorded.
  void armAutoLock();
  (globalThis as unknown as { __ostriloArmAutoLock?: () => Promise<void> })
    .__ostriloArmAutoLock = armAutoLock;
  apply();
  browser.storage.onChanged.addListener((changes) => {
    if (changes.appSettings?.newValue) {
      syncRelayManager(changes.appSettings.newValue as RelaySettings);
    }

    if ("isDocked" in changes) {
      apply();
    }

    if (changes.appSettings?.newValue) {
      // The timeout may have changed; re-arm against the new deadline.
      void armAutoLock();
    }
  });
});
