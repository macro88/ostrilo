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

// Window tracking state for approval popup
let approvalWindowId: number | null = null;

/**
 * Focus existing approval window or create new one
 * If in sidepanel mode, sends message to switch to Activity tab instead
 * Ensures only one approval window exists at a time
 * @param settings - Current app settings to check sidepanel mode
 * @returns Window ID of the approval window (or undefined if using sidepanel)
 */

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
  settings: SettingsService
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
  const window = await browser.windows.create({
    url: browser.runtime.getURL("/approval.html"),
    type: "popup",
    width: 640,
    height: 640,
    focused: true,
  });

  approvalWindowId = window.id!;
  console.log(`[Background] Created new approval window ${approvalWindowId}`);
  return approvalWindowId;
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
      focusOrCreateApprovalWindow(settings)
    )
  ); // NIP-07 operations with approval
  router.registerModule("approval", new ApprovalRpcHandler(approvalQueue)); // Approval queue operations
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
