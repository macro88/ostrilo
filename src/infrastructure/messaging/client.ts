import browser from "webextension-polyfill";
import type { RpcRequest, RpcResponse } from "./rpc";
// webextension-polyfill already imported above

export async function rpc<T = unknown>(req: RpcRequest): Promise<T> {
  const res = (await browser.runtime.sendMessage(req)) as RpcResponse;
  if (res && res.ok === true) return res.data as T;
  throw new Error((res as any)?.error ?? "rpc_failed");
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
  return rpc<import("@/src/domain/types").KeyRecord[]>({ type: "keys.list" });
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

export async function getSettings() {
  return rpc<import("@/src/domain/types").AppSettingsV1 | undefined>({
    type: "settings.get",
  });
}

export async function updateSettings(
  patch: Partial<import("@/src/domain/types").AppSettingsV1>
) {
  return rpc<import("@/src/domain/types").AppSettingsV1>({
    type: "settings.update",
    patch: patch as any,
  });
}

export function subscribeSettingsChanged(cb: () => void) {
  const handler = (msg: any) => {
    if (msg && msg.__event === "ostrilo.settings.changed") cb();
  };
  browser.runtime.onMessage.addListener(handler);
  return () => browser.runtime.onMessage.removeListener(handler);
}
