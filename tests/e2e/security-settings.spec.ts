import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import { seedUnlockedVault, sendExtensionRpc, TEST_PASSWORD } from "./fixtures/agent";
import { AUTO_LOCK_BOUNDS } from "@/domain/types";

/**
 * Auto-lock and session lifetime, driven through the options UI.
 *
 * Both settings decide how long an unlocked vault stays unlocked, so both are
 * password-gated in the background (`reauth.ts` lists `autoLockMinutes` and
 * `sessionTTLMinutes`). That gate is the thing worth a browser test: an
 * attacker with brief physical access to an unlocked browser should not be able
 * to widen the auto-lock window and walk away, because the next time the owner
 * unlocks, a silent-signing origin would have far longer to act.
 *
 * `tests/security/auto-lock.test.ts` and `tests/security/reauth-boundary.test.ts`
 * already prove the rule at the service and RPC layers. These assert the UI
 * actually routes through it rather than writing the setting directly.
 */

const AUTO_LOCK_LABEL = "Auto-lock timeout";

async function openSecurityTab(page: Page) {
  await page.getByRole("tab", { name: "Security" }).click();
  await expect(
    page.getByRole("heading", { name: "Security", exact: true })
  ).toBeVisible();
}

async function currentSettings(page: Page) {
  return await sendExtensionRpc<{
    autoLockMinutes: number;
    sessionTTLMinutes: number;
  }>(page, { type: "settings.get" });
}

async function openOptionsOnSecurity(
  openPopup: () => Promise<Page>,
  openOptions: () => Promise<Page>
) {
  const popup = await openPopup();
  await seedUnlockedVault(popup);

  const options = await openOptions();
  await options.setViewportSize({ width: 1280, height: 900 });
  await openSecurityTab(options);
  return { popup, options };
}

test.describe("security settings", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("asks for the password before widening the auto-lock window", async ({
    openPopup,
    openOptions,
  }) => {
    const { options } = await openOptionsOnSecurity(openPopup, openOptions);
    const before = (await currentSettings(options)).autoLockMinutes;

    const slider = options.getByRole("slider", { name: AUTO_LOCK_LABEL });
    await expect(slider).toBeVisible();
    await slider.focus();
    await slider.press("ArrowRight");

    // The gate is a dialog, not a silent write.
    await expect(
      options.getByRole("heading", { name: "Confirm with your password" })
    ).toBeVisible();

    // Nothing is persisted while the dialog is still open and unanswered.
    expect((await currentSettings(options)).autoLockMinutes).toBe(before);
  });

  test("applies the change once the password is given", async ({
    openPopup,
    openOptions,
  }) => {
    const { options } = await openOptionsOnSecurity(openPopup, openOptions);
    const before = (await currentSettings(options)).autoLockMinutes;

    const slider = options.getByRole("slider", { name: AUTO_LOCK_LABEL });
    await slider.focus();
    await slider.press("ArrowRight");

    await options.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await options.getByRole("button", { name: "Confirm" }).click();

    await expect
      .poll(async () => (await currentSettings(options)).autoLockMinutes)
      .not.toBe(before);
  });

  /**
   * The password is verified by decrypting real key material and is never
   * cached, so a wrong answer must leave the setting exactly as it was.
   */
  test("leaves the setting alone when the password is wrong", async ({
    openPopup,
    openOptions,
  }) => {
    const { options } = await openOptionsOnSecurity(openPopup, openOptions);
    const before = (await currentSettings(options)).autoLockMinutes;

    const slider = options.getByRole("slider", { name: AUTO_LOCK_LABEL });
    await slider.focus();
    await slider.press("ArrowRight");

    await options
      .getByLabel("Password", { exact: true })
      .fill("not-the-right-password");
    await options.getByRole("button", { name: "Confirm" }).click();

    // Give the failed attempt time to land rather than asserting on a race.
    await expect(
      options.getByRole("heading", { name: "Confirm with your password" })
    ).toBeVisible();
    expect((await currentSettings(options)).autoLockMinutes).toBe(before);
  });

  test("cancelling the password prompt discards the change", async ({
    openPopup,
    openOptions,
  }) => {
    const { options } = await openOptionsOnSecurity(openPopup, openOptions);
    const before = (await currentSettings(options)).autoLockMinutes;

    const slider = options.getByRole("slider", { name: AUTO_LOCK_LABEL });
    await slider.focus();
    await slider.press("ArrowRight");

    await expect(
      options.getByRole("heading", { name: "Confirm with your password" })
    ).toBeVisible();
    await options.getByRole("button", { name: "Cancel" }).click();

    await expect(
      options.getByRole("heading", { name: "Confirm with your password" })
    ).toHaveCount(0);
    expect((await currentSettings(options)).autoLockMinutes).toBe(before);
  });

  /**
   * Reset rewrites both timeouts, so it carries the same password gate. It used
   * to ask with `confirm()` and then send the patch bare: the background refused
   * it, nothing reset, and the only trace was a console.error that production
   * compiles away. A destructive button that silently does nothing is worse than
   * one that fails loudly, because the user believes it worked.
   */
  test("resets settings only after the password is given", async ({
    openPopup,
    openOptions,
  }) => {
    const { options } = await openOptionsOnSecurity(openPopup, openOptions);

    await sendExtensionRpc(options, {
      type: "settings.update",
      patch: { theme: "dark" },
    });
    await expect
      .poll(async () =>
        (await sendExtensionRpc<{ theme: string }>(options, { type: "settings.get" }))
          .theme
      )
      .toBe("dark");

    await options.getByRole("button", { name: "Reset All Settings" }).click();
    await expect(
      options.getByRole("heading", { name: "Confirm with your password" })
    ).toBeVisible();

    await options.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await options.getByRole("button", { name: "Confirm" }).click();

    await expect
      .poll(async () =>
        (await sendExtensionRpc<{ theme: string }>(options, { type: "settings.get" }))
          .theme
      )
      .not.toBe("dark");
  });

  test("cancelling reset changes nothing", async ({ openPopup, openOptions }) => {
    const { options } = await openOptionsOnSecurity(openPopup, openOptions);

    await sendExtensionRpc(options, {
      type: "settings.update",
      patch: { theme: "dark" },
    });

    await options.getByRole("button", { name: "Reset All Settings" }).click();
    await options.getByRole("button", { name: "Cancel" }).click();

    const after = await sendExtensionRpc<{ theme: string }>(options, {
      type: "settings.get",
    });
    expect(after.theme).toBe("dark");
  });


  /**
   * A drag is one decision, not one decision per pixel.
   *
   * These sliders are bound to the PERSISTED setting, and the write is gated
   * behind a password dialog. Committing on `onValueChange` therefore opened
   * that dialog on the first step of a drag; the dialog took focus and the
   * pointer, the drag died, and the value never reached the one the user was
   * aiming for. The control was usable only one step at a time.
   *
   * Note this cannot be fixed by moving to `onValueCommit` alone: Radix fires
   * it only when the controlled value differs from what it was at slide start,
   * and the persisted value cannot move until the password is given. Without
   * local draft state the commit would never fire at all, so this asserts both
   * halves - the thumb tracks the drag, and exactly one prompt arrives at the
   * end naming where the thumb finished.
   */
  test("a drag asks once, on release, for the value it was released on", async ({
    openPopup,
    openOptions,
  }) => {
    const { options } = await openOptionsOnSecurity(openPopup, openOptions);
    const passwordPrompt = options.getByRole("heading", {
      name: "Confirm with your password",
    });

    const slider = options.getByRole("slider", { name: AUTO_LOCK_LABEL });
    const thumb = await slider.boundingBox();
    const track = await options
      .locator('[data-slot="slider-track"]')
      .first()
      .boundingBox();
    if (!thumb || !track) throw new Error("slider not laid out");

    const y = thumb.y + thumb.height / 2;
    const at = (fraction: number) => track.x + track.width * fraction;

    await options.mouse.move(thumb.x + thumb.width / 2, y);
    await options.mouse.down();

    // Forward, well past where we intend to land.
    await options.mouse.move(at(0.9), y, { steps: 12 });
    await expect(passwordPrompt).toHaveCount(0);
    const atFarEnd = Number(await slider.getAttribute("aria-valuenow"));
    expect(atFarEnd).toBeGreaterThan(AUTO_LOCK_BOUNDS.default);

    // ...and back again. Overshooting and correcting is the whole point.
    await options.mouse.move(at(0.5), y, { steps: 12 });
    await expect(passwordPrompt).toHaveCount(0);
    const beforeRelease = Number(await slider.getAttribute("aria-valuenow"));
    expect(beforeRelease).toBeLessThan(atFarEnd);

    await options.mouse.up();

    // One prompt, and it names where the thumb was let go - not the first step.
    await expect(passwordPrompt).toBeVisible();
    await expect(
      options.getByText(
        `Change the auto-lock timeout to ${beforeRelease} minutes.`
      )
    ).toBeVisible();
  });

  /**
   * Cancelling mid-drag-value must put the thumb back. The draft state added
   * above is the only thing showing the new value, so if it outlived a refused
   * commit the slider would sit there claiming a timeout the vault is not
   * using - the most dangerous way for this particular control to be wrong.
   */
  test("cancelling a dragged change returns the thumb to the stored value", async ({
    openPopup,
    openOptions,
  }) => {
    const { options } = await openOptionsOnSecurity(openPopup, openOptions);
    const stored = (await currentSettings(options)).autoLockMinutes;

    const slider = options.getByRole("slider", { name: AUTO_LOCK_LABEL });
    const thumb = await slider.boundingBox();
    const track = await options
      .locator('[data-slot="slider-track"]')
      .first()
      .boundingBox();
    if (!thumb || !track) throw new Error("slider not laid out");

    const y = thumb.y + thumb.height / 2;
    await options.mouse.move(thumb.x + thumb.width / 2, y);
    await options.mouse.down();
    await options.mouse.move(track.x + track.width * 0.7, y, { steps: 12 });
    await options.mouse.up();

    await expect(
      options.getByRole("heading", { name: "Confirm with your password" })
    ).toBeVisible();
    await options.getByRole("button", { name: "Cancel" }).click();

    await expect(slider).toHaveAttribute("aria-valuenow", String(stored));
    expect((await currentSettings(options)).autoLockMinutes).toBe(stored);
  });


  /**
   * The quick flick, which the first fix did not survive.
   *
   * Radix decides a drag changed something by comparing the controlled value in
   * its `onSlideEnd` closure against the value at slide start. React treats
   * `pointermove` as continuous priority and `pointerup` as discrete, so a fast
   * gesture delivers the release before the render carrying the moved value has
   * committed: both sides of that comparison read as the starting value and the
   * commit is skipped. Meanwhile the thumb, driven by a draft written
   * synchronously, has already moved - so the slider sat there showing a
   * timeout the vault was not using, silently, until the user dragged again.
   *
   * Dispatching the move and the release in one task reproduces that exactly;
   * Playwright's own mouse leaves a gap between events wide enough for React to
   * render, so an ordinary `mouse.move` + `mouse.up` cannot catch this.
   */
  test("a flick that outruns React still asks, and asks once", async ({
    openPopup,
    openOptions,
  }) => {
    const { options } = await openOptionsOnSecurity(openPopup, openOptions);
    const stored = (await currentSettings(options)).autoLockMinutes;

    // CSS, not role: the dialog aria-hides the page behind it, so a role-based
    // locator stops resolving the moment the prompt opens.
    const thumb = options.locator('[data-slot="slider-thumb"]').first();
    await expect(thumb).toHaveAttribute("aria-valuenow", String(stored));

    await options.evaluate(() => {
      const el = document.querySelector(
        '[data-slot="slider-thumb"]'
      ) as HTMLElement;
      const track = document.querySelector(
        '[data-slot="slider-track"]'
      ) as HTMLElement;

      // Pointer capture needs a real pointer behind it; stubbing these sends
      // the dispatched events down the same path a hardware drag takes.
      el.setPointerCapture = () => {};
      el.releasePointerCapture = () => {};
      el.hasPointerCapture = () => true;

      const rect = track.getBoundingClientRect();
      const clientY = rect.top + rect.height / 2;
      const fire = (type: string, clientX: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: "mouse",
            clientX,
            clientY,
            buttons: type === "pointerup" ? 0 : 1,
          })
        );

      const box = el.getBoundingClientRect();
      const target = rect.left + rect.width * (6 / 59);
      fire("pointerdown", box.left + box.width / 2);
      // No await between these two: that is the whole point.
      fire("pointermove", target);
      fire("pointerup", target);
    });

    // Read from out here, not inside the evaluate: in there the render carrying
    // the move has not happened yet, which is the very condition under test.
    const landedOn = Number(await thumb.getAttribute("aria-valuenow"));
    expect(landedOn).not.toBe(stored);

    // Exactly one prompt, for where the thumb actually is.
    await expect(
      options.getByRole("heading", { name: "Confirm with your password" })
    ).toHaveCount(1);
    await expect(
      options.getByText(`Change the auto-lock timeout to ${landedOn} minutes.`)
    ).toBeVisible();

    await options.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await options.getByRole("button", { name: "Confirm" }).click();

    await expect
      .poll(async () => (await currentSettings(options)).autoLockMinutes)
      .toBe(landedOn);
  });

  /**
   * Key export does not exist, and is not shown. A disabled "Export Private
   * Key" button used to sit here as a placeholder; a half-built export that
   * appeared to work would be the worst possible bug in this product, and a
   * dead button is a promise the surface cannot keep. If it ever arrives it
   * must bring its own tests, and this failing is the reminder. Password
   * change arrived that way, with the test below.
   */
  test("does not offer key export yet", async ({ openPopup, openOptions }) => {
    const { options } = await openOptionsOnSecurity(openPopup, openOptions);

    await expect(
      options.getByRole("button", { name: "Export Private Key" })
    ).toHaveCount(0);
  });
  test("changes the master password: the old one stops working and every key opens under the new one", async ({
    openPopup,
    openOptions,
  }) => {
    const NEW_PASSWORD = "Lichen-Harbour-Quill-2026";
    const { popup, options } = await openOptionsOnSecurity(openPopup, openOptions);
    await sendExtensionRpc(popup, {
      type: "vault.import",
      keyInput: "0000000000000000000000000000000000000000000000000000000000000007",
      password: TEST_PASSWORD,
      label: "Second key",
    });
    const before = await sendExtensionRpc<Array<{ id: string; pubkey: string }>>(popup, {
      type: "keys.list",
    });
    expect(before).toHaveLength(2);

    await options.getByRole("button", { name: "Change password", exact: true }).click();
    const dialog = options.getByRole("dialog");
    await dialog.getByLabel("Current password", { exact: true }).fill(TEST_PASSWORD);
    await dialog.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await dialog.getByLabel("Confirm new password", { exact: true }).fill(NEW_PASSWORD);
    await dialog.getByRole("button", { name: "Change password", exact: true }).click();

    await expect(dialog.getByTestId("change-password-success")).toBeVisible({
      timeout: 15_000,
    });
    await expect(dialog).toContainText(/backup files keep the passphrase/i);
    // The session carries on after the change.
    expect(
      (await sendExtensionRpc<{ isLocked: boolean }>(popup, { type: "state.getLock" }))
        .isLocked
    ).toBe(false);
    await dialog.getByRole("button", { name: "Done" }).click();

    await sendExtensionRpc(popup, { type: "vault.lock" });
    const oldAttempt = await popup.evaluate(
      (password) =>
        new Promise<{ ok: boolean; error?: { data?: { errorCode?: string } } }>((resolve) =>
          (globalThis as any).chrome.runtime.sendMessage(
            { type: "vault.unlock", password },
            resolve
          )
        ),
      TEST_PASSWORD
    );
    expect(oldAttempt.ok).toBe(false);
    expect(oldAttempt.error?.data?.errorCode).toBe("invalid_password");

    const unlocked = await sendExtensionRpc<{
      unlockedKeyIds: string[];
      damagedKeyIds: string[];
    }>(popup, { type: "vault.unlock", password: NEW_PASSWORD });
    expect(unlocked.unlockedKeyIds.sort()).toEqual(before.map((k) => k.id).sort());
    expect(unlocked.damagedKeyIds).toEqual([]);
    const after = await sendExtensionRpc<Array<{ pubkey: string }>>(popup, {
      type: "keys.list",
    });
    expect(after.map((k) => k.pubkey).sort()).toEqual(before.map((k) => k.pubkey).sort());
  });
});
