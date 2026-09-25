import type {
  AppSettingsPatch,
  OriginPolicyPatch,
} from "@/infrastructure/validation/schemas";
import type { RpcErrorObject } from "./error-codes";
import type {
  UnsignedEvent,
  SignedEvent,
  ApprovalAction,
  ActivityLogEntry,
} from "@/domain/types";

// Re-export error codes for convenience
export {
  RPC_ERROR_CODES,
  RPC_ERROR_MESSAGES,
  RPC_NUMERIC_ERROR_CODES,
  createRpcError,
  createRpcErrorResponse,
  getRpcErrorCode,
  type RpcErrorCode,
  type RpcErrorObject,
} from "./error-codes";

export type RpcRequest =
  | { type: "policy.evaluate"; origin: string; kind: number }
  | { type: "vault.unlock"; password: string }
  | { type: "vault.lock" }
  | { type: "vault.generate"; password: string; label?: string }
  | { type: "vault.import"; keyInput: string; password: string; label?: string }
  | { type: "vault.select"; id: string }
  | { type: "vault.renameKey"; id: string; label: string }
  | { type: "vault.deleteKey"; id: string; password: string }
  | { type: "vault.reveal"; keyId?: string; password: string }
  | { type: "keys.list" }
  | { type: "state.getLock" }
  | { type: "state.touch" }
  | { type: "settings.get" }
  | { type: "settings.update"; patch: AppSettingsPatch; password?: string }
  | {
      type: "policy.setOrigin";
      origin: string;
      patch: OriginPolicyPatch;
      password?: string;
    }
  | {
      type: "policy.setKindRule";
      origin: string;
      kind: number;
      mode: string;
      password?: string;
    }
  | { type: "policy.clearSession"; origin: string }
  // Read-only. The session-grant switch was write-only: it set a grant and
  // then rendered a stale `sessionGrantAll` display flag from settings, so a
  // user could not see whether a live grant existed or when it expired.
  | { type: "policy.getSessionGrants" }
  | {
      type: "policy.setSession";
      origin: string;
      enabled: boolean;
      password?: string;
    }
  | { type: "policy.removeOrigin"; origin: string }
  | { type: "crypto.evaluatePassword"; password: string; label?: string }
  | { type: "crypto.parsePrivateKey"; keyInput: string }
  // NIP-07 Nostr operations
  | { type: "nostr.getPublicKey"; origin: string; clientRequestId?: string }
  | {
      type: "nostr.signEvent";
      event: UnsignedEvent;
      origin: string;
      /** Page-side correlation id, so an abandoned request can be cancelled. */
      clientRequestId?: string;
    }
  /**
   * Withdraw a request the page has given up on. Resolves it as DENIED and
   * never as approved - there is no page-reachable path to an approval.
   */
  | {
      type: "nostr.cancelRequest";
      origin: string;
      clientRequestId: string;
    }
  // Approval queue operations
  | { type: "approval.getNext" }
  | { type: "approval.getAll" }
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

/**
 * What `state.getLock` reports.
 *
 * `lockAt` is the absolute epoch-ms inactivity deadline, present only while the
 * vault is unlocked. It is optional rather than nullable so a caller that
 * forgot to check `isLocked` cannot read a stale value as a live deadline.
 */
export type LockStatePayload = {
  isLocked: boolean;
  selectedKeyId?: string;
  lockAt?: number;
};

// NIP-07 specific response types
export type NostrGetPublicKeyResponse =
  | { ok: true; data: { pubkey: string } }
  | { ok: false; error: RpcErrorObject };

export type NostrSignEventResponse =
  | { ok: true; data: { event: SignedEvent } }
  | { ok: false; error: RpcErrorObject };

export type ApprovalCountResponse =
  | { ok: true; data: { count: number } }
  | { ok: false; error: RpcErrorObject };

// Activity log response types
export type ActivityGetRecentResponse =
  | { ok: true; data: { entries: ActivityLogEntry[]; total: number } }
  | { ok: false; error: RpcErrorObject };

export type ActivityFilterResponse =
  | { ok: true; data: { entries: ActivityLogEntry[]; total: number } }
  | { ok: false; error: RpcErrorObject };

export type ActivityClearResponse =
  | { ok: true; data: null }
  | { ok: false; error: RpcErrorObject };

export type RpcResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: RpcErrorObject };

export type BgEvent = { __event: string };

export type RpcHandler = (req: RpcRequest) => Promise<RpcResponse>;
