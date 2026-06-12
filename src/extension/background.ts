import { browser } from "wxt/browser";
import { createStorageSuite } from "@/infrastructure/storage/adapters";
import {
  WebCryptoAesGcm,
  NoblePbkdf2,
  NobleSchnorr,
} from "@/infrastructure/crypto/adapters";
import { KeyVaultService } from "@/application/services/key-vault.service";
import { PolicyService } from "@/application/services/policy.service";
import { SettingsService } from "@/application/services/settings.service";
import { ActivityLogService } from "@/application/services/activity-log.service";
import { ProfileService } from "@/application/services/profile.service";
import { RelayManager } from "@/infrastructure/relay";
import {
  RpcRouter,
  createRpcMessageListener,
} from "@/infrastructure/messaging/rpc-router";
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

const APPROVAL_WINDOW_WIDTH = 960;
const APPROVAL_WINDOW_HEIGHT = 640;
const APPROVAL_BADGE_COLOR = "#5f50a0";

// Window tracking state for approval popup
let approvalWindowId: number | null = null;
let approvalWindowOperation: Promise<number | undefined> | null = null;

/**
 * Update the browser action badge to mirror the current approval queue depth.
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

  await Promise.all([
    browser.action.setBadgeText({ text: "" }),
    browser.action.setTitle({ title: "Ostrilo Signer" }),
  ]);
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
 * - Sidepanel mode: Broadcasts "ostrilo.switchToActivity" message, returns undefined
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
  console.log(
    "[Background] focusOrCreateApprovalWindow - sidePanel setting:",
    appSettings?.sidePanel
  );

  if (appSettings?.sidePanel) {
    console.log(
      "[Background] Sidepanel mode enabled, sending message to switch to Activity tab"
    );
    // Send message to sidepanel/popup to switch to Activity tab
    browser.runtime
      .sendMessage({ __event: "ostrilo.switchToActivity" })
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
      console.log(
        `[Background] Focused existing approval window ${approvalWindowId}`
      );
      return approvalWindowId;
    } catch (error) {
      // Window was closed by user
      console.log(
        `[Background] Previous approval window ${approvalWindowId} no longer exists`
      );
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

export default defineBackground(() => {
  // Compose services
  const storage = createStorageSuite();
  const vault = new KeyVaultService(
    storage,
    WebCryptoAesGcm,
    NoblePbkdf2,
    NobleSchnorr
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

  // Initialize relay manager with default relays
  const defaultRelays = [
    "wss://relay.damus.io",
    "wss://relay.nostr.band",
    "wss://nos.lol",
  ];
  const relayManager = new RelayManager(defaultRelays);

  // Initialize profile service
  const profile = new ProfileService(storage, relayManager, vault);

  // Create service context
  const serviceContext = {
    vault,
    policy,
    settings,
    activityLog,
    profile,
  };

  // Create approval queue service
  const approvalQueue = new ApprovalQueueService();

  // Set up callback to broadcast queue changes to UI
  approvalQueue.setChangeCallback(() => {
    updateApprovalBadge(approvalQueue.count()).catch((err) => {
      console.error("[Background] Failed to update approval badge:", err);
    });

    // Broadcast queue.updated message to all listeners (approval window, activity page, etc.)
    browser.runtime
      .sendMessage({ __event: "ostrilo.queue.updated" })
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

  console.log(
    "[Background] Registered RPC modules:",
    router.getRegisteredNamespaces()
  );

  // Register the RPC message listener
  browser.runtime.onMessage.addListener(
    createRpcMessageListener(router, serviceContext)
  );

  // Handle unlock prompt requests
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === "openUnlockPrompt") {
      console.log("[Background] Opening unlock prompt...");
      // Open the extension popup to prompt unlock
      browser.action.openPopup().catch((err) => {
        console.warn("[Background] Failed to open popup:", err);
        // Fallback: open in new tab or window
        browser.windows
          .create({
            url: browser.runtime.getURL("/popup.html"),
            type: "popup",
            width: 400,
            height: 600,
          })
          .catch((err2) =>
            console.error("[Background] Failed to open popup window:", err2)
          );
      });
      return true; // Keep message channel open
    }
  });

  browser.runtime.onMessage.addListener((message) => {
    if (message?.__command === "ostrilo.openApprovalWindow") {
      return focusOrCreateApprovalWindow(settings, approvalQueue)
        .then((windowId) => ({ ok: true, windowId }))
        .catch((err) => ({
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : "Failed to open approval window",
        }));
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
  apply();
  browser.storage.onChanged.addListener((changes) => {
    if ("isDocked" in changes) {
      apply();
    }
  });
});
