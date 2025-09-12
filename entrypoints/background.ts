import { browser } from "wxt/browser";
import { createStorageSuite } from "@/src/infrastructure/storage/adapters";
import {
  WebCryptoAesGcm,
  NoblePbkdf2,
  NobleSchnorr,
} from "@/src/infrastructure/crypto/adapters";
import { KeyVaultService } from "@/src/application/services/key-vault.service";
import { PolicyService } from "@/src/application/services/policy.service";
import type {
  RpcRequest,
  RpcResponse,
} from "@/src/infrastructure/messaging/rpc";

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

  // Simple RPC handler
  browser.runtime.onMessage.addListener(
    async (message: RpcRequest): Promise<RpcResponse> => {
      if (!message || typeof message !== "object" || !("type" in message)) {
        return { ok: false, error: "invalid_request" } as const;
      }
      try {
        switch (message.type) {
          case "policy.evaluate": {
            const data = await policy.evaluate({
              origin: message.origin,
              kind: message.kind,
            });
            return { ok: true, data } as const;
          }
          case "vault.unlock": {
            const data = await vault.unlock(message.password);
            return { ok: true, data } as const;
          }
          case "vault.lock": {
            await vault.lock();
            return { ok: true, data: null } as const;
          }
          case "keys.list": {
            const data = await vault.listKeys();
            return { ok: true, data } as const;
          }
          case "state.getLock": {
            const data = await vault.getLockState();
            return { ok: true, data } as const;
          }
          case "vault.sign": {
            const data = await vault.sign(message.hashHex, message.keyId);
            return { ok: true, data } as const;
          }
          default:
            return { ok: false, error: "unknown_method" } as const;
        }
      } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) } as const;
      }
    }
  );
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
