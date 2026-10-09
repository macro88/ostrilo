import { browser } from "wxt/browser";
import type { RpcRequest, RpcResponse } from "./rpc";
import { RPC_ERROR_CODES, createRpcErrorResponse } from "./error-codes";
import { attestPageOrigin, isTrustedExtensionSender } from "./sender-trust";
import type { KeyVaultService } from "@/application/services/key-vault.service";
import type { PolicyService } from "@/application/services/policy.service";
import type { SettingsService } from "@/application/services/settings.service";
import type { ActivityLogService } from "@/application/services/activity-log.service";
import type { ProfileService } from "@/application/services/profile.service";
import type { UnlockThrottleService } from "@/application/services/unlock-throttle.service";
import type { DisclosureRateLimitService } from "@/application/services/disclosure-rate-limit.service";
import type { AutoSignBudgetService } from "@/application/services/auto-sign-budget.service";
import type { UserPresenceService } from "@/application/services/user-presence.service";

/**
 * Service context passed to RPC handlers containing all application services
 */
export interface ServiceContext {
  vault: KeyVaultService;
  policy: PolicyService;
  settings: SettingsService;
  activityLog: ActivityLogService;
  profile: ProfileService;
  unlockThrottle: UnlockThrottleService;
  disclosureRateLimit: DisclosureRateLimitService;
  /**
   * Meters requests that site policy signs without a prompt. Required rather
   * than optional: a context built without it would sign unmetered.
   */
  autoSignBudget: AutoSignBudgetService;
  /**
   * Answers whether a user is at the machine, for the one path that needs it:
   * a signature produced without an approval prompt, asking to postpone the
   * auto-lock deadline. Nothing else consults it - a click in an extension
   * surface is already presence and needs no second opinion.
   */
  presence: UserPresenceService;
  /**
   * Called when a request from a WEB PAGE is refused because the vault is
   * locked, so the background can raise a toolbar marker.
   *
   * This is the replacement for the page-triggered unlock popup that used to
   * live in the content script: the user learns a site wanted something, on
   * their own toolbar, at a moment of their choosing. The page cannot drive
   * it beyond causing the marker to appear once.
   */
  onLockedPageRequest?: (method: string) => void;
}

/**
 * Base interface that all RPC modules must implement
 */
export interface RpcModule {
  /**
   * Handle an RPC request for this module
   * @param message - The RPC request message
   * @param context - Service context with all application services
   * @returns Promise resolving to RPC response
   */
  handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse>;
}

/**
 * RPC router that delegates requests to appropriate modules based on namespace
 */
export {
  attestPageOrigin,
  isTrustedExtensionSender,
  type PageOriginAttestation,
} from "./sender-trust";

/**
 * Namespaces a WEB PAGE may reach, via the content script.
 *
 * Everything else is UI-only: reachable from the extension's own pages
 * (popup, sidepanel, options, approval window) and from nowhere else.
 *
 * This is defence in depth. The content script already builds its own request
 * objects and forwards exactly two methods, so a page cannot name an arbitrary
 * RPC type today. But that allowlist lives in a different file from the thing
 * it protects, and anyone adding a third forwarded method would inherit the
 * entire privileged surface - including the vault. The check belongs next to
 * the dispatch as well.
 */
const PAGE_REACHABLE_NAMESPACES: ReadonlySet<string> = new Set(["nostr"]);

/**
 * RPC methods that must remain reachable while the vault is LOCKED.
 *
 * Everything else that mutates state or touches keys is refused with `locked`.
 * The rule is deliberately an allowlist: a new method is lock-gated by default,
 * so forgetting to think about it fails safe.
 *
 * `keys.list` stays reachable because the UI decides between the onboarding
 * flow and the lock screen by asking whether any key exists; gating it would
 * show a locked user the onboarding flow instead of the unlock prompt.
 */
const LOCKED_REACHABLE_METHODS: ReadonlySet<string> = new Set([
  "vault.unlock",
  "vault.lock",
  "state.getLock",
  "state.touch",
  "keys.list",
  "crypto.evaluatePassword",
  "crypto.parsePrivateKey",
  // Creating or importing the FIRST key happens before there is a vault to
  // unlock, and both verify the password themselves.
  "vault.generate",
  "vault.import",
  // Reveal re-verifies the password itself, which is a stronger check.
  "vault.reveal",
  "settings.get",
]);

/**
 * What a locked-reachable method is allowed to DISCLOSE while locked.
 *
 * Reachable is not the same as unredacted. The lock screen needs to know
 * whether any key exists, so that a fresh install shows onboarding rather
 * than a password prompt - it does not need the labels or the public keys,
 * and handing those to a locked UI hands them to anyone holding the device.
 *
 * Applied in the listener, after the handler runs, so a handler cannot
 * forget it.
 */
const LOCKED_PROJECTIONS: ReadonlyMap<string, (data: unknown) => unknown> =
  new Map([
    [
      "keys.list",
      (data: unknown) =>
        Array.isArray(data)
          ? data.map((k) => ({ id: (k as { id?: string })?.id }))
          : data,
    ],
    [
      // The service already omits `lockAt` on every locked path. This is the
      // second line: the projection reduces a locked response to the fields
      // the lock screen renders from, so a future field added to the unlocked
      // response cannot reach a locked UI by being forgotten here. The lock
      // reason and the timeout that elapsed are labels, not secrets.
      "state.getLock",
      (data: unknown) => {
        if (!data || typeof data !== "object") return data;
        const s = data as Record<string, unknown>;
        return {
          isLocked: s.isLocked,
          selectedKeyId: s.selectedKeyId,
          lockReason: s.lockReason,
          inactivityMinutes: s.inactivityMinutes,
        };
      },
    ],
    [
      "settings.get",
      (data: unknown) => {
        if (!data || typeof data !== "object") return data;
        const s = data as Record<string, unknown>;
        // Shape preserved so the UI does not have to special-case a locked
        // read; the fields that identify the user are emptied, not omitted.
        return {
          __version: s.__version,
          theme: s.theme,
          sidePanel: s.sidePanel,
          onboardingCompleted: s.onboardingCompleted,
          onboardingCompletedAt: s.onboardingCompletedAt,
          autoLockMinutes: s.autoLockMinutes,
          sessionTTLMinutes: s.sessionTTLMinutes,
          maxActivityEntries: s.maxActivityEntries,
          relays: [],
          origins: [],
          mediumAllowKinds: [],
          selectedKeyId: undefined,
        };
      },
    ],
  ]);

/** The redaction applied to this method while the vault is locked, if any. */
export function lockedProjectionFor(
  method: string
): ((data: unknown) => unknown) | undefined {
  return LOCKED_PROJECTIONS.get(method);
}

/** True when this method may run against a locked vault. */
export function isLockedReachable(method: string): boolean {
  return LOCKED_REACHABLE_METHODS.has(method);
}

/** Resolves the namespace of an RPC message type, or undefined. */
export function namespaceOf(messageType: unknown): string | undefined {
  if (typeof messageType !== "string") return undefined;
  const ns = messageType.split(".")[0];
  return ns ? ns : undefined;
}

/**
 * RPC router that delegates requests to appropriate modules based on namespace
 */
export class RpcRouter {
  // A Map, not an object literal: an object literal resolves inherited keys, so
  // a message type of "__proto__.x" or "constructor.x" found a truthy value on
  // Object.prototype and passed the existence check before failing later.
  private modules: Map<string, RpcModule> = new Map();

  /** True when a web page may reach this namespace through the content script. */
  static isPageReachable(namespace: string): boolean {
    return PAGE_REACHABLE_NAMESPACES.has(namespace);
  }

  /**
   * Register an RPC module for a specific namespace
   * @param namespace - The namespace prefix (e.g., "vault", "policy")
   * @param module - The RPC module to handle requests for this namespace
   */
  registerModule(namespace: string, module: RpcModule): void {
    this.modules.set(namespace, module);
  }

  /**
   * Handle an incoming RPC request by routing to the appropriate module
   * @param message - The RPC request message
   * @param context - Service context with all application services
   * @returns Promise resolving to RPC response
   */
  async handleRequest(
    message: RpcRequest,
    context: ServiceContext
  ): Promise<RpcResponse> {
    try {
      // Extract namespace from message type (e.g., "vault.unlock" -> "vault")
      const [namespace] = message.type.split(".");

      if (!namespace) {
        return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_REQUEST);
      }

      const module = this.modules.get(namespace);
      if (!module) {
        return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_NAMESPACE, {
          details: namespace,
          method: message.type,
        });
      }

      return await module.handleRequest(message, context);
    } catch (error: unknown) {
      // Log internally, but do NOT put raw error text on the wire: thrown
      // messages can carry internal paths and state, and this response travels
      // back toward the caller.
      console.error("[RPC Router] Error handling request:", error);
      return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
        details: "Request could not be handled",
        method: message.type,
      });
    }
  }

  /**
   * Get list of registered namespaces
   */
  getRegisteredNamespaces(): string[] {
    return [...this.modules.keys()];
  }
}

/**
 * Create a browser runtime message listener that uses the RPC router
 * @param router - The RPC router instance
 * @param context - Service context with all application services
 * @returns Message listener function compatible with browser.runtime.onMessage
 */
export function createRpcMessageListener(
  router: RpcRouter,
  context: ServiceContext
) {
  // Captured once. browser.runtime.getURL("/") yields the extension origin,
  // e.g. chrome-extension://<id>/ or moz-extension://<uuid>/.
  const runtimeId = browser.runtime.id;
  const extensionOrigin = browser.runtime.getURL("/");

  return (
    message: any,
    sender: any,
    sendResponse: (response: RpcResponse) => void
  ) => {
    console.log("[RPC] Received message:", message?.type || "unknown");

    // Validate message format
    if (!message || typeof message !== "object" || !("type" in message)) {
      console.log("[RPC] Invalid request format");
      sendResponse(createRpcErrorResponse(RPC_ERROR_CODES.INVALID_REQUEST));
      return false;
    }

    // Privilege boundary, enforced BEFORE any handler or service is touched.
    //
    // Only the `nostr` namespace is reachable from a web page. Everything else
    // - vault, policy, settings, crypto, keys, approval, activity, profile -
    // requires a sender that is one of the extension's own pages.
    const namespace = namespaceOf(message.type);
    if (!namespace) {
      sendResponse(createRpcErrorResponse(RPC_ERROR_CODES.INVALID_REQUEST));
      return false;
    }
    if (!RpcRouter.isPageReachable(namespace)) {
      if (!isTrustedExtensionSender(sender, runtimeId, extensionOrigin)) {
        // Deliberately the same response an unknown namespace gets: a caller
        // that is not allowed here learns nothing about what exists.
        console.log("[RPC] Rejected privileged namespace from untrusted sender");
        sendResponse(
          createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_NAMESPACE, {
            method: message.type,
          })
        );
        return false;
      }
    } else {
      // Before the lock gate, so an unattestable request cannot raise the
      // locked-page marker, and before dispatch, so no handler - and no
      // per-origin rate limit - ever sees an origin the browser did not vouch
      // for.
      const attested = attestPageOrigin(sender, runtimeId, message.origin);
      if (!attested.ok) {
        console.log("[RPC] Refused page request:", attested.reason);
        sendResponse(
          createRpcErrorResponse(RPC_ERROR_CODES.INVALID_ORIGIN, {
            method: message.type,
          })
        );
        return false;
      }
      message.origin = attested.origin;
    }

    const dispatch = async (project?: (data: unknown) => unknown) => {
      try {
        let result = await router.handleRequest(
          message as RpcRequest,
          context
        );
        if (project && result.ok) {
          result = { ...result, data: project(result.data) };
        }
        const status = result.ok ? "success" : result.error.data.errorCode;
        console.log("[RPC] Sending response for", message.type, ":", status);
        sendResponse(result);
      } catch (error: unknown) {
        // Method and status only. The raw error is not put on the wire.
        const errorResult: RpcResponse = createRpcErrorResponse(
          RPC_ERROR_CODES.UNKNOWN_METHOD,
          {
            details: "Request could not be handled",
            method: message.type,
          }
        );
        console.error("[RPC] Error handling", message.type, error);
        sendResponse(errorResult);
      }
    };

    // Lock gate. Applied here so every privileged namespace is covered by one
    // rule rather than each handler remembering to check, and so it is an
    // ALLOWLIST: a new method is lock-gated by default and forgetting to think
    // about it fails safe.
    //
    // The options page had no lock check at all. With the vault locked it
    // exposed every key label and pubkey, every origin policy, the relay list
    // and the activity log, and it permitted mutation - which let brief
    // physical access raise an origin to high trust that then signs silently
    // the next time the user unlocks.
    const gated = !isLockedReachable(message.type);
    const projection = lockedProjectionFor(message.type);
    if (gated || projection) {
      void (async () => {
        const lockState = await context.vault.getLockState();
        if (lockState.isLocked && gated) {
          console.log("[RPC] Refused while locked:", message.type);
          if (RpcRouter.isPageReachable(namespace)) {
            context.onLockedPageRequest?.(message.type);
          }
          sendResponse(
            createRpcErrorResponse(RPC_ERROR_CODES.LOCKED, {
              method: message.type,
            })
          );
          return;
        }
        await dispatch(lockState.isLocked ? projection : undefined);
      })();
      return true;
    }

    void dispatch();

    return true; // Keep message port open for async response
  };
}
