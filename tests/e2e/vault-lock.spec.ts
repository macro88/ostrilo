import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import {
  seedUnlockedVault,
  openDapp,
  waitForApprovalPage,
  DAPP_ORIGIN,
  TEST_PASSWORD,
} from "./fixtures/agent";
import { THROTTLE_POLICY } from "@/application/services/unlock-throttle.service";

/**
 * Auto-lock, and what a locked vault is allowed to do.
 *
 * Two shipped defects sit behind these tests:
 *
 *  1. `getLockState` returned `!!state?.isLocked`, so a vault with no stored
 *     lock state - every browser restart, before anything is unlocked -
 *     reported itself UNLOCKED. `nostr.getPublicKey` checked only that gate
 *     at the time; it now also validates the origin and rate limits per
 *     origin.
 *  2. `autoLockMinutes` was cosmetic. It drove two sliders and a header label
 *     and nothing enforced it: no alarm, no idle listener, no timer calling
 *     lock(). The README advertised the feature anyway.
 *
 * And the options page had no lock check at all, so it rendered key labels,
 * public keys, origin policies and the relay list to anyone holding the device.
 */

const PASSWORD = "Lantern-Thicket-Cobalt-2026!";
const DAPP_URL = "https://localhost:8765/test-page.html";

type RpcResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: unknown };

async function rpc<T>(
  page: Page,
  message: Record<string, unknown>
): Promise<RpcResponse<T>> {
  return await page.evaluate(
    (rpcMessage) =>
      new Promise<RpcResponse<T>>((resolve, reject) => {
        const chromeApi = (globalThis as any).chrome;
        chromeApi.runtime.sendMessage(rpcMessage, (value: RpcResponse<T>) => {
          const lastError = chromeApi.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
            return;
          }
          resolve(value);
        });
      }),
    message
  );
}

async function rpcOk<T>(page: Page, message: Record<string, unknown>) {
  const res = await rpc<T>(page, message);
  expect(res.ok, `RPC ${String(message.type)} failed: ${JSON.stringify(res)}`).toBe(
    true
  );
  return (res as { ok: true; data: T }).data;
}

async function createAndUnlock(page: Page) {
  await rpcOk(page, {
    type: "vault.generate",
    password: PASSWORD,
    label: "Lock E2E Key",
  });
  await rpcOk(page, { type: "vault.unlock", password: PASSWORD });
  // These tests call `window.nostr.getPublicKey()` on an unlocked vault to
  // assert what a LOCKED one refuses. Identity disclosure now needs consent, so
  // without this grant those calls do not fail - they queue a prompt and block
  // for APPROVAL_TIMEOUT_MS (60s). A hang, not an assertion failure, is the
  // failure mode, which is easy to misread as flakiness.
  await rpcOk(page, {
    type: "policy.setOrigin",
    origin: "https://localhost:8765",
    patch: { identityDisclosure: "allow" },
  });
  await rpcOk(page, {
    type: "settings.update",
    patch: { onboardingCompleted: true, onboardingCompletedAt: Date.now() },
  });
}

/** Rewinds the recorded activity so the deadline has already passed. */
async function expireSession(page: Page, minutesAgo = 120) {
  await page.evaluate(async (ms) => {
    const chromeApi = (globalThis as any).chrome;
    const current = await chromeApi.storage.session.get("lockState");
    const state = current.lockState ?? {};
    await chromeApi.storage.session.set({
      lockState: { ...state, lastActivity: Date.now() - ms },
    });
  }, minutesAgo * 60 * 1000);
}

test.describe("vault lock and unlock", () => {
  test("locks after the configured timeout and refuses to sign", async ({
    openPopup,
    extensionContext,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    const popup = await openPopup();
    await createAndUnlock(popup);

    const dapp = await extensionContext.newPage();
    await dapp.goto(DAPP_URL);
    await dapp.waitForFunction(() => typeof window.nostr !== "undefined", {
      timeout: 5000,
    });

    // Unlocked: the identity is available.
    const pubkey = await dapp.evaluate(() => window.nostr!.getPublicKey());
    expect(pubkey).toMatch(/^[0-9a-f]{64}$/);

    await expireSession(popup);

    // The deadline is evaluated on access, so the next lock-state read locks.
    const lockState = await rpcOk<{ isLocked: boolean }>(popup, {
      type: "state.getLock",
    });
    expect(
      lockState.isLocked,
      "SECURITY REGRESSION: the configured auto-lock timeout was not enforced"
    ).toBe(true);

    // And the page can no longer get the identity or a signature.
    const afterLock = await dapp.evaluate(async () => {
      try {
        return { ok: true, value: await window.nostr!.getPublicKey() };
      } catch (err) {
        return { ok: false, value: err instanceof Error ? err.message : String(err) };
      }
    });
    expect(
      afterLock.ok,
      "SECURITY REGRESSION: a locked vault still disclosed the public key"
    ).toBe(false);

    const signAttempt = await dapp.evaluate(async () => {
      try {
        await window.nostr!.signEvent({
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: "after lock",
        });
        return true;
      } catch {
        return false;
      }
    });
    expect(
      signAttempt,
      "SECURITY REGRESSION: a locked vault signed an event"
    ).toBe(false);

    // Unlocking restores it, so the lock is a lock and not a bricking.
    await rpcOk(popup, { type: "vault.unlock", password: PASSWORD });
    const restored = await dapp.evaluate(() => window.nostr!.getPublicKey());
    expect(restored).toBe(pubkey);
  });

  test("a never-opened vault discloses nothing", async ({
    extensionContext,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    // No unlock anywhere in this test: this is the state after every browser
    // restart, and it is the one that used to report itself unlocked.
    const dapp = await extensionContext.newPage();
    await dapp.goto(DAPP_URL);
    await dapp.waitForFunction(() => typeof window.nostr !== "undefined", {
      timeout: 5000,
    });

    const result = await dapp.evaluate(async () => {
      try {
        return { ok: true, value: await window.nostr!.getPublicKey() };
      } catch (err) {
        return { ok: false, value: String(err) };
      }
    });

    expect(
      result.ok,
      "SECURITY REGRESSION: a vault that was never unlocked disclosed the public key"
    ).toBe(false);
  });
});

test.describe("options page while locked", () => {
  test("renders the lock screen and exposes no stored data", async ({
    openPopup,
    openOptions,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    const popup = await openPopup();
    await createAndUnlock(popup);

    // Something identifying to look for once locked.
    await rpcOk(popup, {
      type: "settings.update",
      patch: { relays: ["wss://relay.private-e2e.example"] },
    });

    const options = await openOptions();
    await expect(
      options.getByRole("heading", { name: "Ostrilo Settings" })
    ).toBeVisible();

    await rpcOk(popup, { type: "vault.lock" });

    // The page transitions without a reload: the broadcast arrives, and the
    // poll is the backstop.
    await expect(options.getByLabel(/password/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(options.getByRole("tab", { name: "Relays" })).toHaveCount(0);

    const body = (await options.textContent("body")) ?? "";
    expect(
      body,
      "SECURITY REGRESSION: the relay list was visible behind a locked vault"
    ).not.toContain("relay.private-e2e.example");
    expect(body).not.toContain("Lock E2E Key");
  });

  test("refuses mutation from a page opened while locked", async ({
    openPopup,
    openOptions,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    const popup = await openPopup();
    await createAndUnlock(popup);
    await rpcOk(popup, { type: "vault.lock" });

    const options = await openOptions();

    // Driving the message directly, because that is what an attacker does
    // rather than clicking through a UI that is not rendering the controls.
    const attempt = await rpc(options, {
      type: "policy.setOrigin",
      origin: "https://evil.example",
      patch: { trustLevel: "high" },
    });
    expect(
      attempt.ok,
      "SECURITY REGRESSION: a locked vault accepted a trust change"
    ).toBe(false);

    await rpcOk(popup, { type: "vault.unlock", password: PASSWORD });
    const stored = await rpcOk<{ origins?: Array<{ origin: string }> }>(popup, {
      type: "settings.get",
    });
    expect(
      stored.origins?.some((o) => o.origin === "https://evil.example") ?? false
    ).toBe(false);
  });
});

test.describe("unlock feedback", () => {
  test("a wrong password says so and leaves the vault locked", async ({
    openPopup,
    openOptions,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    const popup = await openPopup();
    await createAndUnlock(popup);
    await rpcOk(popup, { type: "vault.lock" });

    const options = await openOptions();
    const field = options.getByLabel(/master password/i).first();
    await expect(field).toBeVisible({ timeout: 15_000 });

    await field.fill("not-the-password");
    await options.getByRole("button", { name: "Unlock" }).click();

    // The defect this covers: the failure was swallowed, so the field cleared
    // and nothing was said. "Still locked" is NOT evidence either way - the
    // lock screen stayed put even while the bug was live.
    await expect(options.getByRole("alert")).toContainText(/incorrect/i, {
      timeout: 15_000,
    });

    const body = (await options.textContent("body")) ?? "";
    expect(
      body,
      "SECURITY REGRESSION: the entered password was rendered back to the page"
    ).not.toContain("not-the-password");

    const stillLocked = await rpcOk<{ isLocked: boolean }>(popup, {
      type: "state.getLock",
    });
    expect(stillLocked.isLocked).toBe(true);

    // And the right password still works, so the gate is a gate and not a wall.
    await field.fill(PASSWORD);
    await options.getByRole("button", { name: "Unlock" }).click();
    await expect(
      options.getByRole("heading", { name: "Ostrilo Settings" })
    ).toBeVisible({ timeout: 15_000 });
  });
});

/**
 * The header Lock button, the unlock throttle, and the locked-request badge.
 *
 * Three journeys the suite above never drove. Each is a control that only
 * exists in the shipped product because a specific hole was closed:
 *
 *  1. Locking must deny whatever is already queued. A prompt that survives a
 *     lock is the "approve after they walked away" defect
 *     `background.ts:316-330` says it fixed - the badge kept its count, the
 *     approval window kept its buttons, and a later unlock turned a stale
 *     click into a real signature over an event the user had abandoned.
 *  2. Guessing at the keyboard was bounded only by KDF cost. `LockScreen` held
 *     an attempt counter in component state that rendered a warning and did
 *     nothing, and closing the popup reset it.
 *  3. A site that asks to sign while locked has to be able to tell the user
 *     something, but the page-triggered unlock popup was removed: any page
 *     could summon the real master-password prompt on demand. The toolbar
 *     badge is the replacement, and it is the only remaining signal.
 */

/** `EventDetailView`'s checkbox label for an unprotected kind. */
const REMEMBERED_DECISION_LABEL =
  "Remember this decision for this site and event kind";

/**
 * Sleeps out a throttle pause. Real time, because the lockout is a stored
 * `lockedUntil` epoch compared against the background's own clock - there is no
 * timer to fake, and rewinding the stored state would be testing the test.
 */
async function waitOutPause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms + 1_500));
}

/** Fires a signing request and leaves it in flight; the promise is read later. */
async function beginLockSignRequest(
  dapp: Page,
  kind: number,
  content: string
): Promise<void> {
  await dapp.evaluate(
    ({ kind, content }) => {
      const w = window as unknown as { __lockOutcome?: Promise<unknown> };
      w.__lockOutcome = window
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

type LockSignOutcome = { ok: true; sig: string } | { ok: false; error: string };

/**
 * Distinguishes "answered no" from "left hanging".
 *
 * Repeated as a literal inside the `evaluate` below, because that callback is
 * serialised into the page and cannot close over anything from this module.
 */
const NEVER_ANSWERED = "__never_answered__";

/**
 * Reads the in-flight promise, but never waits forever for it.
 *
 * A bare `await` on a promise that is never settled fails as
 * "Test timeout of 30000ms exceeded" pointing at this helper, which reads as
 * harness flakiness. It is the opposite: a request that is dropped rather than
 * resolved is precisely the defect, and the dApp sitting there for the
 * provider's own 65s backstop is what that defect looks like from the page.
 * Racing a timer keeps that failure an assertion with a sentence attached.
 */
async function readLockSignOutcome(
  dapp: Page,
  timeoutMs = 10_000
): Promise<LockSignOutcome> {
  return (await dapp.evaluate(async (ms) => {
    const pending = (window as unknown as { __lockOutcome: Promise<unknown> })
      .__lockOutcome;
    return await Promise.race([
      pending,
      new Promise((resolve) =>
        setTimeout(() => resolve({ ok: false, error: "__never_answered__" }), ms)
      ),
    ]);
  }, timeoutMs)) as LockSignOutcome;
}

/** Reads the toolbar badge the way a user reads it: off the browser action. */
async function readBadge(
  page: Page
): Promise<{ text: string; title: string }> {
  return await page.evaluate(async () => {
    const action = (globalThis as any).chrome?.action;
    const [text, title] = await Promise.all([
      action.getBadgeText({}),
      action.getTitle({}),
    ]);
    return { text, title };
  });
}

test.describe("locking cancels work in flight", () => {
  /**
   * The header button is the only manual lock in the product and no spec drove
   * it. What matters is not that it locks - `vault.lock` is exercised all over
   * this file - but that the queue does not outlive the session that raised it.
   *
   * The dApp end is the part a weaker test would miss: a request that is
   * dropped without being resolved leaves the page hanging until its own
   * timeout, and a page that never hears "no" retries.
   */
  test("the header Lock button denies a signing prompt still in flight", async ({
    openPopup,
    extensionContext,
    extensionId,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    const popup = await openPopup();
    await seedUnlockedVault(popup, { label: "Header Lock Key" });
    const dapp = await openDapp(extensionContext);

    // Kind 7 is unprotected and the origin has no rule, so policy says "ask":
    // the request parks in the queue and the approval window opens.
    await beginLockSignRequest(dapp, 7, "queued when the user walked away");
    const approvalPage = await waitForApprovalPage(extensionContext, extensionId);
    await expect(
      approvalPage.getByTestId("approval-request-item").first()
    ).toBeVisible({ timeout: 10_000 });

    const queued = await rpcOk<{ requests: unknown[] }>(popup, {
      type: "approval.getAll",
    });
    expect(
      queued.requests.length,
      "the request must actually be waiting, or the rest of this test proves nothing"
    ).toBe(1);

    // The real control: the icon button in the header, found by the accessible
    // name `Header.tsx` gives it.
    await popup.getByRole("button", { name: "Lock extension" }).click();

    // 1. The vault is locked.
    await expect
      .poll(
        async () =>
          (await rpcOk<{ isLocked: boolean }>(popup, { type: "state.getLock" }))
            .isLocked,
        { timeout: 10_000 }
      )
      .toBe(true);

    // 2. The page was answered, and answered NO. A dropped request would leave
    //    this promise pending until the provider's own 65s backstop, so reading
    //    it here is also what proves the request was resolved rather than
    //    abandoned.
    const outcome = await readLockSignOutcome(dapp);
    expect(
      outcome.ok,
      "SECURITY REGRESSION: locking the vault signed the request that was in flight"
    ).toBe(false);
    if (!outcome.ok) {
      expect(
        outcome.error,
        "SECURITY REGRESSION: locking dropped the queued request instead of denying it - the page is still waiting and will retry"
      ).not.toBe(NEVER_ANSWERED);
      expect(outcome.error.toLowerCase()).toMatch(/denied|rejected/);
      // Specifically not the 60s queue timeout: a request that merely sat there
      // and expired would satisfy a weaker assertion while meaning the lock did
      // nothing.
      expect(outcome.error.toLowerCase()).not.toContain("timeout");
    }

    // 3. Nothing survives to be approved later. While locked, `approval.getAll`
    //    is itself refused - it is not on the locked-reachable allowlist - so
    //    check both sides of the unlock: refused now, and empty once the vault
    //    is open again. The second half is the one that matters, because it is
    //    the state a returning user would click on.
    const whileLocked = await rpc(popup, { type: "approval.getAll" });
    expect(
      whileLocked.ok,
      "a locked vault must not enumerate the approval queue"
    ).toBe(false);

    await rpcOk(popup, { type: "vault.unlock", password: TEST_PASSWORD });
    const afterUnlock = await rpcOk<{ requests: unknown[] }>(popup, {
      type: "approval.getAll",
    });
    expect(
      afterUnlock.requests.length,
      "SECURITY REGRESSION: a signing prompt survived a lock and can still be approved"
    ).toBe(0);

    // 4. The approval WINDOW, however, is still standing.
    //
    //    FINDING, product rather than test: nothing closes it. `onLock` calls
    //    `approvalQueue.clear()`, and `clear()` is the one mutator in
    //    `ApprovalQueueService` that never calls `notifyChange()` - so no
    //    QUEUE_UPDATED goes out and the window never refetches. `onLock` does
    //    not call `closeApprovalWindow()` either, and `ApprovalPrompt` listens
    //    for QUEUE_UPDATED only, not for VAULT_LOCKED. The window therefore
    //    keeps rendering the abandoned request under a live-looking
    //    "Approve & sign" button, which is the exact picture the lock is
    //    supposed to take away.
    //
    //    This spec deliberately does NOT assert "the window is open": pinning
    //    a defect in place makes the test fail the day someone fixes it.
    //    It asserts what actually protects the user - that the stale button is
    //    inert - so it stays correct either way.
    expect(approvalPage.isClosed()).toBe(false);

    await approvalPage.getByTestId("approval-request-item").first().click();
    await expect(approvalPage.getByTestId("approval-detail")).toBeVisible();
    await approvalPage
      .getByRole("checkbox", { name: REMEMBERED_DECISION_LABEL })
      .check();
    await approvalPage.getByRole("button", { name: "Approve & sign" }).click();

    // Two layers refuse it and both are worth pinning. While locked,
    // `approval.resolve` is not on the locked-reachable allowlist. After the
    // unlock above, `getById` finds nothing and `handleResolve` returns
    // "Request not found" BEFORE it reaches any policy write - which is why
    // ticking Remember above cannot leave a standing allow behind.
    const settled = await rpcOk<{ requests: unknown[] }>(popup, {
      type: "approval.getAll",
    });
    expect(settled.requests.length).toBe(0);

    const stored = await rpcOk<{
      origins?: Array<{ origin: string; rules?: Record<string, string> }>;
    }>(popup, { type: "settings.get" });
    expect(
      stored.origins?.find((o) => o.origin === DAPP_ORIGIN)?.rules?.["7"],
      "SECURITY REGRESSION: a click on the stale approval window wrote a standing allow"
    ).toBeUndefined();

    // The page's answer is final: it was refused once and cannot be re-answered.
    const afterStaleClick = await readLockSignOutcome(dapp);
    expect(afterStaleClick.ok).toBe(false);
  });
});

test.describe("unlock throttling", () => {
  /**
   * Brute-force resistance at the keyboard.
   *
   * The numbers come from THROTTLE_POLICY rather than from this file, so the
   * test tracks the policy instead of pinning a second copy of it. What is
   * pinned deliberately is the SHAPE: the free attempts are free, the pause
   * arrives immediately after them, it doubles, and - the whole point - a
   * CORRECT password is refused while the pause is running. A lockout that let
   * the right password through would be a counter, not a lockout, and an
   * attacker guessing does not care how long the wrong guesses are delayed if
   * the winning guess is answered instantly.
   */
  test("pauses after the free attempts and refuses even a correct password", async ({
    openPopup,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
    // Several argon2id derivations plus two real lockouts waited out.
    test.setTimeout(180_000);

    const popup = await openPopup();
    await seedUnlockedVault(popup, { label: "Throttle Key" });
    await rpcOk(popup, { type: "vault.lock" });

    const field = popup.getByLabel(/master password/i).first();
    const unlockButton = popup.getByRole("button", { name: "Unlock" });
    await expect(field).toBeVisible({ timeout: 15_000 });

    /**
     * One attempt through the UI, resolved when the background has answered.
     *
     * `handleUnlock` clears the field on both branches, so an empty field is
     * the signal - except on the successful attempt, where the surface swaps
     * away and the input is gone rather than blank. Both count as answered;
     * waiting only for the blank value hangs on success.
     */
    const attempt = async (password: string) => {
      await field.fill(password);
      await unlockButton.click();
      await expect
        .poll(
          async () => {
            try {
              return (await field.count()) === 0 ? "" : await field.inputValue();
            } catch {
              return "";
            }
          },
          { timeout: 60_000 }
        )
        .toBe("");
    };

    const alert = popup.getByRole("alert");
    const seconds = (ms: number) => Math.ceil(ms / 1000);

    // The free attempts really are free: a plain refusal, no pause imposed.
    for (let i = 1; i <= THROTTLE_POLICY.freeAttempts; i++) {
      await attempt(`wrong-password-${i}`);
      await expect(alert).toContainText(/incorrect password/i, {
        timeout: 60_000,
      });
      const text = (await alert.textContent()) ?? "";
      expect(
        text,
        `attempt ${i} of ${THROTTLE_POLICY.freeAttempts} must not be throttled yet`
      ).not.toMatch(/paused|too many/i);
    }

    // One past the allowance: the first pause, reported with its countdown.
    await attempt("wrong-password-over");
    await expect(alert).toContainText(
      `Further attempts are paused for ${seconds(
        THROTTLE_POLICY.baseDelayMs
      )} seconds`,
      { timeout: 60_000 }
    );

    // The assertion this test exists for. The vault is locked out, and the
    // password is the RIGHT one.
    await attempt(TEST_PASSWORD);
    // Lock state first, and deliberately so: if the lockout let the right
    // password through, the lock screen unmounts and every assertion about its
    // copy degrades into "element not found" sixty seconds later. This one says
    // what went wrong, immediately.
    const refusedLockState = await rpcOk<{ isLocked: boolean }>(popup, {
      type: "state.getLock",
    });
    expect(
      refusedLockState.isLocked,
      "SECURITY REGRESSION: the unlock lockout admitted a correct password"
    ).toBe(true);
    await expect(alert).toContainText(/too many failed attempts/i, {
      timeout: 60_000,
    });

    // A refused attempt must not itself count as a failure - otherwise a page
    // hammering `vault.unlock` would ratchet the delay to the one-hour ceiling
    // and lock the real user out of their own vault. Proven by the NEXT wrong
    // password landing on exactly one doubling, not two.
    await waitOutPause(THROTTLE_POLICY.baseDelayMs);
    await attempt("wrong-password-again");
    await expect(alert).toContainText(
      `Further attempts are paused for ${seconds(
        THROTTLE_POLICY.baseDelayMs * 2
      )} seconds`,
      { timeout: 60_000 }
    );

    // And it is a pause, not a brick: once it elapses the right password works.
    await waitOutPause(THROTTLE_POLICY.baseDelayMs * 2);
    await attempt(TEST_PASSWORD);
    await expect
      .poll(
        async () =>
          (await rpcOk<{ isLocked: boolean }>(popup, { type: "state.getLock" }))
            .isLocked,
        { timeout: 20_000 }
      )
      .toBe(false);
  });
});

test.describe("locked-request badge", () => {
  /**
   * The toolbar marker is the entire notification channel for "a site wanted
   * to sign while you were locked".
   *
   * `openUnlockPrompt` was deleted because it let any page summon the real
   * master-password prompt; the badge replaced it precisely because a page
   * cannot drive it beyond making it appear once. If it silently stops being
   * raised, the removal turns into a regression in the user's favour on paper
   * and a silent failure in practice: the site is refused and the user never
   * learns anyone asked.
   */
  test("raises a marker for a request refused while locked, and clears it on unlock", async ({
    openPopup,
    extensionContext,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    const popup = await openPopup();
    await seedUnlockedVault(popup, { label: "Badge Key" });
    await rpcOk(popup, { type: "vault.lock" });

    // Baseline, so the marker below is evidence of the refusal and not just
    // the badge's resting state.
    expect((await readBadge(popup)).text).toBe("");

    const dapp = await openDapp(extensionContext);
    await beginLockSignRequest(dapp, 1, "asked while locked");

    const refused = await readLockSignOutcome(dapp);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.toLowerCase()).toContain("locked");

    await expect
      .poll(async () => (await readBadge(popup)).text, { timeout: 10_000 })
      .toBe("!");
    // The text alone is ambiguous with the approval count, so pin the tooltip
    // that says which of the two this is.
    expect((await readBadge(popup)).title).toMatch(
      /asked to sign while the vault was locked/i
    );

    // Nothing was queued for later approval: a locked request is refused
    // outright, not parked. The badge is a notice, not a pending decision.
    await rpcOk(popup, { type: "vault.unlock", password: TEST_PASSWORD });
    const queue = await rpcOk<{ requests: unknown[] }>(popup, {
      type: "approval.getAll",
    });
    expect(queue.requests.length).toBe(0);

    await expect
      .poll(async () => (await readBadge(popup)).text, { timeout: 10_000 })
      .toBe("");
  });
});
