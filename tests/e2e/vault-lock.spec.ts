import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";

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
