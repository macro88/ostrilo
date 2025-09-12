export type RpcRequest =
  | { type: "policy.evaluate"; origin: string; kind: number }
  | { type: "vault.unlock"; password: string }
  | { type: "vault.lock" }
  | { type: "keys.list" }
  | { type: "state.getLock" }
  | { type: "vault.sign"; hashHex: string; keyId?: string }
  | { type: "settings.get" }
  | { type: "settings.update"; patch: Record<string, unknown> };

export type RpcResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export type BgEvent = { __event: string };

export type RpcHandler = (req: RpcRequest) => Promise<RpcResponse>;
