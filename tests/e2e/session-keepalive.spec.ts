import { test, expect } from "./fixtures/extension";
import type { BrowserContext, Page } from "@playwright/test";
import { sendExtensionRpc, TEST_PASSWORD } from "./fixtures/agent";

type Worker = ReturnType<BrowserContext["serviceWorkers"]>[number];

/**
 * A 35 minute auto-lock has to survive every extension page closing.
 *
 * Chrome ends an idle MV3 service worker about 30 seconds after its last event
 * or extension API call. The vault keeps decrypted keys in that worker's memory
 * only, so an ended worker used to lock the vault whatever the auto-lock
 * setting said. While unlocked, the background now calls
 * `chrome.runtime.getPlatformInfo()` about every 20 seconds to reset that timer.
 *
 * What this harness can and cannot see. Playwright attaches DevTools to the
 * extension's service worker, and Chrome does not end a worker that has
 * DevTools attached. So the idle timer is never the thing that fails here: a
 * build without the keepalive passes a bare "wait, then check it is still
 * unlocked" test. These tests therefore watch the keepalive itself - they count
 * the calls the worker makes - and assert the state afterwards as well. The
 * browser's real idle termination is exercised only by the manual check in the
 * change's tasks.md. Termination is simulated, deterministically, by stopping
 * the worker over CDP.
 */

/** Longer than Chrome's idle window, and than two keepalive intervals. */
const IDLE_WAIT_MS = 50_000;

type LockPayload = { isLocked: boolean; lockReason?: string };

async function lockState(page: Page): Promise<LockPayload> {
  return sendExtensionRpc<LockPayload>(page, { type: "state.getLock" });
}

/**
 * Unlocks and sets 35 minutes. `afterUnlock` runs between the two: changing a
 * setting makes the background re-check at once, which pings, so anything
 * counting pings has to be installed before that happens.
 */
async function unlockWithThirtyFiveMinutes(
  page: Page,
  afterUnlock?: () => Promise<void>
) {
  await sendExtensionRpc(page, {
    type: "vault.generate",
    password: TEST_PASSWORD,
    label: "Keepalive Key",
  });
  await sendExtensionRpc(page, { type: "vault.unlock", password: TEST_PASSWORD });
  await afterUnlock?.();
  await sendExtensionRpc(page, {
    type: "settings.update",
    patch: { autoLockMinutes: 35, relays: ["wss://localhost:1"] },
    password: TEST_PASSWORD,
  });
  expect((await lockState(page)).isLocked).toBe(false);
}

/** Counts the keepalive's API calls from inside the worker. Resets the count. */
async function countKeepAlivePings(context: BrowserContext, extensionId: string) {
  const worker = context
    .serviceWorkers()
    .find((w: Worker) => w.url().startsWith(`chrome-extension://${extensionId}/`));
  if (!worker) throw new Error("the extension's service worker is not running");

  await worker.evaluate(() => {
    const g = globalThis as unknown as {
      __pings?: number;
      chrome: { runtime: { getPlatformInfo: (...args: unknown[]) => unknown } };
    };
    g.__pings = 0;
    const original = g.chrome.runtime.getPlatformInfo.bind(g.chrome.runtime);
    g.chrome.runtime.getPlatformInfo = (...args: unknown[]) => {
      g.__pings = (g.__pings ?? 0) + 1;
      return original(...args);
    };
  });

  return () =>
    worker.evaluate(() => (globalThis as unknown as { __pings?: number }).__pings ?? 0);
}

test.describe("session keepalive", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("keeps calling the extension API, and stays unlocked, with every extension page closed", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    test.slow();
    test.setTimeout(180_000);

    const popup = await openPopup();
    let pings: () => Promise<number> = async () => 0;
    await unlockWithThirtyFiveMinutes(popup, async () => {
      pings = await countKeepAlivePings(extensionContext, extensionId);
    });
    await popup.close();
    // Whatever the settings change pinged has landed; count from here.
    const before = await pings();

    // Nothing extension-owned is open, so nothing is messaging the worker.
    const blank = await extensionContext.newPage();
    await blank.goto("about:blank");
    await blank.waitForTimeout(IDLE_WAIT_MS);

    expect(
      (await pings()) - before,
      "the background made no keepalive calls while the vault was unlocked"
    ).toBeGreaterThanOrEqual(2);

    const reopened = await openPopup();
    expect(
      await lockState(reopened),
      "the vault locked while idle although the auto-lock deadline is 35 minutes away"
    ).toMatchObject({ isLocked: false });
  });

  test("a manual lock stops the keepalive, and the lock screen says who locked it", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    test.slow();
    test.setTimeout(180_000);

    const popup = await openPopup();
    let pings: () => Promise<number> = async () => 0;
    await unlockWithThirtyFiveMinutes(popup, async () => {
      pings = await countKeepAlivePings(extensionContext, extensionId);
    });
    await sendExtensionRpc(popup, { type: "vault.lock" });
    // A ping that was already under way when the lock landed is not a ping
    // after it; count what arrives once the lock has returned.
    const afterLock = await pings();
    await popup.close();

    const blank = await extensionContext.newPage();
    await blank.goto("about:blank");
    await blank.waitForTimeout(IDLE_WAIT_MS);

    expect(
      (await pings()) - afterLock,
      "the keepalive kept calling the extension API after the vault was locked"
    ).toBe(0);

    const reopened = await openPopup();
    expect(await lockState(reopened)).toMatchObject({
      isLocked: true,
      lockReason: "manual",
    });
    await expect(reopened.getByTestId("lock-reason")).toHaveText(
      "You locked Ostrilo."
    );
  });

  test("fails closed, and says why, when the browser ends the background anyway", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await unlockWithThirtyFiveMinutes(popup);

    // `ServiceWorker.stopWorker` is what Chrome does at the end of the idle
    // window, without the 30 second wait.
    const cdp = await extensionContext.newCDPSession(popup);
    const versions = new Map<string, { versionId: string; scriptURL: string }>();
    cdp.on("ServiceWorker.workerVersionUpdated", (event) => {
      for (const v of event.versions) versions.set(v.versionId, v);
    });
    await cdp.send("ServiceWorker.enable");
    const own = () =>
      [...versions.values()].find((v) => v.scriptURL.includes(extensionId));
    await expect.poll(own).toBeTruthy();
    await cdp.send("ServiceWorker.stopWorker", { versionId: own()!.versionId });

    const state = await lockState(popup);
    expect(state).toMatchObject({
      isLocked: true,
      lockReason: "background_restarted",
    });

    await popup.reload();
    await expect(popup.getByTestId("lock-reason")).toHaveText(
      "Locked because the browser restarted Ostrilo's background."
    );
  });
});
