import type {
  AppSettingsPatch,
  OriginPolicyPatch,
} from "@/infrastructure/validation/schemas";

export type RpcRequest =
  | { type: "policy.evaluate"; origin: string; kind: number }
  | { type: "vault.unlock"; password: string }
  | { type: "vault.lock" }
  | { type: "vault.generate"; password: string; label?: string }
  | { type: "vault.import"; keyInput: string; password: string; label?: string }
  | { type: "vault.select"; id: string }
  | { type: "keys.list" }
  | { type: "state.getLock" }
  | { type: "vault.sign"; hashHex: string; keyId?: string }
  | { type: "settings.get" }
  | { type: "settings.update"; patch: AppSettingsPatch }
  | { type: "policy.setOrigin"; origin: string; patch: OriginPolicyPatch }
  | { type: "policy.setKindRule"; origin: string; kind: number; mode: string }
  | { type: "policy.clearSession"; origin: string }
  | { type: "policy.setSession"; origin: string; enabled: boolean }
  | { type: "policy.removeOrigin"; origin: string }
  | { type: "crypto.evaluatePassword"; password: string }
  | { type: "crypto.parsePrivateKey"; keyInput: string };

export type RpcResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export type BgEvent = { __event: string };

export type RpcHandler = (req: RpcRequest) => Promise<RpcResponse>;
