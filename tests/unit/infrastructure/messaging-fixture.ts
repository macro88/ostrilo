/**
 * A ServiceContext built from the real application services over in-memory
 * storage, for exercising RPC handlers end to end. Only the relay (network)
 * and the idle query (browser.idle) are stand-ins, because they are the
 * boundaries a Node test cannot cross.
 */
import type { StorageSuite } from "@/application/ports/storage";
import type { INostrRelay, NostrEvent, NostrFilter } from "@/application/ports/relay";
import { ActivityLogService } from "@/application/services/activity-log.service";
import { DisclosureRateLimitService } from "@/application/services/disclosure-rate-limit.service";
import { PolicyService } from "@/application/services/policy.service";
import { ProfileService } from "@/application/services/profile.service";
import { SettingsService } from "@/application/services/settings.service";
import { UnlockThrottleService } from "@/application/services/unlock-throttle.service";
import { UserPresenceService } from "@/application/services/user-presence.service";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import type { RpcResponse } from "@/infrastructure/messaging/rpc";
import { memoryStorage, testVault } from "../../helpers/vault";

/** Passes the new-vault password policy: long, no product terms, no patterns. */
export const STRONG_PASSWORD = "Umbral-Pinecone-Drizzle-47";

/** 32-byte secret keys whose public keys are well known. */
export const SECRET_ONE =
  "0000000000000000000000000000000000000000000000000000000000000001";
export const PUBKEY_ONE =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
export const SECRET_TWO =
  "0000000000000000000000000000000000000000000000000000000000000002";

export class MemoryRelay implements INostrRelay {
  readonly published: NostrEvent[] = [];
  failPublish = false;
  private nextSub = 0;

  async subscribe(
    filter: NostrFilter,
    onEvent: (event: NostrEvent) => void,
    onEOSE?: () => void
  ): Promise<string> {
    for (const event of this.published) {
      const authorOk = !filter.authors || filter.authors.includes(event.pubkey);
      const kindOk = !filter.kinds || filter.kinds.includes(event.kind);
      if (authorOk && kindOk) onEvent(event);
    }
    onEOSE?.();
    this.nextSub += 1;
    return `sub-${this.nextSub}`;
  }

  async publish(event: NostrEvent): Promise<void> {
    if (this.failPublish) throw new Error("relay rejected");
    this.published.push(event);
  }

  async close(): Promise<void> {}

  async disconnect(): Promise<void> {}
}

export function realContext(storage: StorageSuite = memoryStorage()) {
  const { vault } = testVault(storage);
  const settings = new SettingsService(storage);
  const policy = new PolicyService(storage);
  const activityLog = new ActivityLogService(storage.local);
  const relay = new MemoryRelay();
  const profile = new ProfileService(storage, relay, vault);
  const unlockThrottle = new UnlockThrottleService(storage.local);
  const disclosureRateLimit = new DisclosureRateLimitService();
  const presence = new UserPresenceService(settings, async () => "active");
  const context: ServiceContext = {
    vault,
    policy,
    settings,
    activityLog,
    profile,
    unlockThrottle,
    disclosureRateLimit,
    presence,
  };
  return { context, storage, vault, relay, activityLog, policy, settings };
}

/** The error code of a refused response; fails the test on success. */
export function errorCodeOf(res: RpcResponse): string {
  if (res.ok) throw new Error(`expected a refusal, got ${JSON.stringify(res.data)}`);
  return res.error.data.errorCode;
}

/** The data of a successful response; fails the test on refusal. */
export function dataOf<T>(res: RpcResponse): T {
  if (!res.ok) throw new Error(`expected success, got ${res.error.data.errorCode}`);
  return res.data as T;
}
