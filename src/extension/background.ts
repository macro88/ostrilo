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

  // Setup modular RPC router
  const router = new RpcRouter();
  router.registerModule("vault", new VaultRpcHandler());
  router.registerModule("policy", new PolicyRpcHandler());
  router.registerModule("settings", new SettingsRpcHandler());
  router.registerModule("crypto", new CryptoRpcHandler()); // Crypto utility operations
  router.registerModule("state", new StateRpcHandler()); // State queries (lock status, etc.)
  router.registerModule("keys", new VaultRpcHandler()); // keys.list is handled by VaultRpcHandler
  router.registerModule("nostr", new NostrRpcHandler(approvalQueue)); // NIP-07 operations with approval
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
