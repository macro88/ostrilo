import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import {
  seedUnlockedVault,
  sendExtensionRpc,
  openDapp,
  resolveNextApproval,
  DAPP_ORIGIN,
  TEST_PASSWORD,
} from "./fixtures/agent";

/**
 * Per-origin policy editing, driven through the Settings UI.
 *
 * The permissions surface is the only place a user can see, or take back,
 * what a site is allowed to make the signer do. Every other spec in this
 * suite reaches policy over RPC, which is the seam an attacker does not
 * have: a page cannot call `policy.setOrigin`. These tests go the other
 * way, through the options page, because the properties that matter here
 * are properties OF THE UI -
 *
 *   - a site is listed once, and only once, it has a stored policy;
 *   - an edit made in Settings is the edit the background enforces;
 *   - the password gate on `high` trust and on a session grant is real in
 *     the UI too, not only in the RPC layer a user never touches;
 *   - Remove actually revokes, rather than hiding a record that keeps
 *     answering for the site.
 *
 * `protected-kind-policy.spec.ts` and `remembered-site-signing-policy.spec.ts`
 * cover the per-kind ladder and the remembered-approval path; nothing here
 * repeats them.
 */

type PolicyDecision = { mode: string; reason: string };

type StoredOrigin = {
  origin: string;
  trustLevel?: string;
  rules?: Record<string, string>;
  identityDisclosure?: string;
};

type SignOutcome =
  | { success: true; signed: { kind: number; sig: string } }
  | { success: false; error: string };

type DisclosureOutcome = { ok: boolean; value?: string; error?: string };

/**
 * What the background will actually do for this origin and kind. Asserting
 * on it rather than on the stored record is the point: a settings screen
 * that writes a field nothing reads is the defect being guarded against.
 */
async function decisionFor(page: Page, kind: number): Promise<PolicyDecision> {
  return sendExtensionRpc<PolicyDecision>(page, {
    type: "policy.evaluate",
    origin: DAPP_ORIGIN,
    kind,
  });
}

async function storedOrigin(page: Page): Promise<StoredOrigin | undefined> {
  const settings = await sendExtensionRpc<{ origins: StoredOrigin[] }>(page, {
    type: "settings.get",
  });
  return settings.origins.find((o) => o.origin === DAPP_ORIGIN);
}

async function storedTrust(page: Page): Promise<string | undefined> {
  return (await storedOrigin(page))?.trustLevel;
}

async function liveSessionGrants(page: Page) {
  return sendExtensionRpc<Array<{ origin: string; expiresAt: number }>>(page, {
    type: "policy.getSessionGrants",
  });
}

async function pendingRequests(page: Page) {
  const { requests } = await sendExtensionRpc<{
    requests: Array<{ id: string; origin: string; operation: string }>;
  }>(page, { type: "approval.getAll" });
  return requests;
}

/** Opens the options page on the Permissions tab at a desktop width. */
async function openPermissionsTab(
  openOptions: () => Promise<Page>
): Promise<Page> {
  const options = await openOptions();
  await options.setViewportSize({ width: 1100, height: 940 });
  await options.getByRole("tab", { name: "Permissions" }).click();
  await expect(
    options.getByRole("heading", { name: "Permissions" })
  ).toBeVisible();
  return options;
}

function trustControl(options: Page) {
  return options.getByTestId(`origin-trust-${DAPP_ORIGIN}`);
}

function reauthDialog(options: Page) {
  return options.getByRole("dialog");
}

async function confirmReauth(options: Page, password: string) {
  const dialog = reauthDialog(options);
  await dialog.getByLabel("Password", { exact: true }).fill(password);
  await dialog.getByRole("button", { name: "Confirm" }).click();
}

function signFromDapp(
  dapp: Page,
  kind: number,
  content: string
): Promise<SignOutcome> {
  return dapp.evaluate(
    async ({ kind, content }) => {
      try {
        const signed = await window.testSignEvent({
          kind,
          content,
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
        });
        return { success: true as const, signed };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    { kind, content }
  );
}

/**
 * Asks for the public key WITHOUT awaiting, so the prompt it raises can be
 * inspected while the page is still blocked on it.
 */
async function askForPublicKey(dapp: Page): Promise<void> {
  await dapp.evaluate(() => {
    (globalThis as any).__pubkeyAttempt = window
      .testGetPublicKey()
      .then((value: string) => ({ ok: true, value }))
      .catch((error: Error) => ({ ok: false, error: error.message }));
  });
}

async function readPublicKeyAttempt(dapp: Page): Promise<DisclosureOutcome> {
  return dapp.evaluate(
    () => (globalThis as any).__pubkeyAttempt as Promise<DisclosureOutcome>
  );
}

test.describe("Settings - per-origin policy", () => {
  // Each journey drives the options page, a dApp page and the approval queue
  // inside one extension context, and the suite shares a machine with other
  // browser runs. Playwright's 30s default leaves no headroom for that, and
  // the resulting failure reads as a stuck UI rather than as a busy machine.
  test.beforeEach(() => {
    test.setTimeout(90_000);
  });

  test("removing an origin takes it off the list and returns the site to unknown", async ({
    openPopup,
    openOptions,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const options = await openPermissionsTab(openOptions);

    // The site is listed because a decision about it was recorded - seeding
    // grants identity disclosure. Nothing else puts an origin on this list;
    // there is no "add a site" control, by design.
    await expect(options.getByText(DAPP_ORIGIN).first()).toBeVisible();
    await expect(
      options.getByTestId(`origin-disclosure-${DAPP_ORIGIN}`)
    ).toContainText("This site can read your public key");

    // Baseline. This is also the first `policy.evaluate` of the run, which
    // is what forces the one-shot consent migration to persist its marker
    // before any trust level is edited - without it the migration can run
    // later and rewrite a level the user just chose.
    expect(await decisionFor(popup, 7)).toEqual({
      mode: "ask",
      reason: "trust",
    });

    // The remove button confirms with window.confirm, which Playwright
    // dismisses unless a handler says otherwise.
    options.once("dialog", (dialog) => void dialog.accept());
    await options.getByRole("button", { name: "Remove origin" }).click();

    await expect(
      options.getByRole("heading", { name: "No Origins Configured" })
    ).toBeVisible();
    await expect.poll(() => storedOrigin(popup)).toBeUndefined();

    // `fallback`, not `trust`: the site is now one the signer has never
    // heard of. A record that merely stopped being displayed would still
    // report `trust` here, and would still be answering for the site.
    expect(await decisionFor(popup, 7)).toEqual({
      mode: "ask",
      reason: "fallback",
    });

    // The remembered "yes, you may read my public key" went with it. This is
    // the half of a revoke that is easy to get wrong, because the identity
    // decision is stored on the same record as the signing policy but is
    // read through a different path.
    const dapp = await openDapp(extensionContext);
    await askForPublicKey(dapp);

    await expect.poll(async () => (await pendingRequests(popup)).length, {
      timeout: 10_000,
    }).toBe(1);
    const [prompt] = await pendingRequests(popup);
    expect(prompt.operation).toBe("identity_disclosure");
    expect(prompt.origin).toBe(DAPP_ORIGIN);

    // Answering the prompt writes a policy record again, and the site
    // reappears on the list. That round trip is the whole lifecycle of a
    // row on this screen.
    await resolveNextApproval(popup, "allow");
    const disclosure = await readPublicKeyAttempt(dapp);
    expect(disclosure.ok).toBe(true);
    expect(disclosure.value).toMatch(/^[0-9a-f]{64}$/);

    await expect(options.getByText(DAPP_ORIGIN).first()).toBeVisible({
      timeout: 10_000,
    });
    // Re-created untrusted. A remembered decision must never also hand the
    // origin a trust level the user was not asked about.
    await expect.poll(() => storedTrust(popup)).toBe("low");
  });

  test("changing an origin's trust level in Settings changes what it may sign", async ({
    openPopup,
    openOptions,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const options = await openPermissionsTab(openOptions);
    const trust = trustControl(options);

    await expect(
      trust.getByRole("button", { name: "Low", exact: true })
    ).toHaveAttribute("aria-pressed", "true");
    expect(await decisionFor(popup, 7)).toEqual({
      mode: "ask",
      reason: "trust",
    });

    // Medium is not password-gated: only `high` and switching a session
    // grant ON are. See PolicyRpcHandler.handleSetOrigin.
    await trust.getByRole("button", { name: "Medium", exact: true }).click();

    await expect.poll(() => storedTrust(popup)).toBe("medium");
    await expect(
      trust.getByRole("button", { name: "Medium", exact: true })
    ).toHaveAttribute("aria-pressed", "true");

    // Medium is an intersection of the configured medium list with the
    // high-trust ceiling: a reaction goes through, a mute list does not,
    // and a protected kind is untouched by any trust level.
    expect(await decisionFor(popup, 7)).toEqual({
      mode: "allow",
      reason: "trust",
    });
    expect(await decisionFor(popup, 10000)).toEqual({
      mode: "ask",
      reason: "trust",
    });
    expect(await decisionFor(popup, 1)).toEqual({
      mode: "ask",
      reason: "protected",
    });

    // The screen must report the decision the background will make, not the
    // stored rule. A preview computed separately from the engine is how a
    // settings surface starts lying.
    const reactionPreview = options.getByTestId("origin-policy-effective-7");
    await expect(reactionPreview).toContainText("Signs without asking");
    await expect(reactionPreview).toContainText("this site's trust level");

    // Observable: a reaction now signs with no prompt at all.
    const dapp = await openDapp(extensionContext);
    const silent = await signFromDapp(dapp, 7, "Medium trust signs reactions");
    expect(silent.success).toBe(true);
    if (silent.success) {
      expect(silent.signed.kind).toBe(7);
      expect(silent.signed.sig).toMatch(/^[0-9a-f]{128}$/);
    }
    expect(await pendingRequests(popup)).toHaveLength(0);

    // Lowering costs nothing - a user taking access away must not have to
    // find their password first - and it takes effect immediately.
    await trust.getByRole("button", { name: "Low", exact: true }).click();
    await expect.poll(() => storedTrust(popup)).toBe("low");
    await expect(reauthDialog(options)).toBeHidden();
    expect(await decisionFor(popup, 7)).toEqual({
      mode: "ask",
      reason: "trust",
    });

    // The same request that just signed silently now waits for a human.
    const prompted = signFromDapp(dapp, 7, "Low trust asks again");
    await expect.poll(async () => (await pendingRequests(popup)).length, {
      timeout: 10_000,
    }).toBe(1);
    await resolveNextApproval(popup, "deny");
    expect((await prompted).success).toBe(false);
  });

  test("raising an origin to high trust cannot be clicked past without the password", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const options = await openPermissionsTab(openOptions);
    const trust = trustControl(options);
    const dialog = reauthDialog(options);

    // Establishes the baseline and persists the consent-migration marker
    // before any trust edit, as in the first test.
    expect(await decisionFor(popup, 6)).toEqual({
      mode: "ask",
      reason: "trust",
    });

    // 1. Cancelling changes nothing.
    await trust.getByRole("button", { name: "High", exact: true }).click();
    await expect(
      dialog.getByRole("heading", { name: "Confirm with your password" })
    ).toBeVisible();
    await expect(dialog).toContainText(`Raise ${DAPP_ORIGIN} to high trust.`);
    // The dialog states the consequence, because "high trust" on its own
    // does not tell a user what they are about to authorise.
    await expect(dialog).toContainText(
      "It will sign the high-trust event kinds without prompting you again."
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(await storedTrust(popup)).toBe("low");
    await expect(
      trust.getByRole("button", { name: "Low", exact: true })
    ).toHaveAttribute("aria-pressed", "true");

    // 2. A wrong password is refused, and refused in the background - the
    // dialog is a convenience, not the control. If this ever passes with
    // the wrong password, an unattended unlocked session is enough to make
    // a site sign silently forever.
    await trust.getByRole("button", { name: "High", exact: true }).click();
    await confirmReauth(options, "Wrong-Password-Entirely-2026!");
    await expect(dialog.getByText(/invalid_password/)).toBeVisible({
      timeout: 10_000,
    });
    // The dialog stays up for a retry rather than dropping the user back to
    // a screen that looks unchanged for an unexplained reason. It is modal,
    // so the trust control behind it is out of the accessibility tree while
    // it is open - the record itself is the thing to check here.
    await expect(dialog).toBeVisible();
    expect(await storedTrust(popup)).toBe("low");
    expect(await decisionFor(popup, 6)).toEqual({
      mode: "ask",
      reason: "trust",
    });

    // 3. The right password, entered in the same still-open dialog, lands.
    await confirmReauth(options, TEST_PASSWORD);
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect.poll(() => storedTrust(popup)).toBe("high");
    await expect(
      trust.getByRole("button", { name: "High", exact: true })
    ).toHaveAttribute("aria-pressed", "true");

    // High trust is an allowlist, not "sign anything": a repost goes
    // through, a long-form post and every protected kind still ask.
    expect(await decisionFor(popup, 6)).toEqual({
      mode: "allow",
      reason: "trust",
    });
    expect(await decisionFor(popup, 30023)).toEqual({
      mode: "ask",
      reason: "trust",
    });
    expect(await decisionFor(popup, 1)).toEqual({
      mode: "ask",
      reason: "protected",
    });

    const repostPreview = options.getByTestId("origin-policy-effective-6");
    await expect(repostPreview).toContainText("Signs without asking");
  });

  test("a session grant taken in Settings can be cleared, and stops applying", async ({
    openPopup,
    openOptions,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const options = await openPermissionsTab(openOptions);

    // Kind 30023 is in no trust allowlist, so nothing but a session grant
    // can make it signable without a prompt. That is what makes it the
    // honest probe for whether the grant is doing anything.
    expect(await decisionFor(popup, 30023)).toEqual({
      mode: "ask",
      reason: "trust",
    });

    // The switch carries no accessible name of its own, so it is addressed
    // by role. One configured origin means exactly one switch; asserting
    // the count first means a second one can never be silently mistaken
    // for this one.
    const grant = options.getByRole("switch");
    await expect(grant).toHaveCount(1);
    await expect(grant).not.toBeChecked();

    await grant.click();
    const dialog = reauthDialog(options);
    await expect(dialog).toContainText(
      `Grant ${DAPP_ORIGIN} a signing session.`
    );
    await confirmReauth(options, TEST_PASSWORD);
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    await expect(grant).toBeChecked();
    // The switch reads live grant state from the background rather than the
    // persisted display flag, so it also has to show when the grant dies.
    await expect(options.getByText(/^expires /)).toBeVisible();
    const grants = await liveSessionGrants(popup);
    expect(grants).toHaveLength(1);
    expect(grants[0].origin).toBe(DAPP_ORIGIN);
    expect(grants[0].expiresAt).toBeGreaterThan(Date.now());

    // The broadest authority the product offers: every unprotected kind,
    // regardless of trust level. Still not the protected ones.
    expect(await decisionFor(popup, 30023)).toEqual({
      mode: "allow",
      reason: "session",
    });
    expect(await decisionFor(popup, 1)).toEqual({
      mode: "ask",
      reason: "protected",
    });

    // Clearing is free - no password - and immediate.
    await grant.click();
    await expect(grant).not.toBeChecked();
    await expect(reauthDialog(options)).toBeHidden();
    expect(await liveSessionGrants(popup)).toHaveLength(0);
    expect(await decisionFor(popup, 30023)).toEqual({
      mode: "ask",
      reason: "trust",
    });

    // And the site feels it: the request the grant was silently signing a
    // moment ago now queues for a human decision.
    const dapp = await openDapp(extensionContext);
    const prompted = signFromDapp(
      dapp,
      30023,
      "Cleared session grant must prompt"
    );
    await expect.poll(async () => (await pendingRequests(popup)).length, {
      timeout: 10_000,
    }).toBe(1);
    await resolveNextApproval(popup, "deny");
    expect((await prompted).success).toBe(false);
  });
});
