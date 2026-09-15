import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import {
  seedUnlockedVault,
  sendExtensionRpc,
  grantKindAllow,
  openDapp,
  resolveNextApproval,
  DAPP_ORIGIN,
  TEST_PASSWORD,
} from "./fixtures/agent";

/**
 * The activity log is the only place a user can see what a site did with their
 * key after the fact. It is an audit trail, so these tests hold it to audit
 * standards: every decision reaches it, an approval and a refusal are
 * distinguishable, the filters narrow what is actually rendered rather than
 * only what the RPC returns, and nothing in it is private key material.
 *
 * These tests used to be two `test.skip(true, "Onboarding required")` stubs
 * guarded by an `isVisible()` check, so they reported green while asserting
 * nothing at all. `seedUnlockedVault` removes that excuse.
 *
 * Two behaviours of the shipped UI are load-bearing here and are asserted
 * rather than worked around:
 *
 *  - `ActivityView` never calls the `refresh` it destructures from
 *    `useActivityLog`, so the list only loads on mount and on a filter change.
 *    A test that signs something must leave and re-enter the tab, which is
 *    also what a user has to do. `reopenActivityTab` is that, named.
 *  - `ActivityFilters` renders nothing while the list is empty and unfiltered,
 *    so "the filter controls exist" is only true once there is something to
 *    filter. The old test asserted them on an empty log via
 *    `getByPlaceholder`, which matches an <input placeholder> and never a
 *    Radix combobox - it could not have passed either.
 */

const SIGNED_CONTENT = "Ostrilo activity-log E2E reaction";
const APP_DATA_CONTENT = '{"activity":"e2e-app-data"}';

type ActivityEntry = {
  id: string;
  timestamp: number;
  origin: string;
  kind?: number;
  operation?: "sign_event" | "identity_disclosure";
  decision: "allow" | "deny";
  reason?: string;
  contentPreview?: string;
  keyId?: string;
};

type ActivityPage = { entries: ActivityEntry[]; total: number };

async function getActivity(
  page: Page,
  filters: Record<string, unknown> = {}
): Promise<ActivityPage> {
  const hasFilter = Object.keys(filters).length > 0;
  return sendExtensionRpc<ActivityPage>(page, {
    type: hasFilter ? "activity.filterBy" : "activity.getRecent",
    limit: 50,
    ...filters,
  });
}

async function openActivityTab(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Activity" }).click();
  await expect(
    page.getByRole("heading", { name: "Recent Activity" })
  ).toBeVisible();
}

/**
 * Remounts `ActivityView` so it refetches. The list has no live subscription,
 * so an entry written while the tab is open stays invisible until this.
 */
async function reopenActivityTab(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Home" }).click();
  await openActivityTab(page);
}

/**
 * The Radix trigger is `role="combobox"`, and ARIA forbids name-from-content
 * for that role, so it has NO accessible name - `getByRole("combobox", { name })`
 * matches nothing however the placeholder is spelled. The currently selected
 * label is the only thing that tells the two filters apart.
 */
function filterTrigger(page: Page, label: string) {
  return page.getByRole("combobox").filter({ hasText: label });
}

async function chooseFilter(
  page: Page,
  current: string,
  option: string
): Promise<void> {
  await filterTrigger(page, current).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(filterTrigger(page, option)).toBeVisible();
}

/**
 * One rendered row, reached from its title.
 *
 * The decision chip is a sibling of the title's column, so the assertion has
 * to be scoped to the row: "the page contains Denied somewhere" would pass
 * even if the chip were attached to the wrong entry.
 */
function activityRow(page: Page, title: string) {
  return page
    .getByRole("heading", { level: 3, name: title, exact: true })
    .locator("xpath=../..");
}

test.describe("Activity view", () => {
  // Every test here seeds its own vault, and `vault.generate` + `vault.unlock`
  // run a real Argon2id derivation twice. On an unloaded machine a test is
  // done in a couple of seconds; on a busy one the KDF alone can eat the whole
  // 30s default and the failure looks like a hung selector rather than a
  // saturated CPU. The budget is raised, not the assertions loosened.
  test.describe.configure({ timeout: 120_000 });

  test("shows the empty state before anything has been signed", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    // Seeding grants identity disclosure but never exercises it, so the log is
    // genuinely empty rather than empty-looking.
    const stored = await getActivity(popup);
    expect(stored.total).toBe(0);

    await openActivityTab(popup);

    await expect(popup.getByText("No activity yet")).toBeVisible();
    await expect(
      popup.getByText("Sign events to see your activity history here")
    ).toBeVisible();

    // No decision chips means no rows: the empty copy is not being rendered
    // above a list that actually has content in it.
    await expect(popup.getByText("Approved")).toHaveCount(0);
    await expect(popup.getByText("Denied")).toHaveCount(0);

    // Filters are deliberately absent with nothing to filter. Asserting this
    // pins the behaviour the old `getByPlaceholder("All Origins")` test
    // assumed away.
    await expect(popup.getByRole("combobox")).toHaveCount(0);
  });

  test("records a real NIP-07 signature with its origin and kind", async ({
    openPopup,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    await grantKindAllow(popup, DAPP_ORIGIN, 7);

    const dapp = await openDapp(extensionContext);
    const pubkey = await dapp.evaluate(() => window.testGetPublicKey());
    expect(pubkey).toMatch(/^[0-9a-f]{64}$/);

    const signed = await dapp.evaluate(
      (content) =>
        window.testSignEvent({
          kind: 7,
          content,
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
        }),
      SIGNED_CONTENT
    );
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);

    // The stored record is what an export and a later audit read.
    const stored = await getActivity(popup);
    expect(stored.total).toBe(2);
    const signature = stored.entries.find((e) => e.kind === 7);
    expect(signature, "the signature was never written to the log").toBeTruthy();
    expect(signature?.origin).toBe(DAPP_ORIGIN);
    expect(signature?.decision).toBe("allow");
    expect(signature?.contentPreview).toBe(SIGNED_CONTENT);

    const disclosure = stored.entries.find(
      (e) => e.operation === "identity_disclosure"
    );
    expect(
      disclosure,
      "reading the public key is a disclosure and must be logged"
    ).toBeTruthy();
    expect(disclosure?.decision).toBe("allow");

    await openActivityTab(popup);

    // Kind, origin and outcome all have to reach the screen: a row that says
    // only "something happened" is not an audit trail.
    await expect(
      popup.getByRole("heading", { level: 3, name: "Reaction" })
    ).toBeVisible({ timeout: 10_000 });
    await expect(popup.getByText(DAPP_ORIGIN).first()).toBeVisible();
    await expect(popup.getByText(SIGNED_CONTENT)).toBeVisible();
    await expect(popup.getByText("Approved").first()).toBeVisible();
    await expect(
      popup.getByRole("heading", { level: 3, name: "Identity disclosure" })
    ).toBeVisible();
  });

  test("filters the rendered list by kind and by origin", async ({
    openPopup,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    await grantKindAllow(popup, DAPP_ORIGIN, 7);
    await grantKindAllow(popup, DAPP_ORIGIN, 30078);

    const dapp = await openDapp(extensionContext);
    await dapp.evaluate(() => window.testGetPublicKey());
    await dapp.evaluate(
      (content) =>
        window.testSignEvent({
          kind: 7,
          content,
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
        }),
      SIGNED_CONTENT
    );
    await dapp.evaluate(
      (content) =>
        window.testSignEvent({
          kind: 30078,
          content,
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
        }),
      APP_DATA_CONTENT
    );

    await openActivityTab(popup);
    await expect(
      popup.getByRole("heading", { level: 3, name: "Reaction" })
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      popup.getByRole("heading", { level: 3, name: "Application Data" })
    ).toBeVisible();
    await expect(
      popup.getByRole("heading", { level: 3, name: "Identity disclosure" })
    ).toBeVisible();

    // Narrowing to one kind must remove the other rows from the DOM, not just
    // from the RPC result. A filter that returns the right data and paints the
    // wrong list is the failure worth catching.
    await chooseFilter(popup, "All Kinds", "Reaction (7)");
    await expect(
      popup.getByRole("heading", { level: 3, name: "Reaction" })
    ).toBeVisible();
    await expect(
      popup.getByRole("heading", { level: 3, name: "Application Data" })
    ).toHaveCount(0);
    // A disclosure signs nothing and carries no kind, so a kind filter must
    // exclude it rather than treat "no kind" as a match.
    await expect(
      popup.getByRole("heading", { level: 3, name: "Identity disclosure" })
    ).toHaveCount(0);

    await popup.getByRole("button", { name: "Clear Filters" }).click();
    await expect(
      popup.getByRole("heading", { level: 3, name: "Application Data" })
    ).toBeVisible();

    // The origin dropdown is built from the loaded entries, so the fixture
    // origin is the only real option; selecting it must keep every row.
    await chooseFilter(popup, "All Origins", DAPP_ORIGIN);
    await expect(
      popup.getByRole("heading", { level: 3, name: "Reaction" })
    ).toBeVisible();
    await expect(
      popup.getByRole("heading", { level: 3, name: "Identity disclosure" })
    ).toBeVisible();

    // And the same filter over RPC, including the case the UI cannot offer:
    // an origin that never asked for anything must match nothing.
    const byKind = await getActivity(popup, { kind: 7 });
    expect(byKind.total).toBe(1);
    expect(byKind.entries[0].contentPreview).toBe(SIGNED_CONTENT);

    const byOrigin = await getActivity(popup, { origin: DAPP_ORIGIN });
    expect(byOrigin.total).toBe(3);

    const byOtherOrigin = await getActivity(popup, {
      origin: "https://not-this-site.example",
    });
    expect(
      byOtherOrigin.total,
      "SECURITY REGRESSION: an origin filter returned another origin's history"
    ).toBe(0);
    expect(byOtherOrigin.entries).toHaveLength(0);

    const byBoth = await getActivity(popup, {
      origin: "https://not-this-site.example",
      kind: 7,
    });
    expect(byBoth.entries).toHaveLength(0);
  });

  test("clearing the log from settings empties the popup list", async ({
    openPopup,
    openOptions,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    await grantKindAllow(popup, DAPP_ORIGIN, 7);

    const dapp = await openDapp(extensionContext);
    await dapp.evaluate(() => window.testGetPublicKey());
    await dapp.evaluate(
      (content) =>
        window.testSignEvent({
          kind: 7,
          content,
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
        }),
      SIGNED_CONTENT
    );

    await openActivityTab(popup);
    await expect(
      popup.getByRole("heading", { level: 3, name: "Reaction" })
    ).toBeVisible({ timeout: 10_000 });

    const options = await openOptions();
    await options.getByRole("tab", { name: "Activity Log" }).click();
    // The destructive action is behind a native confirm(); Playwright dismisses
    // dialogs by default, which would silently no-op the click.
    options.once("dialog", (dialog) => dialog.accept());
    await options.getByRole("button", { name: "Clear Log" }).click();

    await expect
      .poll(async () => (await getActivity(popup)).total, { timeout: 10_000 })
      .toBe(0);

    // The user's window onto the log has to agree with the store, including
    // the content preview of what was signed.
    await reopenActivityTab(popup);
    await expect(popup.getByText("No activity yet")).toBeVisible();
    await expect(
      popup.getByRole("heading", { level: 3, name: "Reaction" })
    ).toHaveCount(0);
    await expect(popup.getByText(SIGNED_CONTENT)).toHaveCount(0);
  });

  test("records a refusal distinctly from an approval", async ({
    openPopup,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    await grantKindAllow(popup, DAPP_ORIGIN, 7);

    const dapp = await openDapp(extensionContext);
    await dapp.evaluate(
      (content) =>
        window.testSignEvent({
          kind: 7,
          content,
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
        }),
      SIGNED_CONTENT
    );

    // Kind 1 is protected, so it prompts regardless of any standing rule. This
    // is a real refusal through the approval queue, not a synthesised entry.
    const refused = dapp.evaluate(async () => {
      try {
        await window.testSignEvent({
          kind: 1,
          content: "Ostrilo activity-log E2E refusal",
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
        });
        return { signed: true };
      } catch (error) {
        return {
          signed: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    await resolveNextApproval(popup, "deny");
    expect(
      (await refused).signed,
      "SECURITY REGRESSION: a refused request was signed anyway"
    ).toBe(false);

    const stored = await getActivity(popup);
    const approved = stored.entries.find((e) => e.kind === 7);
    const denied = stored.entries.find((e) => e.kind === 1);
    expect(approved?.decision).toBe("allow");
    expect(
      denied,
      "a refusal must be logged - an audit trail of approvals only hides exactly the events worth reviewing"
    ).toBeTruthy();
    expect(denied?.decision).toBe("deny");

    await openActivityTab(popup);

    // Both rows exist and they do not read the same. A log that renders a
    // refusal as "Approved" is worse than no log.
    const deniedRow = activityRow(popup, "Short Text Note");
    await expect(deniedRow).toContainText("Denied", { timeout: 10_000 });
    await expect(deniedRow).not.toContainText("Approved");

    const approvedRow = activityRow(popup, "Reaction");
    await expect(approvedRow).toContainText("Approved");
    await expect(approvedRow).not.toContainText("Denied");
  });

  test("never renders or stores private key material", async ({
    openPopup,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    await grantKindAllow(popup, DAPP_ORIGIN, 7);

    // The actual secrets for this vault, so the assertions below compare
    // against the real strings rather than against a pattern that happens to
    // match nothing.
    const secret = await sendExtensionRpc<{ nsec: string; hex: string }>(
      popup,
      { type: "vault.reveal", password: TEST_PASSWORD }
    );
    expect(secret.nsec).toMatch(/^nsec1/);
    expect(secret.hex).toMatch(/^[0-9a-f]{64}$/);

    const dapp = await openDapp(extensionContext);
    await dapp.evaluate(() => window.testGetPublicKey());
    const signed = await dapp.evaluate(
      (content) =>
        window.testSignEvent({
          kind: 7,
          content,
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
        }),
      SIGNED_CONTENT
    );

    // The stored record is what the Settings "Export Log" button writes to
    // disk as plain JSON, so it is held to the same standard as the screen.
    const stored = await getActivity(popup);
    const raw = JSON.stringify(stored);
    expect(
      raw,
      "SECURITY REGRESSION: the activity log stored the nsec"
    ).not.toContain(secret.nsec);
    expect(
      raw,
      "SECURITY REGRESSION: the activity log stored the raw private key"
    ).not.toContain(secret.hex);
    expect(raw).not.toContain("nsec1");
    // `keyId` identifies the record, not the key. If it ever became the key
    // itself, every export would carry it.
    for (const entry of stored.entries) {
      expect(entry.keyId ?? "").not.toBe(secret.hex);
    }

    await openActivityTab(popup);
    await expect(
      popup.getByRole("heading", { level: 3, name: "Reaction" })
    ).toBeVisible({ timeout: 10_000 });

    const rendered = (await popup.textContent("body")) ?? "";
    expect(
      rendered,
      "SECURITY REGRESSION: the nsec was rendered in the activity view"
    ).not.toContain(secret.nsec);
    expect(
      rendered,
      "SECURITY REGRESSION: the raw private key was rendered in the activity view"
    ).not.toContain(secret.hex);
    expect(rendered).not.toContain("nsec1");
    // The signature is not key material, but it has no business in a history
    // list either - its presence would mean raw signing output is being piped
    // into the log's free-text fields.
    expect(rendered).not.toContain(signed.sig);
  });
});
