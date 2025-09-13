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
import type {
  RpcRequest,
  RpcResponse,
} from "@/infrastructure/messaging/rpc";

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

  // Simple RPC handler
  browser.runtime.onMessage.addListener(
    (message: RpcRequest, sender, sendResponse) => {
      console.log("[BG] Received RPC message:", message?.type || "unknown");
      
      if (!message || typeof message !== "object" || !("type" in message)) {
        console.log("[BG] Invalid request format");
        sendResponse({ ok: false, error: "invalid_request" } as const);
        return false;
      }
      
      (async () => {
        try {
          let result: RpcResponse;
          switch (message.type) {
            case "policy.evaluate": {
              const data = await policy.evaluate({
                origin: message.origin,
                kind: message.kind,
              });
              result = { ok: true, data } as const;
              break;
            }
            case "vault.unlock": {
              const data = await vault.unlock(message.password);
              result = { ok: true, data } as const;
              break;
            }
            case "vault.lock": {
              await vault.lock();
              result = { ok: true, data: null } as const;
              break;
            }
            case "vault.generate": {
              const data = await vault.generateKey(
                message.password,
                message.label
              );
              result = { ok: true, data } as const;
              break;
            }
            case "vault.import": {
              const data = await vault.importKey(
                message.keyInput,
                message.password,
                message.label
              );
              result = { ok: true, data } as const;
              break;
            }
            case "vault.select": {
              await vault.selectKey(message.id);
              result = { ok: true, data: null } as const;
              break;
            }
            case "keys.list": {
              const data = await vault.listKeys();
              result = { ok: true, data } as const;
              break;
            }
            case "state.getLock": {
              const data = await vault.getLockState();
              result = { ok: true, data } as const;
              break;
            }
            case "vault.sign": {
              const data = await vault.sign(message.hashHex, message.keyId);
              result = { ok: true, data } as const;
              break;
            }
            case "settings.get": {
              const data = await settings.get();
              result = { ok: true, data } as const;
              break;
            }
            case "settings.update": {
              const data = await settings.update(message.patch as any);
              result = { ok: true, data } as const;
              break;
            }
            case "policy.setOrigin": {
              await policy.setOriginPolicy(message.origin, message.patch as any);
              result = { ok: true, data: null } as const;
              break;
            }
            case "policy.setKindRule": {
              await policy.setPerKindRule(
                message.origin,
                message.kind,
                message.mode as any
              );
              result = { ok: true, data: null } as const;
              break;
            }
            case "policy.clearSession": {
              await policy.clearSessionGrant(message.origin);
              result = { ok: true, data: null } as const;
              break;
            }
            case "policy.setSession": {
              await policy.setSessionGrant(message.origin, message.enabled);
              result = { ok: true, data: null } as const;
              break;
            }
            case "policy.removeOrigin": {
              await policy.removeOriginPolicy(message.origin);
              result = { ok: true, data: null } as const;
              break;
            }
            default:
              console.log("[BG] Unknown method:", (message as any).type);
              result = { ok: false, error: "unknown_method" } as const;
          }
          console.log("[BG] Sending response for", message.type, ":", result.ok ? "success" : result.error);
          sendResponse(result);
        } catch (e: any) {
          const errorResult = { ok: false, error: e?.message ?? String(e) } as const;
          console.log("[BG] Error handling", message.type, ":", errorResult.error);
          sendResponse(errorResult);
        }
      })();
      
      return true; // Keep message port open for async response
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
