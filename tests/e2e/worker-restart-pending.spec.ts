import { test, expect } from "./fixtures/extension";
import { seedUnlockedVault, openDapp, waitForApprovalPage } from "./fixtures/agent";

/**
 * A request waiting for approval when the browser ends the background.
 *
 * The queue entry, its resolver and the page's open message port all live in
 * the worker, so none of them survives. What the page is owed is an answer in
 * the extension's own vocabulary, promptly: not a hang until its 65 second
 * backstop, and not the browser's internal wording for a closed port.
 *
 * The restarted worker comes up locked, because the decrypted keys died with
 * the old one. A retry therefore reports `locked`, which is the state the user
 * has to act on.
 */

type SignOutcome = { ok: true; sig: string } | { ok: false; error: string };

test.describe("approval pending when the background is ended", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("the page gets a canonical error promptly, and a retry reports the vault locked", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    const dapp = await openDapp(extensionContext);

    await dapp.evaluate(() => {
      const w = window as unknown as { __outcome?: Promise<unknown> };
      w.__outcome = window
        .testSignEvent({
          kind: 7,
          content: "pending when the worker ends",
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
        })
        .then((value: { sig: string }) => ({ ok: true, sig: value.sig }))
        .catch((error: unknown) => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }));
    });
    await waitForApprovalPage(extensionContext, extensionId);

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

    // Well inside the provider's 65 second backstop: this is the content
    // script answering, not the page giving up.
    const outcome = (await dapp.evaluate(
      () => (window as unknown as { __outcome: Promise<SignOutcome> }).__outcome
    )) as SignOutcome;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBe("approval_failed");

    const retry = (await dapp.evaluate(() =>
      window
        .testSignEvent({
          kind: 7,
          content: "after the restart",
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
        })
        .then((value: { sig: string }) => ({ ok: true, sig: value.sig }))
        .catch((error: unknown) => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }))
    )) as SignOutcome;
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.error).toBe("locked");
  });
});
