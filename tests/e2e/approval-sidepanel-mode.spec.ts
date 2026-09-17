import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import type { BrowserContext } from "@playwright/test";
import {
  seedUnlockedVault,
  sendExtensionRpc,
  openDapp,
  resolveNextApproval,
  DAPP_ORIGIN,
} from "./fixtures/agent";

/**
 * Consent collected in the side panel instead of in a window.
 *
 * `settings.sidePanel` is a user-selectable mode, and it does not merely move
 * the same dialog somewhere else: it changes which code path asks the user.
 * `background.ts:focusOrCreateApprovalWindowInner` returns early without
 * creating a window and broadcasts `SWITCH_TO_ACTIVITY` instead, and consent is
 * then gathered by `ActivityPendingApprovals` rendering `ApprovalPrompt` over
 * the Activity tab.
 *
 * Every other approval spec in this suite writes `sidePanel: false` before it
 * starts (`approval-queue-ux.spec.ts:91`, `identity-disclosure.spec.ts:61`), so
 * until this file existed, half of the product's consent surface — the half a
 * user gets by ticking one radio button in Settings — had no end-to-end
 * coverage at all. The failure mode that buys is the worst one available to a
 * signer: a mode in which the approval window silently never opens and the
 * inline surface silently never appears would sign nothing and prompt nobody,
 * or, far worse, drift into approving without asking, and no test would notice.
 *
 * What is asserted here:
 *   - no `approval.html` window is created, ever, in this mode;
 *   - an open panel moves itself to Activity when a request lands;
 *   - the inline surface renders the real payload and its Approve/Deny return
 *     the same results to the page as the window does;
 *   - a decision remembered inline writes the same standing rule and is
 *     honoured on the next request without prompting.
 *
 * The mode is set over RPC rather than through the Settings control on purpose.
 * `OpenInSelector.handleModeChange` calls `chrome.sidePanel.open()`, which
 * requires a real user gesture in a window that can host a panel; invoked from
 * an extension page in this harness it takes the page down with it and logs
 * nothing. `general-settings.spec.ts` already pins that the control reads and
 * writes the stored flag in both directions, and the flag is the only thing
 * `background.ts` consults. Driving it here would test the harness, not the
 * product.
 *
 * The panel is also opened as a tab on `sidepanel.html` rather than as a real
 * docked panel, for the same reason: `chrome.sidePanel.open()` is unreachable.
 * The page, its React tree, its `browser.runtime` message listeners and its
 * narrow viewport are identical either way, so everything below exercises the
 * genuine panel code. What is NOT covered is Chrome's own panel chrome —
 * docking, and whether `window.close()` (see the note on the sign test) behaves
 * differently inside a real panel.
 *
 * Measured sensitivity, so the next person knows what these tests are worth
 * rather than having to trust that they are worth something. Each mutation was
 * applied to `background.ts`, built, and run:
 *
 *   Deleting the `return undefined` from the side-panel branch — the broadcast
 *   still fires, but a window is created as well — fails all five, and fails
 *   the first on the assertion it exists for:
 *     "side-panel mode must never create an approval.html window"
 *     Received: ["chrome-extension://<id>/approval.html"]
 *
 *   Deleting the `SWITCH_TO_ACTIVITY` broadcast fails the other four on
 *   `getByRole('heading', { name: 'Recent Activity', exact: true, level: 2 })`
 *   not being found, and correctly leaves the first one passing: a panel that
 *   is never told about the request is a different defect from a window being
 *   opened, and the first test does not claim to catch it.
 */

const REMEMBER_LABEL = "Remember this decision for this site and event kind";

type SignOutcome = { ok: true; sig: string } | { ok: false; error: string };

/** Fires a signing request and leaves it in flight; the promise is read later. */
async function beginSignRequest(
  dapp: Page,
  kind: number,
  content: string
): Promise<void> {
  await dapp.evaluate(
    ({ kind, content }) => {
      const w = window as unknown as { __outcome?: Promise<unknown> };
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

async function pendingCount(page: Page): Promise<number> {
  const data = await sendExtensionRpc<{ requests: unknown[] }>(page, {
    type: "approval.getAll",
  });
  return data.requests.length;
}

async function originPolicy(page: Page) {
  const settings = await sendExtensionRpc<{
    origins?: Array<{ origin: string; rules?: Record<string, string> }>;
  }>(page, { type: "settings.get" });
  return settings.origins?.find((o) => o.origin === DAPP_ORIGIN);
}

/**
 * Switches the extension into side-panel delivery and waits for the background
 * to have stored it. The wait is not decoration: `focusOrCreateApprovalWindow`
 * re-reads settings on every request, so a request that races the write would
 * open a window and the test would be blaming the product for its own timing.
 */
async function enableSidePanelMode(page: Page): Promise<void> {
  await sendExtensionRpc(page, {
    type: "settings.update",
    patch: { sidePanel: true },
  });
  await expect
    .poll(async () =>
      (await sendExtensionRpc<{ sidePanel?: boolean }>(page, {
        type: "settings.get",
      })).sidePanel
    )
    .toBe(true);
}

/**
 * Records every page the context opens so a window that appears and is closed
 * again cannot slip between two polls of `context.pages()`.
 */
function watchForApprovalWindows(context: BrowserContext, extensionId: string) {
  const prefix = `chrome-extension://${extensionId}/approval.html`;
  const seen = new Set<Page>();
  const record = (page: Page) => seen.add(page);
  context.on("page", record);

  return {
    stop() {
      context.off("page", record);
    },
    /** URLs of any approval window seen so far. Empty is the passing state. */
    urls(): string[] {
      const candidates = new Set<Page>([...seen, ...context.pages()]);
      return [...candidates]
        .map((page) => page.url())
        .filter((url) => url.startsWith(prefix));
    },
  };
}

type ApprovalWindowWatcher = ReturnType<typeof watchForApprovalWindows>;

/**
 * Holds the assertion open for a while rather than checking once. The window in
 * popup mode is created asynchronously after the request is enqueued, so a
 * single check immediately after `signEvent` would pass even with the mode
 * ignored entirely.
 */
async function expectNoApprovalWindow(
  watcher: ApprovalWindowWatcher,
  dwellMs = 3500
): Promise<void> {
  const deadline = Date.now() + dwellMs;
  do {
    expect(
      watcher.urls(),
      "side-panel mode must never create an approval.html window"
    ).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
}

/**
 * The Activity tab's own title.
 *
 * `level: 2` and `exact: true` are both load-bearing. HomeView renders an
 * `<h3>Recent activity</h3>` section header of its own, and the default
 * case-insensitive substring match picks it up — so a bare
 * `getByRole("heading", { name: "Recent Activity" })` is satisfied while the
 * panel is still sitting on Home, which would make every assertion below that
 * the broadcast moved the tab pass without the broadcast existing.
 */
function activityTitle(page: Page) {
  return page.getByRole("heading", {
    level: 2,
    name: "Recent Activity",
    exact: true,
  });
}

/** Opens the inline consent surface from the Activity tab's pending section. */
async function openInlineApproval(panel: Page): Promise<void> {
  // The label is the tell that this is the panel build of the control: in
  // popup mode the same button reads "Open Approval Window".
  await panel.getByRole("button", { name: "Review Approvals" }).click();
  await expect(
    panel.getByRole("heading", { name: "Pending Approvals" })
  ).toBeVisible();
}

/**
 * Lands on the detail of the queued request inside the inline surface.
 *
 * A lone request opens on its detail directly, and the panel is below the
 * `md` breakpoint, so the queue - and its row - is hidden behind the back
 * button in that case. Whichever of the two the prompt shows first is the
 * state to act on: click the row only when the queue is what is showing.
 */
async function openFirstInlineRequest(panel: Page): Promise<void> {
  const detail = panel.getByTestId("approval-detail");
  const row = panel.getByTestId("approval-request-item").first();
  // Not `detail.or(row)`: when the lone request auto-opens, the selected row
  // stays mounted behind the detail, so `.or()` matches both and trips strict
  // mode. Wait for whichever arrives, then act on the state that is showing.
  await expect
    .poll(async () => (await detail.isVisible()) || (await row.isVisible()), {
      timeout: 10_000,
    })
    .toBe(true);
  if (!(await detail.isVisible())) {
    await row.click();
  }
  await expect(detail).toBeVisible();
}

test.describe("side-panel approval delivery", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
    // Seeding a vault derives a KDF key twice, and several tests below then
    // deliberately spend seconds waiting for a window that must not appear.
    test.setTimeout(60_000);
  });

  /**
   * The load-bearing claim of the whole mode. If this regresses, a user who
   * chose the side panel gets a window thrown in front of whatever they were
   * doing — the exact interruption the setting exists to prevent — and the
   * panel surface is dead code.
   *
   * Asserting only "no window" would also pass if the request never reached the
   * background at all, so the queue depth is asserted first: the request is
   * real, it is waiting for a human, and no window was opened to ask one.
   */
  test("a signing request opens no approval window", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    await enableSidePanelMode(popup);

    const watcher = watchForApprovalWindows(extensionContext, extensionId);
    try {
      const dapp = await openDapp(extensionContext);
      await beginSignRequest(dapp, 7, "no window for this one");

      // The request genuinely arrived and is genuinely pending.
      await expect.poll(async () => await pendingCount(popup)).toBe(1);

      await expectNoApprovalWindow(watcher);

      // Still pending after the dwell: nothing auto-resolved it, so the
      // absence of a window above is an absence of prompting, not an absence
      // of a request.
      expect(await pendingCount(popup)).toBe(1);

      // Leave nothing hanging: the page is owed an answer, and the denial
      // proves the queued entry was a live signing request the whole time
      // rather than a stuck artifact.
      await resolveNextApproval(popup, "deny");
      const outcome = await readSignOutcome(dapp);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.toLowerCase()).toMatch(/denied|rejected/);
        expect(outcome.error.toLowerCase()).not.toContain("timeout");
      }
    } finally {
      watcher.stop();
    }
  });

  /**
   * The broadcast half of the mode: `background.ts` sends
   * `BROADCAST_EVENTS.SWITCH_TO_ACTIVITY` and `useAppNavigation` moves the tab.
   *
   * Without it the panel sits on Home while a site waits sixty seconds for an
   * answer the user was never shown. There is no badge on a panel and no window
   * to notice, so this message is the only notification the mode has.
   */
  test("an open side panel switches itself to Activity when a request arrives", async ({
    openPopup,
    openSidepanel,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    await enableSidePanelMode(popup);

    const panel = await openSidepanel();
    // The panel starts on Home — asserted, so that "Activity is showing" later
    // means the broadcast moved it rather than it having been there all along.
    // The key name now lives in the header on every tab, so Home is
    // identified by its own "Active identity" region instead.
    await expect(
      panel.getByRole("region", { name: "Active identity" })
    ).toBeVisible({ timeout: 15_000 });
    await expect(activityTitle(panel)).toBeHidden();

    const watcher = watchForApprovalWindows(extensionContext, extensionId);
    try {
      const dapp = await openDapp(extensionContext);
      await beginSignRequest(dapp, 7, "switch the panel to activity");

      await expect(activityTitle(panel)).toBeVisible();
      await expect(
        panel.getByRole("region", { name: "Active identity" })
      ).toBeHidden();

      // And the request is waiting there, not merely the tab. The control is
      // named "Review Approvals" only in this mode; the popup build of the same
      // button reads "Open Approval Window".
      await expect(
        panel.getByRole("button", { name: "Review Approvals" })
      ).toBeVisible();
      expect(watcher.urls()).toEqual([]);

      await resolveNextApproval(popup, "deny");
      expect((await readSignOutcome(dapp)).ok).toBe(false);
    } finally {
      watcher.stop();
    }
  });

  /**
   * The inline surface has to do the one thing the window does: turn a click
   * into a signature over the payload that was shown.
   *
   * The signature is checked against the page's own result rather than against
   * anything the extension reports, because the page is what an attacker holds.
   * A 128-hex schnorr signature coming back to the dApp is the only proof that
   * this surface is wired to the real signer and not to a stub that resolves
   * the queue entry without producing anything.
   */
  test("approving inline returns a real signature to the page", async ({
    openPopup,
    openSidepanel,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    await enableSidePanelMode(popup);

    const panel = await openSidepanel();
    await expect(
      panel.getByRole("heading", { level: 2, name: "Agent Loop Key" })
    ).toBeVisible({ timeout: 15_000 });

    const watcher = watchForApprovalWindows(extensionContext, extensionId);
    try {
      const dapp = await openDapp(extensionContext);
      await beginSignRequest(dapp, 7, "inline approval payload");

      await expect(activityTitle(panel)).toBeVisible();
      await openInlineApproval(panel);
      await openFirstInlineRequest(panel);

      // The panel is 390px wide, below the `md` breakpoint at which
      // ApprovalPrompt splits into list + detail, so this is the single-column
      // path the real panel always takes. It must still show the requesting
      // origin and the exact content next to the buttons.
      await expect(panel.getByTestId("approval-detail")).toContainText(
        "localhost:8765"
      );
      await expect(panel.getByTestId("approval-detail")).toContainText(
        "inline approval payload"
      );

      await panel.getByRole("button", { name: "Approve & sign" }).click();

      const outcome = await readSignOutcome(dapp);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.sig).toMatch(/^[0-9a-f]{128}$/);

      // A one-off approval, here as in the window: no standing rule.
      expect((await originPolicy(popup))?.rules?.["7"]).toBeUndefined();
      expect(watcher.urls()).toEqual([]);

      // NOT asserted, deliberately: what the panel looks like afterwards.
      // `ApprovalPrompt.handleAction` calls `window.close()` once the queue
      // empties, which is right for a window and questionable for a panel —
      // it closes the surface the user was reading. In this harness the panel
      // is a tab, so whether Chrome honours that close differs from a docked
      // panel and any assertion here would be about the harness. The queue
      // state and the signature are surface-independent, so those are what is
      // checked.
    } finally {
      watcher.stop();
    }
  });

  /**
   * Refusal has to work on every surface that can be shown, or the mode is a
   * trap: a user who can see a request and cannot refuse it will eventually
   * approve it to make it go away.
   *
   * The error is matched specifically. A locked vault, a timeout and a crashed
   * surface all produce *a* rejected promise, and the version of
   * `approval-flow.spec.ts` that this suite replaced passed for years on
   * exactly that confusion.
   */
  test("denying inline returns a denial and writes no rule", async ({
    openPopup,
    openSidepanel,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    await enableSidePanelMode(popup);

    const panel = await openSidepanel();
    await expect(
      panel.getByRole("heading", { level: 2, name: "Agent Loop Key" })
    ).toBeVisible({ timeout: 15_000 });

    const watcher = watchForApprovalWindows(extensionContext, extensionId);
    try {
      const dapp = await openDapp(extensionContext);
      await beginSignRequest(dapp, 7, "inline denial");

      await expect(activityTitle(panel)).toBeVisible();
      await openInlineApproval(panel);
      await openFirstInlineRequest(panel);
      await panel.getByRole("button", { name: "Deny", exact: true }).click();

      const outcome = await readSignOutcome(dapp);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.toLowerCase()).toMatch(/denied|rejected/);
        expect(outcome.error.toLowerCase()).not.toContain("timeout");
        expect(outcome.error.toLowerCase()).not.toContain("locked");
      }

      // One refusal is not a standing decision, so the next identical request
      // must queue again rather than being auto-denied.
      expect((await originPolicy(popup))?.rules?.["7"]).toBeUndefined();
      await beginSignRequest(dapp, 7, "asks again");
      await expect.poll(async () => await pendingCount(popup)).toBe(1);
      expect(watcher.urls()).toEqual([]);

      await resolveNextApproval(popup, "deny");
      expect((await readSignOutcome(dapp)).ok).toBe(false);
    } finally {
      watcher.stop();
    }
  });

  /**
   * Parity on the part that outlives the click: a decision remembered on the
   * inline surface must create the same standing permission the window creates,
   * and must then be honoured with no prompt on any surface.
   *
   * This is where a second consent surface is most likely to go wrong. The
   * remember checkbox lives in `EventDetailView`, which both surfaces share, but
   * the surrounding wiring does not: if the inline path dropped the action and
   * sent a bare `allow_once`, the user would be silently re-prompted forever —
   * annoying — and if it widened one, the user would have granted a standing
   * signing permission they did not ask for. The second half of the test is the
   * one that matters: the follow-up request is signed with nothing queued and
   * nothing shown, which is only safe because the user really did say "allow".
   */
  test("a decision remembered inline is honoured without prompting again", async ({
    openPopup,
    openSidepanel,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    await enableSidePanelMode(popup);

    const panel = await openSidepanel();
    await expect(
      panel.getByRole("heading", { level: 2, name: "Agent Loop Key" })
    ).toBeVisible({ timeout: 15_000 });

    const watcher = watchForApprovalWindows(extensionContext, extensionId);
    try {
      const dapp = await openDapp(extensionContext);
      await beginSignRequest(dapp, 7, "remembered inline approval");

      await expect(activityTitle(panel)).toBeVisible();
      await openInlineApproval(panel);
      await openFirstInlineRequest(panel);

      await panel.getByRole("checkbox", { name: REMEMBER_LABEL }).check();
      await panel.getByRole("button", { name: "Approve & sign" }).click();

      const first = await readSignOutcome(dapp);
      expect(first.ok).toBe(true);
      if (first.ok) expect(first.sig).toMatch(/^[0-9a-f]{128}$/);

      // Kind 7 is not protected, so "Remember" is allowed to widen to a
      // standing allow — the same rule `approval-flow.spec.ts` proves is
      // withheld for a protected kind.
      await expect
        .poll(async () => (await originPolicy(popup))?.rules?.["7"])
        .toBe("allow");

      // Honoured, not merely stored: signed straight through, never queued,
      // and still no window anywhere.
      await beginSignRequest(dapp, 7, "second, on the standing rule");
      const second = await readSignOutcome(dapp);
      expect(second.ok).toBe(true);
      if (second.ok) expect(second.sig).toMatch(/^[0-9a-f]{128}$/);
      expect(await pendingCount(popup)).toBe(0);
      expect(watcher.urls()).toEqual([]);
    } finally {
      watcher.stop();
    }
  });
});
