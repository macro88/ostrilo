import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import {
  seedUnlockedVault,
  sendExtensionRpc,
  TEST_PASSWORD,
} from "./fixtures/agent";

/**
 * Living with more than one identity.
 *
 * Every screen in this journey answers the same question - WHICH key is about
 * to sign - and each one answers it from a different source: the header
 * dropdown and the settings list from `keys` in KeyManagerContext, the home
 * screen from `selectedKeyInfo`, and the background from
 * `settings.selectedKeyId`. A switch that moves some of those and not others is
 * not a cosmetic defect: the user reads one surface and a different key signs.
 *
 * The two authority decisions here are deliberately asymmetric, and both are
 * asserted:
 *  - renaming is NOT password-gated. A label is local bookkeeping, and asking
 *    for the master password to fix a typo teaches the user to type it
 *    whenever something asks.
 *  - deleting IS password-gated, in the BACKGROUND, because for a key that was
 *    never backed up the deletion destroys the identity. The confirm dialog is
 *    a courtesy; `requireReauth` is the control, so the RPC is also driven
 *    directly here to prove that skipping the UI does not skip the gate.
 *
 * These tests run headless. The file previously claimed they needed a headed
 * browser and manual interaction; nothing in the journey does.
 */

interface StoredKey {
  id: string;
  label?: string;
  pubkey: string;
  npub?: string;
  isSelected?: boolean;
}

function listStoredKeys(page: Page): Promise<StoredKey[]> {
  return sendExtensionRpc<StoredKey[]>(page, { type: "keys.list" });
}

/** How `<Pubkey>` renders an npub on the home screen: 8 leading, 6 trailing. */
function homeNpub(npub: string): string {
  return `${npub.slice(0, 8)}…${npub.slice(-6)}`;
}

/** How KeySelector builds an option's accessible name: 12 leading, 4 trailing. */
function optionName(key: StoredKey): string {
  const npub = key.npub ?? "";
  return `${key.label} - ${npub.slice(0, 12)}...${npub.slice(-4)}`;
}

async function seedVault(popup: Page, label: string): Promise<void> {
  await seedUnlockedVault(popup, { label });
  // Both key surfaces hydrate their display names through `profile.get`, which
  // on a cache miss opens a real WebSocket to a configured relay. Nothing in
  // this journey needs relay data, and that connection is the one thing here
  // that could fail for a reason unrelated to key management, so the relay
  // list is emptied. Every surface then falls back to the local label, which
  // is what these tests read.
  await sendExtensionRpc(popup, {
    type: "settings.update",
    patch: { relays: [] },
  });
}

/**
 * Adds keys and puts the vault back into the state a returning user has.
 *
 * The relock is load-bearing, not tidiness. `generateKey` seals the new record
 * and zeroizes the secret; it never puts the key into the vault's in-memory
 * unlocked map. Only `unlock` populates that map, so without this cycle a
 * vault holding three keys holds exactly one key's material - and
 * `getLockState` locks the vault the moment that one entry goes away. Locking
 * and unlocking is what any real second session does, and it is the only way
 * to reach a vault that genuinely holds every key it lists.
 */
async function addKeys(page: Page, labels: string[]): Promise<void> {
  for (const label of labels) {
    await sendExtensionRpc(page, {
      type: "vault.generate",
      password: TEST_PASSWORD,
      label,
    });
  }
  await sendExtensionRpc(page, { type: "vault.lock" });
  await sendExtensionRpc(page, { type: "vault.unlock", password: TEST_PASSWORD });
}

/**
 * A surface reads the key list once, on mount, and nothing pushes changes to
 * it. A key added or renamed over RPC is real immediately but invisible until
 * the page re-reads, so tests reload rather than pretend the UI noticed.
 */
async function reloadHome(popup: Page, activeLabel: string): Promise<void> {
  await popup.reload();
  await expect(
    popup.getByRole("heading", { level: 2, name: activeLabel })
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * The dropdown's accessible name is "Select active key", not the "Available
 * keys" its `aria-label` asks for: Radix points the content's
 * `aria-labelledby` at the trigger, and `aria-labelledby` wins. Naming it
 * anything else here matches nothing, and a selector that matches nothing
 * passes every assertion that follows it.
 */
function keySelector(popup: Page) {
  return {
    trigger: popup.getByRole("button", { name: "Select active key" }),
    listbox: popup.getByRole("listbox", { name: "Select active key" }),
  };
}

async function openKeysTab(options: Page) {
  await expect(
    options.getByRole("heading", { name: "Ostrilo Settings" })
  ).toBeVisible({ timeout: 15_000 });
  await options.getByRole("tab", { name: "Keys & Identities" }).click();
  await expect(
    options.getByRole("heading", { name: "Keys & Identities" })
  ).toBeVisible();
  return options
    .getByRole("list", { name: "Manage your Nostr keys" })
    .getByRole("listitem");
}

test.describe("Multi-Key Selector", () => {
  test("adds a second key from the header and switches the active identity", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    await seedVault(popup, "Personal");

    const [personal] = await listStoredKeys(popup);
    await expect(popup.getByLabel("Public key display")).toContainText(
      homeNpub(personal.npub!)
    );

    const { trigger, listbox } = keySelector(popup);
    await trigger.click();
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("option")).toHaveCount(1);

    await popup.getByRole("menuitem", { name: "Add new key" }).click();

    const addDialog = popup.getByRole("dialog");
    await expect(
      addDialog.getByRole("heading", { name: "Add New Key" })
    ).toBeVisible();
    await addDialog.getByRole("button", { name: "Create New Key" }).click();
    // The vault password is re-entered even though the vault is unlocked. The
    // form holds it in a ref and clears it, so nothing long-lived carries it.
    await addDialog.getByLabel("Vault Password").fill(TEST_PASSWORD);
    await addDialog.getByLabel("Key Name").fill("Work");
    await addDialog.getByRole("button", { name: "Create Key" }).click();
    // Submitting flips KeyManagerContext.isLoading, and MainApp answers that by
    // replacing the whole tree with an "Opening Ostrilo..." spinner - which
    // unmounts the dialog the form was submitted from. "The dialog is gone" is
    // therefore NOT evidence that anything was created, so the vault is asked
    // directly and the app is given until the KDF finishes to come back.
    await expect
      .poll(async () => (await listStoredKeys(popup)).length, {
        timeout: 15_000,
      })
      .toBe(2);

    const stored = await listStoredKeys(popup);
    expect(stored.map((k) => k.label)).toEqual(["Personal", "Work"]);
    const work = stored[1];
    expect(work.pubkey).not.toBe(personal.pubkey);

    // Adding a key does NOT hand it the signing seat.
    // docs/managing-multiple-keys.md says "The new key is automatically
    // selected"; the vault only auto-selects when it had no keys at all. The
    // shipped behaviour is the safer one - a key arrives without silently
    // changing who signs next - so it is asserted rather than left to drift.
    await expect(
      popup.getByRole("heading", { level: 2, name: "Personal" })
    ).toBeVisible({ timeout: 15_000 });
    await expect(addDialog).toBeHidden();

    await trigger.click();
    await expect(listbox.getByRole("option")).toHaveCount(2);
    await listbox.getByRole("option", { name: optionName(work) }).click();
    await expect(listbox).toBeHidden();

    // The home screen is what a user reads before signing, so it has to show
    // the new npub and not merely the new label. Two identities with the same
    // label are indistinguishable; two npubs never are.
    await expect(
      popup.getByRole("heading", { level: 2, name: "Work" })
    ).toBeVisible();
    const homeKey = popup.getByLabel("Public key display");
    await expect(homeKey).toContainText(homeNpub(work.npub!));
    await expect(homeKey).not.toContainText(homeNpub(personal.npub!));

    // And the background agrees with the screen.
    const selectedAfter = (await listStoredKeys(popup)).find((k) => k.isSelected);
    expect(selectedAfter?.label).toBe("Work");
  });

  test("lists every key and marks exactly one as selected", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    await seedVault(popup, "Personal");
    await addKeys(popup, ["Work", "Anon"]);
    await reloadHome(popup, "Personal");

    const stored = await listStoredKeys(popup);
    expect(stored).toHaveLength(3);

    const { trigger, listbox } = keySelector(popup);
    await trigger.click();
    await expect(listbox.getByRole("option")).toHaveCount(3);

    // Each key with its OWN npub beside its own label. A dropdown that listed
    // three rows all carrying the active key's npub would look perfectly fine.
    for (const key of stored) {
      await expect(
        listbox.getByRole("option", { name: optionName(key) })
      ).toBeVisible();
    }

    const selected = listbox.getByRole("option", { selected: true });
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveAttribute(
      "aria-label",
      `${optionName(stored[0])} (currently selected)`
    );
  });

  test("opens, moves and closes with the keyboard", async ({ openPopup }) => {
    const popup = await openPopup();
    await seedVault(popup, "Personal");
    await addKeys(popup, ["Work"]);
    await reloadHome(popup, "Personal");

    const { trigger, listbox } = keySelector(popup);

    const options = listbox.getByRole("option");

    // Escape must close the menu and leave the active identity alone. A menu
    // that committed the highlighted row on dismiss would change who signs by
    // accident, and the only visible difference is a truncated npub.
    await trigger.focus();
    await popup.keyboard.press("Enter");
    await expect(listbox).toBeVisible();
    // Opening with the keyboard puts focus on the first key. Waiting for that
    // rather than firing arrow keys at a menu that may still be mounting is
    // also what keeps this test from passing for the wrong reason: a keypress
    // that lands nowhere leaves the active key unchanged, which is exactly
    // what a working Escape looks like.
    await expect(options.first()).toBeFocused();

    await popup.keyboard.press("Escape");
    await expect(listbox).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(
      popup.getByRole("heading", { level: 2, name: "Personal" })
    ).toBeVisible();

    await popup.keyboard.press("Enter");
    await expect(options.first()).toBeFocused();
    await popup.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toBeFocused();
    await popup.keyboard.press("Enter");
    await expect(listbox).toBeHidden();
    await expect(
      popup.getByRole("heading", { level: 2, name: "Work" })
    ).toBeVisible();
  });

  test("the active key survives closing and reopening the popup", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    await seedVault(popup, "Personal");
    await addKeys(popup, ["Work"]);
    await reloadHome(popup, "Personal");

    const work = (await listStoredKeys(popup)).find((k) => k.label === "Work")!;

    const { trigger, listbox } = keySelector(popup);
    await trigger.click();
    await listbox.getByRole("option", { name: optionName(work) }).click();
    await expect(
      popup.getByRole("heading", { level: 2, name: "Work" })
    ).toBeVisible();

    // A popup is destroyed every time it loses focus. A selection that lived
    // only in React state would revert to the first key before the next
    // signature, without the user touching anything.
    await popup.close();
    const reopened = await openPopup();
    await expect(
      reopened.getByRole("heading", { level: 2, name: "Work" })
    ).toBeVisible({ timeout: 15_000 });
    await expect(reopened.getByLabel("Public key display")).toContainText(
      homeNpub(work.npub!)
    );
  });
});

test.describe("Settings - Key Management", () => {
  test("lists every key and Set Active moves the badge and the vault", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedVault(popup, "Personal");
    await addKeys(popup, ["Work"]);

    const options = await openOptions();
    const rows = await openKeysTab(options);
    await expect(rows).toHaveCount(2);

    const personalRow = rows.filter({ hasText: "Personal" });
    const workRow = rows.filter({ hasText: "Work" });

    // Exact, because the inactive row carries a "Set Active" button: a
    // substring match on "Active" is true of every row and proves nothing.
    await expect(personalRow.getByText("Active", { exact: true })).toBeVisible();
    await expect(workRow.getByText("Active", { exact: true })).toHaveCount(0);

    await workRow.getByRole("button", { name: "Set Active" }).click();
    await expect(workRow.getByText("Active", { exact: true })).toBeVisible();
    await expect(personalRow.getByText("Active", { exact: true })).toHaveCount(0);

    // The badge is styling. This is the vault's own answer to the question the
    // badge claims to be answering.
    await expect
      .poll(async () =>
        (await listStoredKeys(options)).find((k) => k.isSelected)?.label
      )
      .toBe("Work");
  });

  test("renaming a key needs no password and the label follows the key", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedVault(popup, "Personal");
    await addKeys(popup, ["Work"]);

    const options = await openOptions();
    const rows = await openKeysTab(options);

    await rows
      .filter({ hasText: "Personal" })
      .getByRole("button", { name: "Rename Personal" })
      .click();
    const labelInput = options.getByPlaceholder("Enter label");
    await expect(labelInput).toHaveValue("Personal");
    await labelInput.fill("Daily Driver");
    await options.getByRole("button", { name: "Save label for Personal" }).click();

    // The vault's copy, not the row's text: a row can show an optimistic value
    // that was never written.
    await expect
      .poll(async () => (await listStoredKeys(options)).map((k) => k.label))
      .toEqual(["Daily Driver", "Work"]);

    // Deliberately NOT password-gated, and this is checked only after the
    // rename has demonstrably landed - asserting "no dialog" before the write
    // completes would pass on a page that was about to show one.
    await expect(
      options.getByRole("heading", { name: "Confirm with your password" })
    ).toHaveCount(0);

    // DEFECT, pinned deliberately. `KeysIdentitiesTab.handleRename` calls the
    // rename RPC and never refreshes the key list, and nothing broadcasts key
    // changes, so the row keeps rendering the old label until the page is
    // reloaded. The user's evidence that a rename worked is the label they can
    // see, and here it says the rename did nothing. When the tab refreshes
    // after a rename, delete these two assertions - do not weaken the reload
    // assertions below, which are what the rename is actually for.
    await expect(rows.filter({ hasText: "Personal" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Daily Driver" })).toHaveCount(0);

    await options.reload();
    const refreshedRows = await openKeysTab(options);
    await expect(refreshedRows.filter({ hasText: "Daily Driver" })).toHaveCount(1);
    await expect(refreshedRows.filter({ hasText: "Personal" })).toHaveCount(0);

    // The renamed key is the active one, so the popup's identity header is the
    // other surface a rename has to reach.
    await reloadHome(popup, "Daily Driver");
  });

  test("deleting a key is password gated and a wrong password refuses", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedVault(popup, "Personal");
    await addKeys(popup, ["Burner"]);

    const options = await openOptions();
    // KeySelectorCard confirms through window.confirm, which Playwright
    // dismisses unless something accepts it.
    options.on("dialog", (dialog) => void dialog.accept());
    const rows = await openKeysTab(options);

    const burner = (await listStoredKeys(options)).find(
      (k) => k.label === "Burner"
    )!;

    // The control is `requireReauth` at the message boundary, not the dialog.
    // A caller that sends the message itself - which is what an attacker with
    // the device does rather than clicking through a modal - is refused.
    await expect(
      sendExtensionRpc(options, { type: "vault.deleteKey", id: burner.id })
    ).rejects.toThrow(/invalid_password/);
    expect(await listStoredKeys(options)).toHaveLength(2);

    await rows
      .filter({ hasText: "Burner" })
      .getByRole("button", { name: "Delete Burner" })
      .click();

    const reauth = options.getByRole("dialog");
    await expect(
      reauth.getByRole("heading", { name: "Confirm with your password" })
    ).toBeVisible();
    // The prompt names the key and the consequence. "Are you sure?" over an
    // unnamed key is how the wrong identity gets destroyed.
    await expect(reauth).toContainText("Delete “Burner”.");
    await expect(reauth).toContainText("the identity is gone for good");

    await reauth.getByLabel("Password", { exact: true }).fill("not-the-password");
    await reauth.getByRole("button", { name: "Confirm" }).click();
    await expect(
      reauth.getByText(/^Incorrect password/)
    ).toBeVisible();
    expect(
      await listStoredKeys(options),
      "SECURITY REGRESSION: a wrong password deleted a key"
    ).toHaveLength(2);

    // The page must not have echoed the attempt back into the document.
    expect(await options.textContent("body")).not.toContain("not-the-password");

    await reauth.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await reauth.getByRole("button", { name: "Confirm" }).click();
    await expect(reauth).toBeHidden();

    await expect
      .poll(async () => (await listStoredKeys(options)).map((k) => k.label))
      .toEqual(["Personal"]);

    // Same stale-list defect as the rename: the deleted key keeps its row
    // until the page re-reads. Reload and confirm it is gone for real.
    await options.reload();
    const refreshedRows = await openKeysTab(options);
    await expect(refreshedRows).toHaveCount(1);
    await expect(refreshedRows.filter({ hasText: "Burner" })).toHaveCount(0);
  });

  test("deleting the active key promotes the first remaining key", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedVault(popup, "Personal");
    await addKeys(popup, ["Work", "Anon"]);

    const options = await openOptions();
    options.on("dialog", (dialog) => void dialog.accept());
    const rows = await openKeysTab(options);
    await expect(rows).toHaveCount(3);

    await rows
      .filter({ hasText: "Personal" })
      .getByRole("button", { name: "Delete Personal" })
      .click();
    const reauth = options.getByRole("dialog");
    await reauth.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await reauth.getByRole("button", { name: "Confirm" }).click();
    await expect(reauth).toBeHidden();

    // The vault never leaves itself pointing at a deleted record: the first
    // survivor is promoted. A dangling `selectedKeyId` would fail the next
    // signature with "no key selected" and give the user nothing to act on.
    await expect
      .poll(async () => {
        const keys = await listStoredKeys(options);
        return keys.map((k) => `${k.label}${k.isSelected ? "*" : ""}`);
      })
      .toEqual(["Work*", "Anon"]);

    // And the promotion reaches both surfaces once they re-read.
    await reloadHome(popup, "Work");
    await options.reload();
    const refreshedRows = await openKeysTab(options);
    await expect(refreshedRows).toHaveCount(2);
    await expect(
      refreshedRows
        .filter({ hasText: "Work" })
        .getByText("Active", { exact: true })
    ).toBeVisible();
  });

  test("deleting the session's only unlocked key locks the vault", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedVault(popup, "Personal");
    // No relock here, deliberately: this is the state after adding a key
    // mid-session. `generateKey` never adds the new key to the vault's
    // in-memory unlocked map, so the vault ends up holding two records and
    // exactly ONE key's material - the one the unlock loaded.
    await sendExtensionRpc(popup, {
      type: "vault.generate",
      password: TEST_PASSWORD,
      label: "Second",
    });

    const options = await openOptions();
    options.on("dialog", (dialog) => void dialog.accept());
    const rows = await openKeysTab(options);

    await rows
      .filter({ hasText: "Personal" })
      .getByRole("button", { name: "Delete Personal" })
      .click();
    const reauth = options.getByRole("dialog");
    await reauth.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await reauth.getByRole("button", { name: "Confirm" }).click();
    await expect(reauth).toBeHidden();

    // DEFECT, pinned deliberately: deleting that one key empties the unlocked
    // map, and `getLockState` reads an empty map as an evicted worker and
    // locks the vault. Failing closed is the right reflex - a vault that
    // reports itself open while holding no key material is the bug that gate
    // exists to catch - but the user's actual experience is that removing a
    // spare identity threw them back to the password prompt. The fix belongs
    // in `generateKey`/`importKey`, which should register the new key with the
    // unlocked session; when it lands, this test should assert that deleting
    // one key of several leaves the vault open.
    await expect
      .poll(async () =>
        sendExtensionRpc<{ isLocked: boolean }>(popup, { type: "state.getLock" })
          .then((s) => s.isLocked)
      )
      .toBe(true);

    await expect(
      popup.getByRole("heading", { name: "Ostrilo is Locked" })
    ).toBeVisible({ timeout: 15_000 });

    // The deletion itself still committed, and the survivor was promoted.
    // Labels and npubs are redacted while locked, so this is read after
    // unlocking - which is also proof that the vault is not bricked.
    await sendExtensionRpc(popup, {
      type: "vault.unlock",
      password: TEST_PASSWORD,
    });
    const keys = await listStoredKeys(popup);
    expect(keys.map((k) => `${k.label}${k.isSelected ? "*" : ""}`)).toEqual([
      "Second*",
    ]);
  });

  test("the last remaining key cannot be deleted", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedVault(popup, "Only Key");

    const options = await openOptions();
    const rows = await openKeysTab(options);
    await expect(rows).toHaveCount(1);

    await expect(
      rows.getByRole("button", { name: "Delete Only Key" })
    ).toBeDisabled();

    // And the refusal is the vault's, not the button's. A `disabled`
    // attribute is one line in devtools away from gone, and a vault with zero
    // keys cannot be unlocked back into existence.
    const [only] = await listStoredKeys(options);
    await expect(
      sendExtensionRpc(options, {
        type: "vault.deleteKey",
        id: only.id,
        password: TEST_PASSWORD,
      })
    ).rejects.toThrow(/invalid_params/);
    expect(await listStoredKeys(options)).toHaveLength(1);
  });
});

/**
 * Importing a key into a vault that already exists.
 *
 * This is a different component from onboarding import — `ImportKeyForm`, not
 * `OnboardingImportKey` — and it has deliberately different password
 * semantics. Adding a key re-enters the EXISTING vault password, so
 * `enforceNewPasswordPolicy` returns early rather than judging it
 * (`vault-rpc.ts:92-100`). The reason is in the source: running a new-password
 * policy here would tell a pre-existing user that their own correct password is
 * invalid, with no change-password flow to escape through.
 *
 * That early return had no test. It is the kind of branch that looks like a
 * missing check rather than a deliberate one, and so is exactly the kind that
 * gets "fixed" into a lockout.
 */
test.describe("import into an existing vault", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("takes the existing vault password, and refuses a wrong one", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedVault(popup, "Primary Key");

    const options = await openOptions();
    await options.setViewportSize({ width: 1280, height: 900 });
    await openKeysTab(options);

    const before = await sendExtensionRpc<Array<{ id: string }>>(options, {
      type: "keys.list",
    });

    await options.getByRole("button", { name: "Add Key", exact: true }).click();
    await options
      .getByRole("button", { name: "Import Existing Key" })
      .click();
    await expect(options.getByLabel("Vault Password")).toBeVisible();

    // A known-answer vector, so the derived identity is checked against a value
    // this codebase did not produce. NIP-19's example key.
    const NSEC =
      "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";

    await options.getByLabel("Private Key (nsec or hex)").fill(NSEC);
    await options.getByLabel("Key Name").fill("Imported Key");
    await options.getByLabel("Vault Password").fill("not-the-vault-password");
    await options
      .getByRole("button", { name: /Import/i })
      .last()
      .click();

    // A wrong password cannot open the envelope, so no key is added and the
    // dialog stays open on the password field.
    //
    // Asserted behaviourally rather than on the error element: ImportKeyForm
    // renders its failure as a bare <p class="text-destructive"> with no
    // role="alert" and no aria-live, so a screen reader is never told the
    // import failed. Worth fixing; asserting on role="alert" here would have
    // encoded the bug as the expectation.
    await expect(options.getByLabel("Vault Password")).toBeVisible();
    const afterWrong = await sendExtensionRpc<Array<{ id: string }>>(options, {
      type: "keys.list",
    });
    expect(afterWrong.length).toBe(before.length);

    // The correct existing password succeeds — and notably is NOT judged
    // against the new-vault password policy.
    await options.getByLabel("Vault Password").fill(TEST_PASSWORD);
    await options
      .getByRole("button", { name: /Import/i })
      .last()
      .click();

    await expect
      .poll(async () => {
        const keys = await sendExtensionRpc<Array<{ id: string }>>(options, {
          type: "keys.list",
        });
        return keys.length;
      }, { timeout: 15_000 })
      .toBe(before.length + 1);
  });
});
