import { test, expect } from "./fixtures/extension";
import {
  DAPP_ORIGIN,
  grantKindAllow,
  openDapp,
  resolveNextApproval,
  seedUnlockedVault,
  sendExtensionRpc,
  waitForApprovalPage,
} from "./fixtures/agent";

/**
 * A remembered allow rule signs silently, but not without limit: 60 requests
 * per origin per rolling minute. The 61st is not refused. It opens the approval
 * window exactly as a request from an unremembered site would, with a line
 * saying why.
 */

type Outcome = { ok: true; sig: string } | { ok: false; error: string };

test.describe("auto-sign budget", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("signs 60 requests silently, then asks about the 61st", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    await grantKindAllow(popup, DAPP_ORIGIN, 7);
    const dapp = await openDapp(extensionContext);

    // One page-side loop, so the 60 requests land inside one window rather than
    // being spread by the harness.
    const silent = await dapp.evaluate(async () => {
      const results: Array<{ ok: boolean }> = [];
      for (let i = 0; i < 60; i++) {
        try {
          await window.testSignEvent({
            kind: 7,
            content: "+",
            tags: [],
            created_at: Math.floor(Date.now() / 1000) + i,
          });
          results.push({ ok: true });
        } catch {
          results.push({ ok: false });
        }
      }
      return results;
    });
    expect(silent.filter((r) => r.ok)).toHaveLength(60);
    const queued = await sendExtensionRpc<{ requests: unknown[] }>(popup, {
      type: "approval.getAll",
    });
    expect(queued.requests, "a request inside the budget raised a prompt").toHaveLength(0);

    await dapp.evaluate(() => {
      const w = window as unknown as { __outcome?: Promise<unknown> };
      w.__outcome = window
        .testSignEvent({
          kind: 7,
          content: "the sixty-first",
          tags: [],
          created_at: Math.floor(Date.now() / 1000) + 61,
        })
        .then((value: { sig: string }) => ({ ok: true, sig: value.sig }))
        .catch((error: unknown) => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }));
    });

    const approval = await waitForApprovalPage(extensionContext, extensionId);
    await approval.getByTestId("approval-request-item").first().click();
    await expect(approval.getByTestId("auto-sign-budget-notice")).toBeVisible();
    await expect(approval.getByTestId("auto-sign-budget-notice")).toContainText(
      "automatic-signing limit"
    );

    await resolveNextApproval(popup, "allow_once");
    const outcome = (await dapp.evaluate(
      () => (window as unknown as { __outcome: Promise<Outcome> }).__outcome
    )) as Outcome;
    expect(outcome.ok, "approving the over-budget request signs it").toBe(true);
  });
});
