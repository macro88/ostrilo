import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import {
  seedUnlockedVault,
  sendExtensionRpc,
  openDapp,
  waitForApprovalPage,
  DAPP_ORIGIN,
  TEST_PASSWORD,
} from "./fixtures/agent";

/**
 * What the two buttons in the approval detail pane actually do.
 *
 * This file used to contain five tests that asserted nothing. They ran against
 * a vault that was never created, so every `window.nostr.signEvent` call was
 * refused for being locked, and each test asserted only that *something* went
 * wrong — one of them was literally `if (result.success) { …assert… } else {
 * expect(result.error).toBeDefined() }`, which passes either way. Their own
 * comments admitted it: "cannot fully test approval flow without a way to
 * unlock the vault and configure policy programmatically".
 *
 * That excuse expired: `seedUnlockedVault` does exactly that. The tests were
 * worse than absent, because the file was named for the Deny journey and so the
 * suite read as though Deny, Deny + Remember and the timeout were covered.
 *
 * The decisions asserted here are the ones `EventDetailView` maps from a button
 * plus a checkbox to a resolution, and every one of them writes or withholds a
 * standing permission:
 *   approve            -> allow_once
 *   approve + remember -> allow           (but allow_once for a protected kind)
 *   deny               -> deny
 *   deny + remember    -> deny_remember   (persists, protected kind or not)
 */

const REMEMBER_LABEL = "Remember this decision for this site and event kind";
const PROTECTED_REMEMBER_LABEL = "Remember a denial for this site and event kind";

type SignOutcome = { ok: true; sig: string } | { ok: false; error: string };

/** Fires a signing request and leaves it in flight; the promise is read later. */
async function beginSignRequest(
  dapp: Page,
  kind: number,
  content: string
): Promise<void> {
  await dapp.evaluate(
    ({ kind, content }) => {
      const w = window as unknown as {
        __outcome?: Promise<unknown>;
      };
      w.__outcome = window
        .testSignEvent({
          kind,
          content,
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
        })
        .then((value: { sig: string }) => ({ ok: true, sig: value.sig }))
        .catch((error: unknown) => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }));
    },
    { kind, content }
  );
}

async function readSignOutcome(dapp: Page): Promise<SignOutcome> {
  return (await dapp.evaluate(
    () => (window as unknown as { __outcome: Promise<SignOutcome> }).__outcome
  )) as SignOutcome;
}

async function originPolicy(page: Page) {
  const settings = await sendExtensionRpc<{
    origins?: Array<{ origin: string; rules?: Record<string, string> }>;
  }>(page, { type: "settings.get" });
  return settings.origins?.find((o) => o.origin === DAPP_ORIGIN);
}

async function pendingCount(page: Page): Promise<number> {
  const data = await sendExtensionRpc<{ requests: unknown[] }>(page, {
    type: "approval.getAll",
  });
  return data.requests.length;
}

/** Opens the queued request's detail pane. Nothing is selected on arrival. */
async function openFirstRequest(approvalPage: Page) {
  await approvalPage.getByTestId("approval-request-item").first().click();
  await expect(approvalPage.getByTestId("approval-detail")).toBeVisible();
}

test.describe("approval decisions", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("Deny returns a denial to the page and writes no rule", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    const dapp = await openDapp(extensionContext);

    await beginSignRequest(dapp, 7, "first request");
    const approvalPage = await waitForApprovalPage(extensionContext, extensionId);
    await openFirstRequest(approvalPage);
    await approvalPage.getByRole("button", { name: "Deny", exact: true }).click();

    const outcome = await readSignOutcome(dapp);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      // Specifically a refusal, not a timeout and not a locked vault. Those
      // failures would satisfy a weaker assertion while meaning something else
      // entirely — which is how the previous version of this file passed.
      expect(outcome.error.toLowerCase()).toMatch(/denied|rejected/);
      expect(outcome.error.toLowerCase()).not.toContain("timeout");
      expect(outcome.error.toLowerCase()).not.toContain("locked");
    }

    // A single denial is not a standing decision.
    expect((await originPolicy(popup))?.rules?.["7"]).toBeUndefined();

    // So the next identical request must ask again.
    await beginSignRequest(dapp, 7, "second request");
    await expect.poll(async () => await pendingCount(popup)).toBe(1);
  });

  test("Deny and remember auto-denies the next matching request", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    const dapp = await openDapp(extensionContext);

    await beginSignRequest(dapp, 7, "remembered denial");
    const approvalPage = await waitForApprovalPage(extensionContext, extensionId);
    await openFirstRequest(approvalPage);

    await approvalPage.getByRole("checkbox", { name: REMEMBER_LABEL }).check();
    await approvalPage.getByRole("button", { name: "Deny", exact: true }).click();

    const first = await readSignOutcome(dapp);
    expect(first.ok).toBe(false);

    await expect
      .poll(async () => (await originPolicy(popup))?.rules?.["7"])
      .toBe("deny");

    // The refusal half of the remembered-decision model: the second request is
    // refused by the stored rule, so it must never reach the queue at all.
    await beginSignRequest(dapp, 7, "should never prompt");
    const second = await readSignOutcome(dapp);
    expect(second.ok).toBe(false);
    expect(await pendingCount(popup)).toBe(0);
  });

  /**
   * The asymmetry that protects the most dangerous kind in the product:
   * ticking "Remember" and approving must never write a standing allow for a
   * protected kind, while ticking it and denying must persist.
   *
   * Two independent layers enforce this, and the distinction matters for what
   * this test is worth. `EventDetailView.handleApprove` downgrades to
   * `allow_once` for a protected kind, and `approval-rpc.ts:160-163` refuses to
   * write the rule even if asked. So this test deliberately does NOT fail when
   * either guard alone is removed — verified by mutating each in turn — and
   * does fail when both are, with `rules["1"]` coming back "allow". That is the
   * correct sensitivity for an end-to-end test of a defence-in-depth property:
   * it tracks what a user can actually be made to suffer, not which layer
   * happens to prevent it.
   *
   * The single-layer regressions are caught where they belong:
   * `tests/unit/ui/features/approval/event-detail-view.test.tsx:142` pins the
   * UI mapping, and the background guard has its own coverage.
   */
  test("remembering a protected kind persists a denial but never an approval", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    // High trust is the strongest standing permission available, so if a
    // remembered approval could ever persist for a protected kind, it would
    // persist here.
    await sendExtensionRpc(popup, {
      type: "policy.setOrigin",
      origin: DAPP_ORIGIN,
      patch: { trustLevel: "high" },
      password: TEST_PASSWORD,
    });

    const dapp = await openDapp(extensionContext);
    await beginSignRequest(dapp, 1, "protected kind approval");
    const approvalPage = await waitForApprovalPage(extensionContext, extensionId);
    await openFirstRequest(approvalPage);

    // The label itself tells the user the checkbox only binds a denial.
    await expect(
      approvalPage.getByRole("checkbox", { name: PROTECTED_REMEMBER_LABEL })
    ).toBeVisible();

    await approvalPage
      .getByRole("checkbox", { name: PROTECTED_REMEMBER_LABEL })
      .check();
    await approvalPage
      .getByRole("button", { name: "Approve & sign" })
      .click();

    const approved = await readSignOutcome(dapp);
    expect(approved.ok).toBe(true);
    if (approved.ok) expect(approved.sig).toMatch(/^[0-9a-f]{128}$/);

    // Signed once, remembered never.
    expect((await originPolicy(popup))?.rules?.["1"]).toBeUndefined();

    // And proven by behaviour, not only by stored state: it asks again.
    await beginSignRequest(dapp, 1, "protected kind, second time");
    await expect.poll(async () => await pendingCount(popup)).toBe(1);
  });

  test("a remembered denial of a protected kind does persist", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    const dapp = await openDapp(extensionContext);

    await beginSignRequest(dapp, 1, "protected kind denial");
    const approvalPage = await waitForApprovalPage(extensionContext, extensionId);
    await openFirstRequest(approvalPage);

    await approvalPage
      .getByRole("checkbox", { name: PROTECTED_REMEMBER_LABEL })
      .check();
    await approvalPage.getByRole("button", { name: "Deny", exact: true }).click();

    const outcome = await readSignOutcome(dapp);
    expect(outcome.ok).toBe(false);

    // Refusals are always allowed to be permanent. Only approvals are
    // constrained, which is the fail-closed direction.
    await expect
      .poll(async () => (await originPolicy(popup))?.rules?.["1"])
      .toBe("deny");
  });

  test("approving without remembering does not create a rule", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    const dapp = await openDapp(extensionContext);

    await beginSignRequest(dapp, 7, "one-off approval");
    const approvalPage = await waitForApprovalPage(extensionContext, extensionId);
    await openFirstRequest(approvalPage);
    await approvalPage
      .getByRole("button", { name: "Approve & sign" })
      .click();

    const outcome = await readSignOutcome(dapp);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.sig).toMatch(/^[0-9a-f]{128}$/);

    expect((await originPolicy(popup))?.rules?.["7"]).toBeUndefined();

    await beginSignRequest(dapp, 7, "asks again");
    await expect.poll(async () => await pendingCount(popup)).toBe(1);
  });
});
