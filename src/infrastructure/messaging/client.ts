import { browser } from "wxt/browser";
import type { PasswordVerdict } from "@/domain/utils/password-policy";
import type {
  RpcRequest,
  RpcResponse,
  RpcErrorObject,
  LockStatePayload,
} from "./rpc";
import type {
  AppSettingsPatch,
  OriginPolicyPatch,
} from "@/infrastructure/validation/schemas";
import { BROADCAST_EVENTS } from "@/infrastructure/messaging/events";
// webextension-polyfill already imported above

export class RpcClientError extends Error {
  readonly method: string;
  readonly rpcError: RpcErrorObject;
  readonly errorCode: string;

  constructor(method: string, rpcError: RpcErrorObject) {
    super(`rpc:${method}:${rpcError.data.errorCode}`);
    this.name = "RpcClientError";
    this.method = method;
    this.rpcError = rpcError;
    this.errorCode = rpcError.data.errorCode;
  }
}

function isRpcErrorObject(error: unknown): error is RpcErrorObject {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "number" &&
    typeof (error as { message?: unknown }).message === "string" &&
    typeof (error as { data?: { errorCode?: unknown } }).data?.errorCode ===
      "string"
  );
}

/**
 * Narrows a value that crossed the extension message boundary to `RpcResponse`.
 *
 * `browser.runtime.sendMessage` is typed as returning `any`, so asserting its
 * result straight into `RpcResponse` claimed a shape nothing had checked. This
 * is that check. It is deliberately strict about the discriminant: `ok: true`
 * carries the data, `ok: false` must carry a well-formed error object, and
 * anything else is not an `RpcResponse` - which leaves the legacy string-error
 * path below reachable, exactly as before.
 */
function isRpcResponse(value: unknown): value is RpcResponse {
  if (typeof value !== "object" || value === null) return false;
  const ok = (value as { ok?: unknown }).ok;
  if (ok === true) return true;
  if (ok === false) return isRpcErrorObject((value as { error?: unknown }).error);
  return false;
}

/**
 * The status word the diagnostic below logs. Never the response body - see the
 * incident recorded at the call site.
 */
function responseStatus(res: unknown): unknown {
  if (typeof res === "object" && res !== null && "ok" in res) {
    const r = res as {
      ok?: unknown;
      error?: { data?: { errorCode?: unknown } };
    };
    return r.ok ? "ok" : r.error?.data?.errorCode;
  }
  return "malformed";
}

export async function rpc<T = unknown>(req: RpcRequest): Promise<T> {
  const method = req.type;
  console.log("[CLIENT] Sending RPC:", method);

  const attempt = async (): Promise<T> => {
    try {
      const res: unknown = await browser.runtime.sendMessage(req);

      // Status only, NEVER the response body.
      //
      // This line used to log `res` in full. The responses that pass through
      // here include vault.reveal -> {nsec, hex} and, before it was changed,
      // crypto.parsePrivateKey -> the raw 32-byte secret scalar. So revealing a
      // key for backup wrote it in cleartext into the extension page's console,
      // where it stayed in the message buffer for the life of the document -
      // defeating the care taken elsewhere to hold the key in a ref and null it.
      // The background side already logged method and status only; this is the
      // client matching it.
      // aislop-ignore-next-line ai-slop/console-leftover -- deliberate diagnostic, narrowed to method and status by the incident recorded above; not a leftover.
      console.log(
        "[CLIENT] Received response for",
        method,
        ":",
        responseStatus(res)
      );

      // More detailed error diagnostics
      if (!res) {
        throw new Error(`rpc:${method}:no_response`);
      }

      if (typeof res !== "object") {
        throw new Error(`rpc:${method}:invalid_response_type`);
      }

      if (isRpcResponse(res)) {
        if (res.ok) {
          return res.data as T;
        }
        throw new RpcClientError(method, res.error);
      }

      // Not a well-formed RpcResponse. An older background could answer with a
      // bare error string, so that shape is still translated rather than
      // dropped; anything else becomes `unknown_error`.
      const err = "error" in res ? res.error : undefined;
      const legacyError = typeof err === "string" ? err : "unknown_error";
      throw new Error(`rpc:${method}:${legacyError}`);
    } catch (e: any) {
      // Machine error code and method, not the thrown object: a thrown error
      // can carry a payload, and this runs in the page realm.
      // aislop-ignore-next-line ai-slop/console-leftover -- deliberate diagnostic, narrowed to error code and method by the decision recorded above.
      console.log(
        "[CLIENT] RPC error for",
        method,
        ":",
        e instanceof RpcClientError ? e.errorCode : "error"
      );
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

  const retryDelays = [0, 80, 160, 320];
  const runAttempt = async (index: number): Promise<T> => {
    const delay = retryDelays[index];

    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      return await attempt();
    } catch (e: any) {
      const msg = e?.message || String(e);
      // Only retry on connection/warmup issues, not on RPC-level errors
      if (!isWarmup(msg) || index === retryDelays.length - 1) {
        throw e instanceof Error
          ? e
          : new Error(String(e) || `rpc:${method}:transport_failed`);
      }

      return runAttempt(index + 1);
    }
  };

  return runAttempt(0);
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
  return rpc<
    import("@/infrastructure/messaging/handlers/vault-rpc").KeyListEntry[]
  >({ type: "keys.list" });
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

export async function renameKey(id: string, label: string) {
  return rpc<null>({ type: "vault.renameKey", id, label });
}

/**
 * Deletes a key. The password is re-verified in the background.
 *
 * Callers should zeroize their copy of `password` as soon as this
 * resolves; a JS string cannot be wiped, so the practical rule is to drop
 * the reference and never put it in component state that outlives the
 * dialog.
 */
export async function deleteKey(id: string, password: string) {
  return rpc<{ newSelectedKeyId?: string }>({
    type: "vault.deleteKey",
    id,
    password,
  });
}

export async function getLockState() {
  return rpc<LockStatePayload>({
    type: "state.getLock",
  });
}

/** Records genuine user activity so the auto-lock deadline moves. */
export async function touchActivity() {
  return rpc<null>({ type: "state.touch" });
}

/**
 * The window within which repeated interaction collapses to one activity RPC.
 *
 * Chosen against the 1-minute auto-lock floor: worst case the recorded
 * deadline is 30s staler than the interaction, which is inside the slack a
 * 1-minute timeout already tolerates. The alternative - an RPC per
 * interaction from every open surface - trades bounded staleness for
 * unbounded wake-ups of the worker that enforces the lock.
 */
const ACTIVITY_THROTTLE_MS = 30_000;

/** Per-surface, because each extension page loads its own copy of this module. */
let lastActivityReportAt = 0;

/**
 * Reports deliberate user action, at most once per throttle window.
 *
 * Call this from the action itself - unlock, key selection, approval
 * resolution, a settings change - never from polling, broadcast handling or
 * countdown rendering, which are not the user doing anything. Fire-and-forget:
 * no caller's flow should wait on, or fail from, activity bookkeeping.
 */
export function reportActivity(): void {
  const now = Date.now();
  if (now - lastActivityReportAt < ACTIVITY_THROTTLE_MS) return;
  lastActivityReportAt = now;
  void touchActivity().catch(() => {
    // Reopen the window so the next deliberate action retries rather than
    // waiting out a throttle spent on a report that never landed.
    lastActivityReportAt = 0;
  });
}



export async function revealKey(password: string, keyId?: string) {
  return rpc<{ nsec: string; hex: string }>({
    type: "vault.reveal",
    password,
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

/** `password` is required only when the patch changes a security timeout. */
export async function updateSettings(
  patch: AppSettingsPatch,
  password?: string
) {
  const result = await rpc<import("@/domain/types").AppSettingsV1>({
    type: "settings.update",
    patch,
    password,
  });

  // Invalidate cache after update
  settingsCache = null;

  return result;
}

export function subscribeSettingsChanged(cb: () => void) {
  const handler = (msg: unknown) => {
    if (
      typeof msg === "object" &&
      msg !== null &&
      "__event" in msg &&
      (msg as { __event?: unknown }).__event ===
        BROADCAST_EVENTS.SETTINGS_CHANGED
    ) {
      // Invalidate cache when settings change externally
      settingsCache = null;
      cb();
    }
  };
  browser.runtime.onMessage.addListener(handler);
  return () => browser.runtime.onMessage.removeListener(handler);
}

/**
 * `password` is required only when the patch raises trust to `high` or sets
 * `identityDisclosure` to `allow`. Per-kind rules go through
 * `policySetKindRule`, and session grants through `policySetSession`.
 */
export async function policySetOrigin(
  origin: string,
  patch: OriginPolicyPatch,
  password?: string
) {
  return rpc<null>({ type: "policy.setOrigin", origin, patch, password });
}

export async function policySetKindRule(
  origin: string,
  kind: number,
  mode: "allow" | "deny" | "ask",
  password?: string
) {
  return rpc<null>({
    type: "policy.setKindRule",
    origin,
    kind,
    mode,
    password,
  });
}

/** Live session grants: origin and absolute expiry, active ones only. */
export async function policyGetSessionGrants() {
  return rpc<Array<{ origin: string; expiresAt: number }>>({
    type: "policy.getSessionGrants",
  });
}

export async function policyClearSession(origin: string) {
  return rpc<null>({ type: "policy.clearSession", origin });
}

export async function policySetSession(
  origin: string,
  enabled: boolean,
  password?: string
) {
  return rpc<null>({ type: "policy.setSession", origin, enabled, password });
}

export async function policyRemoveOrigin(origin: string) {
  return rpc<null>({ type: "policy.removeOrigin", origin });
}

/**
 * Authoritative password verdict from the background, which holds the
 * blocklist. Gate on `acceptable`, never on `score` - `score` is for display
 * and is deliberately re-anchored so a policy-violating password cannot show
 * as strong.
 */
export async function evaluatePasswordStrength(
  password: string,
  label?: string
) {
  return rpc<PasswordVerdict>({
    type: "crypto.evaluatePassword",
    password,
    label,
  });
}

/**
 * Validates a private key WITHOUT the bytes ever crossing the message bus.
 * Resolves `{ valid: true }` or rejects with `invalid_key_input`.
 */
export async function parsePrivateKey(keyInput: string) {
  return rpc<{ valid: true }>({
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

export async function getAllApprovalRequests() {
  return rpc<{ requests: import("@/domain/types").PendingRequest[] }>({
    type: "approval.getAll",
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

// Activity log operations
export async function activityGetRecent(options?: {
  limit?: number;
  offset?: number;
}) {
  return rpc<{
    entries: import("@/domain/types").ActivityLogEntry[];
    total: number;
  }>({
    type: "activity.getRecent",
    limit: options?.limit,
    offset: options?.offset,
  });
}

export async function activityFilterBy(filters: {
  origin?: string;
  kind?: number;
  limit?: number;
  offset?: number;
}) {
  return rpc<{
    entries: import("@/domain/types").ActivityLogEntry[];
    total: number;
  }>({
    type: "activity.filterBy",
    origin: filters.origin,
    kind: filters.kind,
    limit: filters.limit,
    offset: filters.offset,
  });
}

export async function activityClear() {
  return rpc<null>({ type: "activity.clear" });
}
