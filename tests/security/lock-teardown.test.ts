import { describe, expect, it } from "vitest";
import { ApprovalQueueService } from "@/application/services/approval-queue.service";
import type { AppSettingsV1 } from "@/domain/types";
import { defaultSettings } from "@/application/services/settings.service";
import { memoryStorage, testVault } from "../helpers/vault";

/**
 * `lock()` wrote the `sessionGrantAll` display flags to settings storage and
 * only then ran its listeners. A settings write that threw - quota, storage
 * disabled, a corrupt record - skipped them, and one of them is what denies
 * the pending approvals. A request the user walked away from could survive the
 * lock and be approved after the next unlock.
 *
 * Wired here as `background.ts` wires it: the real approval queue, cleared by
 * a lock listener that also clears the badge.
 */

const PASSWORD = "Harbour-Lantern-Quill-58";
const SECRET = "0000000000000000000000000000000000000000000000000000000000000003";

describe("lock teardown does not depend on settings storage", () => {
  it("denies pending approvals, clears the badge and reports locked when the settings write throws", async () => {
    const storage = memoryStorage();
    const { vault } = testVault(storage);
    await vault.importKey(SECRET, PASSWORD);
    await vault.unlock(PASSWORD);
    await storage.session.set("sessionGrants", { "https://site.example": { expiresAt: 1 } });
    // An origin record, so lock() has display flags to write.
    await storage.local.set<AppSettingsV1>("appSettings", {
      ...defaultSettings(),
      origins: [
        {
          origin: "https://site.example",
          trustLevel: "medium",
          rules: {},
          sessionGrantAll: true,
          updatedAt: 1,
        },
      ],
    } as AppSettingsV1);

    const queue = new ApprovalQueueService();
    const decisions: string[] = [];
    queue.enqueue(
      "https://site.example",
      { kind: 1, content: "walked away from", tags: [], created_at: 1, pubkey: "" } as never,
      (decision) => decisions.push(decision)
    );
    let badgeCleared = false;
    vault.onLock(() => {
      queue.clear();
      badgeCleared = true;
    });

    storage.local.set = async () => {
      throw new Error("QUOTA_BYTES quota exceeded");
    };

    await expect(
      vault.lock(),
      "the settings failure must reach the caller, not be swallowed"
    ).rejects.toThrow("quota exceeded");

    expect(decisions, "SECURITY REGRESSION: a pending approval survived the lock").toEqual([
      "deny",
    ]);
    expect(queue.count()).toBe(0);
    expect(badgeCleared).toBe(true);
    expect((await vault.getLockState()).isLocked).toBe(true);
    expect(await storage.session.get("sessionGrants")).toBeUndefined();
    await expect(vault.sign("ab".repeat(32))).rejects.toThrow();
  });
});
