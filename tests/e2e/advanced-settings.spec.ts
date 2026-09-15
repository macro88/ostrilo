import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import type { BrowserContext } from "@playwright/test";
import {
  seedUnlockedVault,
  sendExtensionRpc,
  openDapp,
  resolveNextApproval,
  waitForApprovalPage,
  DAPP_ORIGIN,
} from "./fixtures/agent";

/**
 * The Advanced tab's "Medium Trust Auto-Allow" switches.
 *
 * Every other permission surface in this product is scoped to one origin: a
 * per-kind rule, a trust level, a session grant. These switches are not. They
 * edit `settings.mediumAllowKinds`, a single global list that decides what
 * EVERY medium-trust origin may sign without prompting — present and future,
 * including sites the user has not visited yet. Ticking one is the widest
 * signing grant reachable from the UI, and until this file existed nothing
 * tested it at any level above a unit test of the pure filter.
 *
 * Two things therefore have to be true, and both are asserted here by actually
 * signing from the fixture dApp rather than by reading settings back:
 *
 *   1. The switches WORK. A kind that is on signs silently; turn it off and the
 *      identical request goes to the approval queue. A control that widens
 *      authority but does not narrow it again is worse than no control.
 *   2. The switches have a CEILING. `getEffectiveMediumAllowKinds` intersects
 *      whatever is stored with the high-trust allowlist and subtracts the
 *      protected kinds, so this checkbox can never become a way to silently
 *      sign kind 1 (a note published as the user) or anything else outside the
 *      set `high` trust itself would permit. That is the property worth the
 *      most here, because the blast radius of losing it is every medium-trust
 *      origin at once.
 *
 * PASSWORD GATING — WHAT WE FOUND, NOT WHAT WE WISH:
 * These switches are NOT password-gated, and nothing else gates them either:
 * there is no confirmation step, no re-auth dialog and no undo. `AdvancedTab`
 * calls `useAppSettings.updateMediumAllowKinds`, which sends `settings.update`
 * with no password; `patchNeedsReauth` (reauth.ts) lists only `autoLockMinutes`
 * and `sessionTTLMinutes`, so the background waves it through. Compare
 * `policy.setKindRule` mode "allow" and `policy.setOrigin` trustLevel "high",
 * which both cost a password for granting strictly LESS authority — one origin
 * rather than all of them. That asymmetry is pinned by an assertion in the
 * second test below. It is deliberately written as a statement of the current
 * model, so that adding a gate breaks this file and forces a conscious edit
 * rather than sliding past unnoticed.
 *
 * The ceiling is what keeps the ungated control tolerable, which is why the
 * last two tests exist.
 */

// Kind numbers are spelled out rather than imported from `src`, so that a
// change to the shipped constants surfaces here as a failure instead of being
// silently absorbed by a test that reads the same constant it is checking.
const MEDIUM_DEFAULT_KIND = 7; // Reaction — in DEFAULT_MEDIUM_ALLOW_KINDS.
const HIGH_ONLY_KIND = 30078; // Application Data — HIGH_TRUST_ALLOW_KINDS only.
const BARRIER_KIND = 10000; // Mute List — also high-trust-only; used as a barrier.
const PROTECTED_KIND = 1; // Short Text Note — in PROTECTED_KINDS.
const OUT_OF_CEILING_KIND = 0; // Profile Metadata — in neither allowlist.

/** DEFAULT_MEDIUM_ALLOW_KINDS, in the order the product ships it. */
const SHIPPED_MEDIUM_KINDS = [6, 16, 7, 10002];

type SignOutcome =
  | { ok: true; kind: number; sig: string }
  | { ok: false; error: string };

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
        .then((value: { kind: number; sig: string }) => ({
          ok: true,
          kind: value.kind,
          sig: value.sig,
        }))
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

async function signAndWait(
  dapp: Page,
  kind: number,
  content: string
): Promise<SignOutcome> {
  await beginSignRequest(dapp, kind, content);
  return await readSignOutcome(dapp);
}

async function pendingCount(page: Page): Promise<number> {
  const data = await sendExtensionRpc<{ requests: unknown[] }>(page, {
    type: "approval.getAll",
  });
  return data.requests.length;
}

async function storedMediumKinds(page: Page): Promise<number[]> {
  const settings = await sendExtensionRpc<{ mediumAllowKinds: number[] }>(
    page,
    { type: "settings.get" }
  );
  return settings.mediumAllowKinds;
}

/** What the background will actually decide, straight from the policy engine. */
async function decisionFor(page: Page, kind: number) {
  return await sendExtensionRpc<{ mode: string; reason: string }>(page, {
    type: "policy.evaluate",
    origin: DAPP_ORIGIN,
    kind,
  });
}

function approvalPageCount(
  context: BrowserContext,
  extensionId: string
): number {
  const prefix = `chrome-extension://${extensionId}/approval.html`;
  return context.pages().filter((p) => p.url().startsWith(prefix)).length;
}

/**
 * Medium is the trust level these switches apply to. Setting it is not
 * password-gated (only `high` is — PolicyRpcHandler.handleSetOrigin), so it
 * rides over RPC here; the UI path for trust levels has its own coverage in
 * settings-origin-policy.spec.ts and is not what this file is about.
 *
 * The throwaway `policy.evaluate` first is NOT padding, and it cost an hour to
 * find. `PolicyService.loadContext` runs a one-shot consent migration before
 * the first evaluation it serves, and that migration rewrites EVERY stored
 * `medium` to `low` — it exists to undo a historical bug that fabricated
 * medium trust. It is guarded by a `__consentMigrations` stamp written into
 * settings, and a freshly created profile has no stamp yet. So on a new
 * install, a medium trust granted before the first policy evaluation is
 * silently reverted the moment one happens. Priming it here stamps the record
 * first, which is the state every real long-lived profile is already in.
 *
 * PRODUCT FINDING, not a harness workaround — see the note at the foot of this
 * file. The failure this produced was a signing prompt appearing for a site
 * the Settings screen still showed as Medium.
 */
async function setMediumTrust(page: Page): Promise<void> {
  await sendExtensionRpc(page, {
    type: "policy.evaluate",
    origin: DAPP_ORIGIN,
    kind: MEDIUM_DEFAULT_KIND,
  });
  await sendExtensionRpc(page, {
    type: "policy.setOrigin",
    origin: DAPP_ORIGIN,
    patch: { trustLevel: "medium" },
  });
}

async function openAdvancedTab(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("tab", { name: "Advanced" }).click();
  await expect(
    page.getByRole("heading", { name: "Advanced Settings" })
  ).toBeVisible();
}

/** The switch an unprotected kind gets. Accessible name from MediumKindToggles. */
function kindToggle(page: Page, kind: number) {
  return page.getByRole("switch", {
    name: `Allow kind ${kind} for medium trust origins`,
  });
}

/** The switch a protected kind gets — a different name, and always disabled. */
function protectedToggle(page: Page, kind: number) {
  return page.getByRole("switch", {
    name: `Kind ${kind} always requires approval`,
  });
}

test.describe("advanced settings: medium-trust auto-allow", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
    // Each test seeds a vault (a real KDF), opens two extension surfaces and
    // drives at least one round trip through the live approval queue. The 30s
    // default is a harness budget, not a product assertion.
    test.setTimeout(90_000);
  });

  /**
   * The baseline the switches are edits to: what the tab shows is what the
   * background will actually do.
   *
   * A settings screen that displays a permission it does not hold — or holds
   * one it does not display — is the failure mode this asserts against. The
   * shipped medium list is read here through three independent windows: the
   * rendered switch, the policy engine's own decision, and a real signature
   * returned to the page with no approval window in between.
   */
  test("a kind in the shipped medium list signs with no prompt, and the tab says so", async ({
    openPopup,
    openOptions,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    await setMediumTrust(popup);

    const options = await openOptions();
    await openAdvancedTab(options);

    // On: a shipped default. Off: a kind high trust would allow but medium
    // does not, which is the gap the next tests close by hand.
    await expect(kindToggle(options, MEDIUM_DEFAULT_KIND)).toBeChecked();
    await expect(kindToggle(options, HIGH_ONLY_KIND)).not.toBeChecked();
    expect(await storedMediumKinds(popup)).toEqual(SHIPPED_MEDIUM_KINDS);

    expect(await decisionFor(popup, MEDIUM_DEFAULT_KIND)).toEqual({
      mode: "allow",
      reason: "trust",
    });

    const dapp = await openDapp(extensionContext);
    const approvalsBefore = approvalPageCount(extensionContext, extensionId);

    const outcome = await signAndWait(
      dapp,
      MEDIUM_DEFAULT_KIND,
      "medium trust signs a reaction"
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.kind).toBe(MEDIUM_DEFAULT_KIND);
      expect(outcome.sig).toMatch(/^[0-9a-f]{128}$/);
    }

    // "No prompt" has to mean no prompt, not "a prompt nobody noticed": no
    // approval window was opened and nothing is sitting in the queue.
    expect(approvalPageCount(extensionContext, extensionId)).toBe(
      approvalsBefore
    );
    expect(await pendingCount(popup)).toBe(0);
  });

  /**
   * Turning a switch OFF has to take the permission away.
   *
   * This is the half of a permission control that tends to rot, because the
   * grant is exercised constantly and the revocation almost never is. The test
   * signs the same kind twice with the same origin and the same trust level,
   * changing nothing between them except one click in Advanced, so the click is
   * the only thing that can explain the difference in outcome.
   */
  test("unticking a kind in Advanced sends the identical request to the approval queue", async ({
    openPopup,
    openOptions,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    await setMediumTrust(popup);
    const dapp = await openDapp(extensionContext);

    const silent = await signAndWait(dapp, MEDIUM_DEFAULT_KIND, "before");
    expect(silent.ok).toBe(true);
    expect(await pendingCount(popup)).toBe(0);

    const options = await openOptions();
    await openAdvancedTab(options);
    await kindToggle(options, MEDIUM_DEFAULT_KIND).click();

    await expect
      .poll(async () => await storedMediumKinds(popup), { timeout: 10_000 })
      .not.toContain(MEDIUM_DEFAULT_KIND);
    await expect(kindToggle(options, MEDIUM_DEFAULT_KIND)).not.toBeChecked();

    // The password finding, pinned. Widening or narrowing the signing authority
    // of every medium-trust origin at once costs one click: no dialog appeared
    // and the write landed anyway. `policy.setKindRule` mode "allow" — the same
    // grant for a SINGLE origin — is refused without the password. If a gate is
    // ever added here, this assertion is the one to update, on purpose.
    await expect(options.getByRole("dialog")).toHaveCount(0);

    expect(await decisionFor(popup, MEDIUM_DEFAULT_KIND)).toEqual({
      mode: "ask",
      reason: "trust",
    });

    // Same origin, same trust level, same kind: now it waits for a human.
    await beginSignRequest(dapp, MEDIUM_DEFAULT_KIND, "after");
    const approvalPage = await waitForApprovalPage(extensionContext, extensionId);
    await expect
      .poll(async () => await pendingCount(popup), { timeout: 10_000 })
      .toBe(1);

    // Driven to a decision through the UI so the queued item is proven to be a
    // real, answerable request for this exact event rather than a stuck entry.
    await approvalPage.getByTestId("approval-request-item").first().click();
    await expect(approvalPage.getByTestId("approval-detail")).toBeVisible();

    // The approval window closes itself the moment the queue empties, which
    // races Playwright's post-click bookkeeping and surfaces as "Target page
    // has been closed" AFTER the click has already been delivered. Only that
    // one error is swallowed: a missing or unclickable button still throws,
    // and a click that did nothing still fails on the signature below.
    await approvalPage
      .getByRole("button", { name: "Approve & sign" })
      .click()
      .catch((error: Error) => {
        if (!/has been closed/i.test(error.message)) throw error;
      });

    const prompted = await readSignOutcome(dapp);
    expect(prompted.ok).toBe(true);
    if (prompted.ok) expect(prompted.sig).toMatch(/^[0-9a-f]{128}$/);
  });

  /**
   * Turning a switch ON has to grant the permission — but only up to the
   * ceiling, which is why the kind chosen is one `high` trust would allow and
   * the shipped medium list omits.
   *
   * Asserting the "asks" state first matters: without it the test would pass
   * against a build where kind 30078 was silently signable all along, which is
   * exactly the regression a medium-trust allowlist exists to prevent.
   */
  test("ticking a high-trust kind that medium omits makes it sign silently", async ({
    openPopup,
    openOptions,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    await setMediumTrust(popup);
    const dapp = await openDapp(extensionContext);

    // Inside the high-trust ceiling, outside the shipped medium list: asks.
    expect(await decisionFor(popup, HIGH_ONLY_KIND)).toEqual({
      mode: "ask",
      reason: "trust",
    });
    await beginSignRequest(dapp, HIGH_ONLY_KIND, "app data, before the toggle");
    await expect
      .poll(async () => await pendingCount(popup), { timeout: 10_000 })
      .toBe(1);
    // Denied WITHOUT "remember", so no per-kind rule is written and the trust
    // level remains the only thing deciding the next request.
    await resolveNextApproval(popup, "deny");
    const refused = await readSignOutcome(dapp);
    expect(refused.ok).toBe(false);

    const options = await openOptions();
    await openAdvancedTab(options);
    await kindToggle(options, HIGH_ONLY_KIND).click();

    await expect
      .poll(async () => await storedMediumKinds(popup), { timeout: 10_000 })
      .toContain(HIGH_ONLY_KIND);
    await expect(kindToggle(options, HIGH_ONLY_KIND)).toBeChecked();
    expect(await decisionFor(popup, HIGH_ONLY_KIND)).toEqual({
      mode: "allow",
      reason: "trust",
    });

    const approvalsBefore = approvalPageCount(extensionContext, extensionId);
    const outcome = await signAndWait(
      dapp,
      HIGH_ONLY_KIND,
      "app data, after the toggle"
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.kind).toBe(HIGH_ONLY_KIND);
      expect(outcome.sig).toMatch(/^[0-9a-f]{128}$/);
    }
    expect(approvalPageCount(extensionContext, extensionId)).toBe(
      approvalsBefore
    );
    expect(await pendingCount(popup)).toBe(0);

    // The grant is scoped to the kind that was ticked and to nothing else.
    expect(await decisionFor(popup, BARRIER_KIND)).toEqual({
      mode: "ask",
      reason: "trust",
    });
  });

  /**
   * THE CEILING, PART 1: a protected kind can never enter the medium allowlist.
   *
   * This is the test the file is really for. If this control could be pointed
   * at kind 1, one unnoticed click would let every medium-trust origin publish
   * notes as the user, silently, forever — the exact outcome PROTECTED_KINDS
   * exists to make unreachable.
   *
   * It is checked at both levels, because they fail differently:
   *   - The UI refuses to offer it. `MediumKindToggles` renders the switch
   *     disabled and renames it, so there is no click to make.
   *   - The BACKGROUND refuses to store it. A UI that will not offer something
   *     is not a gate; anything that can send a runtime message skips it. So
   *     the patch is sent directly, the way an attacker or a legacy/hand-edited
   *     settings record would arrive, and `getEffectiveMediumAllowKinds` in the
   *     `settings.update` handler strips kind 1 before it is ever written.
   *
   * Note the test then asserts kind 1 still prompts from the dApp. That is a
   * behavioural claim about the user's exposure and it survives removing the
   * protected-kind filter from `getEffectiveMediumAllowKinds`, because
   * `evaluatePolicy` and `defaultForTrust` each re-check `isProtectedKind`
   * independently. The stored-state assertion is what pins this specific layer.
   */
  test("the ceiling holds: a protected kind cannot be auto-allowed for medium trust", async ({
    openPopup,
    openOptions,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    await setMediumTrust(popup);

    const options = await openOptions();
    await openAdvancedTab(options);

    // There is no switch to tick: the control is renamed and disabled, and the
    // row says why in words the user can read.
    const toggle = protectedToggle(options, PROTECTED_KIND);
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeDisabled();
    await expect(toggle).not.toBeChecked();
    await expect(kindToggle(options, PROTECTED_KIND)).toHaveCount(0);
    // Scoped by id rather than by text: kind 9734 (Zap Request) carries the
    // same sentence, and this assertion is specifically about kind 1.
    await expect(
      options.locator(`#medium-kind-${PROTECTED_KIND}-description`)
    ).toContainText("always requires approval and cannot be auto-allowed.");

    // Now go around the UI entirely. This is the layer that counts.
    await sendExtensionRpc(options, {
      type: "settings.update",
      patch: { mediumAllowKinds: [...SHIPPED_MEDIUM_KINDS, PROTECTED_KIND] },
    });

    const stored = await storedMediumKinds(popup);
    expect(stored).not.toContain(PROTECTED_KIND);
    // The rest of the patch was honoured, so the rejection is specific to the
    // protected kind and not an update that failed wholesale.
    expect(stored).toEqual(SHIPPED_MEDIUM_KINDS);

    expect(await decisionFor(popup, PROTECTED_KIND)).toEqual({
      mode: "ask",
      reason: "protected",
    });

    // And in the only terms that matter to the user: the site still cannot
    // publish a note without being asked.
    const dapp = await openDapp(extensionContext);
    await beginSignRequest(dapp, PROTECTED_KIND, "a note the user never wrote");
    await expect
      .poll(async () => await pendingCount(popup), { timeout: 10_000 })
      .toBe(1);
    await resolveNextApproval(popup, "deny");
    const outcome = await readSignOutcome(dapp);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.toLowerCase()).toMatch(/denied|rejected/);
    }
  });

  /**
   * THE CEILING, PART 2: medium can never exceed high.
   *
   * `MEDIUM_TRUST_CEILING` is `HIGH_TRUST_ALLOW_KINDS`, so a kind outside the
   * high-trust allowlist cannot be auto-allowed for medium trust either — even
   * though it is not "protected" and the tab renders it as an ordinary,
   * enabled, clickable switch. Kind 0 rewrites the user's public profile; kinds
   * 3, 4, 14 and 9735 sit in the same position. The comment in
   * trust-definitions.ts is explicit that these are left out of every trust
   * allowlist on purpose, so only a rule the user wrote by hand can ever
   * auto-sign them.
   *
   * The click is followed by a second, legal click used purely as a
   * happens-after barrier: settings writes are ordered, so once kind 10000 has
   * landed the kind 0 write has certainly been processed and its absence is a
   * result rather than a race.
   *
   * WORTH KNOWING — a UX defect this test documents rather than asserts away:
   * the kind 0 switch is fully enabled and gives no feedback at all. It is
   * clicked, nothing happens, and the user is left believing they granted
   * something. `MediumKindToggles` only disables PROTECTED_KINDS; it does not
   * disable kinds outside MEDIUM_TRUST_CEILING. Safe, but silently inert.
   */
  test("the ceiling holds: a kind outside the high-trust allowlist cannot be enabled", async ({
    openPopup,
    openOptions,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    await setMediumTrust(popup);

    const options = await openOptions();
    await openAdvancedTab(options);

    // Offered as an ordinary switch — no "protected" treatment whatsoever.
    const toggle = kindToggle(options, OUT_OF_CEILING_KIND);
    await expect(toggle).toBeEnabled();
    await expect(toggle).not.toBeChecked();

    await toggle.click();
    await kindToggle(options, BARRIER_KIND).click();

    await expect
      .poll(async () => await storedMediumKinds(popup), { timeout: 10_000 })
      .toContain(BARRIER_KIND);

    const stored = await storedMediumKinds(popup);
    expect(stored).not.toContain(OUT_OF_CEILING_KIND);
    await expect(toggle).not.toBeChecked();

    expect(await decisionFor(popup, OUT_OF_CEILING_KIND)).toEqual({
      mode: "ask",
      reason: "trust",
    });

    // The barrier click proves the handler itself works, so the refusal above
    // is the ceiling and not a broken toggle.
    expect(await decisionFor(popup, BARRIER_KIND)).toEqual({
      mode: "allow",
      reason: "trust",
    });

    // Behaviour, not just storage: a profile rewrite still has to be approved.
    const dapp = await openDapp(extensionContext);
    await beginSignRequest(dapp, OUT_OF_CEILING_KIND, '{"name":"not the user"}');
    await expect
      .poll(async () => await pendingCount(popup), { timeout: 10_000 })
      .toBe(1);
    await resolveNextApproval(popup, "deny");
    const outcome = await readSignOutcome(dapp);
    expect(outcome.ok).toBe(false);
  });
});

/**
 * ---------------------------------------------------------------------------
 * WHAT THESE TESTS ARE SENSITIVE TO, AND WHAT THEY ARE NOT
 * ---------------------------------------------------------------------------
 * Established by mutating the product and re-running, not by reading the code.
 *
 *   Deleting `!isProtectedKind(kind)` from `getEffectiveMediumAllowKinds`
 *     -> ALL FIVE STILL PASS. Not a gap in these tests: that clause is
 *        currently REDUNDANT. No member of PROTECTED_KINDS (1, 5, 9734, 22242,
 *        27235) appears in HIGH_TRUST_ALLOW_KINDS, so the ceiling clause on the
 *        next line already excludes every one of them. It is real defence in
 *        depth — it starts carrying load the day a protected kind is added to
 *        the high-trust allowlist — but today nothing observable depends on it,
 *        and no end-to-end test can show otherwise.
 *   Deleting `isHighTrustAllowedKind(kind)` (the ceiling clause)
 *     -> the last test fails: stored becomes [6, 16, 7, 10002, 0, 10000], i.e.
 *        kind 0 (rewrite the user's public profile) is now globally auto-signed
 *        for every medium-trust origin.
 *   Deleting both, so the function filters nothing
 *     -> both ceiling tests fail: [6, 16, 7, 10002, 1] and
 *        [6, 16, 7, 10002, 0, 10000].
 *   Making `AdvancedTab.handleToggleMediumKind` ignore the un-tick branch
 *     -> the second test fails: the switch reads off, the stored list still
 *        contains 7, and the site keeps signing silently.
 *
 * The BEHAVIOURAL halves of the two ceiling tests (kind 1 and kind 0 still
 * queue for approval) survive every mutation above, because `evaluatePolicy`
 * re-checks `isProtectedKind` itself and `defaultForTrust` re-applies
 * `isHighTrustAllowedKind` to the medium branch. That is three independent
 * layers, and it is why the stored-state assertions are written alongside the
 * behavioural ones rather than instead of them: the stored assertion pins this
 * layer, the behavioural assertion pins the user's actual exposure.
 *
 * ---------------------------------------------------------------------------
 * NOT COVERED HERE
 * ---------------------------------------------------------------------------
 * - Protected kinds 5, 22242 and 27235 have no switch to inspect, because
 *   `COMMON_EVENT_KINDS` (the list the tab renders) does not contain them. Only
 *   1 and 9734 appear; kind 1 is the one asserted.
 * - Kind 10003 is in HIGH_TRUST_ALLOW_KINDS but likewise absent from
 *   COMMON_EVENT_KINDS, so it can never be enabled from this screen at all.
 * - The same `MediumKindToggles` component is not reachable from the popup or
 *   side panel, so there is no cross-surface propagation case to test.
 *
 * ---------------------------------------------------------------------------
 * PRODUCT FINDINGS (recorded, not fixed — no `src/` change belongs in a test)
 * ---------------------------------------------------------------------------
 * 1. The consent migration silently reverts a fresh install's medium trust.
 *    `PolicyService.runConsentMigration` rewrites every stored `medium` to
 *    `low`, once, guarded by a `__consentMigrations` stamp. It is triggered
 *    lazily from `loadContext`, which is reached ONLY from
 *    `PolicyService.evaluate` — nothing runs it at startup. A new profile has
 *    no stamp, and `getPublicKey` creates an origin record without ever
 *    evaluating a policy. So: install, let a site read your public key, open
 *    Settings, set that site to Medium — and the first time it tries to sign,
 *    the migration fires, the trust level drops to Low, an approval prompt
 *    appears and Settings now reads Low. The user's choice is discarded with no
 *    message. It fails CLOSED (more prompting, never less), so this is a
 *    correctness and trust-in-the-UI defect rather than a security hole.
 *    `setMediumTrust` above works around it by forcing one evaluation first.
 * 2. `MediumKindToggles` renders live, enabled, unchecked switches for kinds
 *    that can never be enabled. Kinds 0, 3, 4, 14 and 9735 are outside
 *    MEDIUM_TRUST_CEILING, so clicking them writes nothing and the switch snaps
 *    back with no explanation — five of the fourteen rows on this screen are
 *    inert. The component only special-cases `isProtectedKind`; it does not
 *    check `isHighTrustAllowedKind`. Safe, but it teaches the user that the
 *    screen ignores them. The last test pins the behaviour so a fix is a
 *    deliberate change.
 * 3. Widening signing authority here costs nothing. See the header: no
 *    password, no confirmation, no undo, for the only control in the product
 *    that grants silent signing to EVERY medium-trust origin at once — while
 *    the same grant for one origin is password-gated.
 */
