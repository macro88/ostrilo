import { browser } from "wxt/browser";
import type { RpcRequest, RpcResponse } from "./rpc";
import type {
  AppSettingsPatch,
  OriginPolicyPatch,
} from "@/infrastructure/validation/schemas";
// webextension-polyfill already imported above

export async function rpc<T = unknown>(req: RpcRequest): Promise<T> {
  const method = (req as any)?.type ?? "unknown";
  console.log("[CLIENT] Sending RPC:", method);

  const attempt = async (): Promise<T> => {
    try {
      const res = (await browser.runtime.sendMessage(req)) as
        | RpcResponse
        | undefined;

      console.log("[CLIENT] Received response for", method, ":", res);

      // More detailed error diagnostics
      if (!res) {
        throw new Error(`rpc:${method}:no_response`);
      }

      if (typeof res !== "object") {
        throw new Error(`rpc:${method}:invalid_response_type`);
      }

      if ((res as any).ok === true) {
        return (res as any).data as T;
      }

      const err = (res as any)?.error ?? "unknown_error";
      throw new Error(`rpc:${method}:${err}`);
    } catch (e: any) {
      console.log("[CLIENT] RPC error for", method, ":", e);
      // Preserve original error if it's already formatted
      if (e?.message?.startsWith?.(`rpc:${method}:`)) {
        throw e;
      }
      // Format connection/transport errors
      const msg = e?.message || String(e);
      throw new Error(`rpc:${method}:transport_error:${msg}`);
    }
  };

  const isWarmup = (m: string) =>
    /Receiving end does not exist|Could not establish connection|No message port|The message port closed|Extension context invalidated/i.test(
      m
    );

  let lastErr: any;
  for (const delay of [0, 80, 160, 320]) {
    try {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return await attempt();
    } catch (e: any) {
      lastErr = e;
      const msg = e?.message || String(e);
      // Only retry on connection/warmup issues, not on RPC-level errors
      if (!isWarmup(msg)) break;
      // continue and retry with next delay
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr) || `rpc:${method}:transport_failed`);
}

export async function evaluatePolicy(origin: string, kind: number) {
  return rpc<{ decision: string; reason: string } | any>({
    type: "policy.evaluate",
    origin,
    kind,
  });
}

export async function unlockVault(password: string) {
  return rpc<{ selectedKeyId?: string }>({ type: "vault.unlock", password });
}

export async function lockVault() {
  return rpc<null>({ type: "vault.lock" });
}

export async function listKeys() {
  return rpc<import("@/domain/types").KeyRecord[]>({ type: "keys.list" });
}

export async function generateKey(password: string, label?: string) {
  return rpc<import("@/domain/types").KeyRecord>({
    type: "vault.generate",
    password,
    label,
  });
}

export async function importKey(
  keyInput: string,
  password: string,
  label?: string
) {
  return rpc<import("@/domain/types").KeyRecord>({
    type: "vault.import",
    keyInput,
    password,
    label,
  });
}

export async function selectKey(id: string) {
  return rpc<null>({ type: "vault.select", id });
}

export async function getLockState() {
  return rpc<{ isLocked: boolean; selectedKeyId?: string }>({
    type: "state.getLock",
  });
}

export async function signHash(hashHex: string, keyId?: string) {
  return rpc<{ sigHex: string; keyId: string }>({
    type: "vault.sign",
    hashHex,
    keyId,
  });
}

export async function exportKey(keyId?: string) {
  return rpc<{ nsec: string; hex: string }>({
    type: "vault.export",
    keyId,
  });
}

// Settings caching to prevent excessive RPC calls
let settingsCache: {
  data: import("@/domain/types").AppSettingsV1 | undefined;
  timestamp: number;
} | null = null;

const SETTINGS_CACHE_TTL = 5000; // 5 seconds cache

export async function getSettings(forceRefresh = false) {
  // Check cache first
  if (
    !forceRefresh &&
    settingsCache &&
    Date.now() - settingsCache.timestamp < SETTINGS_CACHE_TTL
  ) {
    return settingsCache.data;
  }

  // Fetch from background
  const data = await rpc<import("@/domain/types").AppSettingsV1 | undefined>({
    type: "settings.get",
  });

  // Update cache
  settingsCache = {
    data,
    timestamp: Date.now(),
  };

  return data;
}

export async function updateSettings(patch: AppSettingsPatch) {
  const result = await rpc<import("@/domain/types").AppSettingsV1>({
    type: "settings.update",
    patch,
  });

  // Invalidate cache after update
  settingsCache = null;

  return result;
}

export function subscribeSettingsChanged(cb: () => void) {
  const handler = (msg: any) => {
    if (msg && msg.__event === "ostrilo.settings.changed") {
      // Invalidate cache when settings change externally
      settingsCache = null;
      cb();
    }
  };
  browser.runtime.onMessage.addListener(handler);
  return () => browser.runtime.onMessage.removeListener(handler);
}

export async function policySetOrigin(
  origin: string,
  patch: OriginPolicyPatch
) {
  return rpc<null>({ type: "policy.setOrigin", origin, patch });
}

export async function policySetKindRule(
  origin: string,
  kind: number,
  mode: "allow" | "deny" | "ask"
) {
  return rpc<null>({ type: "policy.setKindRule", origin, kind, mode });
}

export async function policyClearSession(origin: string) {
  return rpc<null>({ type: "policy.clearSession", origin });
}

export async function policySetSession(origin: string, enabled: boolean) {
  return rpc<null>({ type: "policy.setSession", origin, enabled });
}

export async function policyRemoveOrigin(origin: string) {
  return rpc<null>({ type: "policy.removeOrigin", origin });
}

export async function evaluatePasswordStrength(password: string) {
  return rpc<{ score: number; feedback: string[]; warning: string }>({
    type: "crypto.evaluatePassword",
    password,
  });
}

export async function parsePrivateKey(keyInput: string) {
  return rpc<Uint8Array>({
    type: "crypto.parsePrivateKey",
    keyInput,
  });
}

// Approval queue operations
export async function getNextApprovalRequest() {
  return rpc<{ request: import("@/domain/types").PendingRequest | null }>({
    type: "approval.getNext",
  });
}

export async function resolveApprovalRequest(
  requestId: string,
  action: import("@/domain/types").ApprovalAction
) {
  return rpc<{ resolved: boolean }>({
    type: "approval.resolve",
    requestId,
    action,
  });
}

export async function getApprovalCount() {
  return rpc<{ count: number }>({ type: "approval.count" });
}
