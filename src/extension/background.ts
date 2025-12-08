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

  // Create service context
  const serviceContext = {
    vault,
    policy,
    settings,
  };

  // Create approval queue service
  const approvalQueue = new ApprovalQueueService();

  // Setup modular RPC router
  const router = new RpcRouter();
  router.registerModule("vault", new VaultRpcHandler());
  router.registerModule("policy", new PolicyRpcHandler());
  router.registerModule("settings", new SettingsRpcHandler());
  router.registerModule("crypto", new CryptoRpcHandler());
  router.registerModule("state", new StateRpcHandler());
  router.registerModule("keys", new VaultRpcHandler()); // keys.list is handled by VaultRpcHandler
  router.registerModule("nostr", new NostrRpcHandler(approvalQueue)); // NIP-07 operations with approval
  router.registerModule("approval", new ApprovalRpcHandler(approvalQueue)); // Approval queue operations

  console.log(
    "[Background] Registered RPC modules:",
    router.getRegisteredNamespaces()
  );

  // Register the RPC message listener
  browser.runtime.onMessage.addListener(
    createRpcMessageListener(router, serviceContext)
  );

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
