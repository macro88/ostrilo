import type {
  AppSettingsPatch,
  OriginPolicyPatch,
} from "@/infrastructure/validation/schemas";
import type {
  UnsignedEvent,
  SignedEvent,
  PendingRequest,
  ApprovalAction,
  ActivityLogEntry,
  ActivityFilters,
} from "@/domain/types";

// Re-export error codes for convenience
export { RPC_ERROR_CODES, type RpcErrorCode } from "./error-codes";

export type RpcRequest =
  | { type: "policy.evaluate"; origin: string; kind: number }
  | { type: "vault.unlock"; password: string }
  | { type: "vault.lock" }
  | { type: "vault.generate"; password: string; label?: string }
  | { type: "vault.import"; keyInput: string; password: string; label?: string }
  | { type: "vault.select"; id: string }
  | { type: "vault.renameKey"; id: string; label: string }
  | { type: "vault.deleteKey"; id: string }
  | { type: "vault.export"; keyId?: string }
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
  | { type: "crypto.parsePrivateKey"; keyInput: string }
  // NIP-07 Nostr operations
  | { type: "nostr.getPublicKey" }
  | { type: "nostr.signEvent"; event: UnsignedEvent; origin: string }
  // Approval queue operations
  | { type: "approval.getNext" }
  | { type: "approval.resolve"; requestId: string; action: ApprovalAction }
  | { type: "approval.count" }
  // Activity log operations
  | { type: "activity.getRecent"; limit?: number; offset?: number }
  | {
      type: "activity.filterBy";
      origin?: string;
      kind?: number;
      limit?: number;
      offset?: number;
    }
  | { type: "activity.clear" }
  // Profile operations
  | { type: "profile.get"; params: { pubkey: string; forceFetch?: boolean } }
  | { type: "profile.getAll" }
  | { type: "profile.update"; params: { metadata: unknown } }
  | { type: "profile.clearCache"; params?: { pubkey?: string } };

// NIP-07 specific response types
export type NostrGetPublicKeyResponse =
  | { ok: true; data: { pubkey: string } }
  | { ok: false; error: string; details?: string };

export type NostrSignEventResponse =
  | { ok: true; data: { event: SignedEvent } }
  | { ok: false; error: string; details?: string };

export type ApprovalCountResponse =
  | { ok: true; data: { count: number } }
  | { ok: false; error: string; details?: string };

// Activity log response types
export type ActivityGetRecentResponse =
  | { ok: true; data: { entries: ActivityLogEntry[]; total: number } }
  | { ok: false; error: string; details?: string };

export type ActivityFilterResponse =
  | { ok: true; data: { entries: ActivityLogEntry[]; total: number } }
  | { ok: false; error: string; details?: string };

export type ActivityClearResponse =
  | { ok: true; data: null }
  | { ok: false; error: string; details?: string };

export type RpcResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; details?: string };

export type BgEvent = { __event: string };

export type RpcHandler = (req: RpcRequest) => Promise<RpcResponse>;
