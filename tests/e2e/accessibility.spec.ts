import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext } from "@playwright/test";
import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import { twoToneImage } from "./fixtures/png";
import {
  DAPP_ORIGIN,
  grantKindAllow,
  openDapp,
  sendExtensionRpc,
  waitForApprovalPage,
} from "./fixtures/agent";

/**
 * Automated accessibility checks (axe, WCAG 2.0/2.1 A and AA) over every
 * surface the extension draws, in both themes, against a populated vault.
 *
 * The spec fails on any `serious` or `critical` violation. Moderate and minor
 * ones are attached to the test and printed, so they stay visible without
 * blocking a merge. Nothing is excluded: a rule or element silenced here would
 * be a surface nobody checks again. The one allowed exception is a defect inside
 * a third-party primitive that props cannot reach, named in
 * KNOWN_FALSE_POSITIVES with its reason, and then only for the nodes Radix
 * itself produced.
 *
 * One browser context per theme, with the vault built up in stages (Quick
 * start, extra key, sites, signed and denied activity, a pending approval
 * queue) so a surface is judged with rows in it, not empty. Light and dark are
 * two tests because Deep Ink reassigns roles rather than inverting, so a pass
 * in one says nothing about the other.
 */

const PASSWORD = "Gannet-Cormorant-Tern-2026!";
const BACKUP_PASSPHRASE = "Skerry-Stack-Kelp-Basalt-2026!";
const FIRST_KEY = "My Nostr Key";
const SECOND_KEY = "Work";
const ALT_ORIGIN = "https://127.0.0.1:8765";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
/** The public NIP-19 example key; it unlocks nothing outside this test. */
const VECTOR_NSEC =
  "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";

/**
 * Third-party false positives. An entry drops a node of a violation only when
 * the surface and the rule match AND the node's own markup carries the
 * `marker` that Radix leaves on what it touched, so the same rule on any other
 * element of the same surface still blocks. Nothing here is Ostrilo's markup.
 */
interface KnownFalsePositive {
  surface: string;
  rule: string;
  /** Substring of the node's HTML that only Radix's own element or hiding adds. */
  marker: string;
  reason: string;
}

const KNOWN_FALSE_POSITIVES: ReadonlyArray<KnownFalsePositive> = [
  {
    surface: "key selector open",
    rule: "aria-hidden-focus",
    marker: 'data-aria-hidden="true"',
    reason:
      "Radix's modal DropdownMenu sets aria-hidden on the page behind it (marking it data-aria-hidden) and traps focus in the menu, which axe only credits for aria-modal dialogs; modal={false} reopens the menu closed if pressed during its 150 ms exit, because the closing content still holds focus.",
  },
  {
    surface: "kind filter open",
    rule: "aria-hidden-focus",
    marker: 'data-aria-hidden="true"',
    reason:
      "Radix Select sets aria-hidden on the page behind its popover (marking it data-aria-hidden) and has no non-modal mode to turn that off.",
  },
  {
    surface: "kind filter open",
    rule: "scrollable-region-focusable",
    marker: "data-radix-select-viewport",
    reason:
      "Radix Select's scrolling viewport is driven by arrow keys on its roving-focus options, which axe does not count as focusable content.",
  },
];

/** The nodes of `violation` that no known false positive accounts for. */
function unexplainedNodes<N extends { html: string }>(
  surface: string,
  rule: string,
  nodes: N[]
): N[] {
  const known = KNOWN_FALSE_POSITIVES.filter(
    (f) => surface.includes(f.surface) && f.rule === rule
  );
  return nodes.filter((node) => !known.some((f) => node.html.includes(f.marker)));
}

/**
 * Surfaces the run must have judged. A refactor that quietly stops reaching one
 * would otherwise pass with fewer scans and no violations.
 */
const REQUIRED_SURFACES = [
  "lock screen",
  "background unreachable",
  "onboarding welcome",
  "onboarding create",
  "onboarding quick start",
  "onboarding import",
  "home with backup banner",
  "approval detail, over the auto-sign budget",
  "approval detail, public key request",
  "approval detail, signing request",
  "profile view",
  "profile edit",
  "popup activity",
  "settings keys back up dialog",
  "settings security",
  "settings permissions",
  "settings activity",
  "home with an unreadable key",
  "profile with an unreadable key",
];

type Theme = "light" | "dark";

interface Finding {
  surface: string;
  id: string;
  impact: string;
  help: string;
  nodes: string[];
}

class Auditor {
  readonly findings: Finding[] = [];
  readonly surfaces: string[] = [];

  constructor(private readonly theme: Theme) {}

  /** Puts a page in the theme under test before it renders anything. */
  async prepare(page: Page): Promise<void> {
    await page.emulateMedia({ colorScheme: this.theme, reducedMotion: "reduce" });
  }

  async audit(page: Page, surface: string): Promise<void> {
    // The popup is a 390px page; a theme that did not apply would pass every
    // contrast check for the wrong reason, so prove it applied first.
    await expect
      .poll(
        () => page.evaluate(() => document.documentElement.classList.contains("dark")),
        { message: `${surface}: theme did not apply`, timeout: 10_000 }
      )
      .toBe(this.theme === "dark");
    // Let focus rings, dialog open animations and skeletons settle.
    await page.waitForTimeout(400);

    const name = `${surface} (${this.theme})`;
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    for (const violation of violations) {
      const nodes = unexplainedNodes(name, violation.id, violation.nodes);
      if (nodes.length > 0) this.findings.push(summarise(name, violation, nodes));
    }
    this.surfaces.push(name);
  }

  blocking(): Finding[] {
    return this.findings.filter((f) => f.impact === "serious" || f.impact === "critical");
  }
}

type Violation = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"][number];

function summarise(
  surface: string,
  violation: Violation,
  nodes: Violation["nodes"]
): Finding {
  return {
    surface,
    id: violation.id,
    impact: violation.impact ?? "unknown",
    help: violation.help,
    nodes: nodes.map(
      (node) => `${node.target.join(" ")} :: ${node.failureSummary?.replace(/\s+/g, " ") ?? ""}`
    ),
  };
}

function format(findings: Finding[]): string {
  return findings
    .map(
      (f) =>
        `[${f.impact}] ${f.id} on ${f.surface}: ${f.help}\n` +
        f.nodes.map((n) => `    - ${n}`).join("\n")
    )
    .join("\n");
}

const popupNav = (page: Page, name: RegExp) => page.getByRole("button", { name });

async function openExtensionPage(
  context: BrowserContext,
  auditor: Auditor,
  url: string,
  size: { width: number; height: number }
): Promise<Page> {
  const page = await context.newPage();
  await auditor.prepare(page);
  await page.setViewportSize(size);
  await page.goto(url);
  return page;
}

/** Welcome, Create, Quick start and Import, then the password-error states. */
async function auditOnboarding(popup: Page, auditor: Auditor): Promise<void> {
  const welcome = popup.getByRole("heading", { name: "Welcome to Ostrilo" });
  await expect(welcome).toBeVisible({ timeout: 15_000 });
  await auditor.audit(popup, "onboarding welcome");

  await popup.getByText("Create New Key", { exact: true }).click();
  await expect(popup.getByRole("heading", { name: "Create Your Nostr Key" })).toBeVisible();
  await auditor.audit(popup, "onboarding create");
  await popup.getByLabel("Key Name").fill("Audit Key");
  await popup.getByLabel("Master Password").fill("short");
  await popup.getByLabel("Confirm Password").fill("different");
  await expect(popup.getByText("Passwords do not match")).toBeVisible();
  await popup.getByRole("button", { name: /Create Key/i }).click();
  await expect(popup.getByRole("alert").first()).toBeVisible();
  await auditor.audit(popup, "onboarding create with password errors");
  await popup.reload();

  await expect(welcome).toBeVisible({ timeout: 15_000 });
  await popup.getByText("Import Existing Key", { exact: true }).click();
  await expect(popup.getByRole("heading", { name: "Import Your Key" })).toBeVisible();
  await auditor.audit(popup, "onboarding import");
  await popup.getByLabel("Key Name").fill("Imported Audit Key");
  await popup.getByLabel("Private Key (nsec)").fill(VECTOR_NSEC);
  await popup.getByRole("button", { name: "Continue" }).click();
  await expect(popup.getByRole("heading", { name: "Secure Your Key" })).toBeVisible();
  await auditor.audit(popup, "onboarding import password step");
  await popup.reload();

  await expect(welcome).toBeVisible({ timeout: 15_000 });
  await popup.getByText("Quick start", { exact: true }).click();
  await expect(popup.getByRole("heading", { name: "Quick start" })).toBeVisible();
  await auditor.audit(popup, "onboarding quick start");
  await popup.getByLabel("Master Password").fill("short");
  await popup.getByLabel("Confirm Password").fill("short");
  await popup.getByRole("button", { name: "Create identity" }).click();
  await expect(popup.getByRole("alert").first()).toBeVisible();
  await auditor.audit(popup, "onboarding quick start with password error");

  await popup.getByLabel("Master Password").fill(PASSWORD);
  await popup.getByLabel("Confirm Password").fill(PASSWORD);
  await popup.getByRole("button", { name: "Create identity" }).click();
  await expect(popup.getByRole("heading", { name: "Your identity is ready" })).toBeVisible({
    timeout: 20_000,
  });
  await auditor.audit(popup, "onboarding quick start notice");
  await popup.getByRole("button", { name: "Continue" }).click();
  await expect(popup.getByRole("heading", { level: 2, name: FIRST_KEY })).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * A second key, a profile with a picture, three sites (one that may read both
 * identities), and a relay list that cannot answer.
 */
async function seedVault(popup: Page): Promise<void> {
  await sendExtensionRpc(popup, {
    type: "vault.generate",
    password: PASSWORD,
    label: SECOND_KEY,
  });
  const keys = await sendExtensionRpc<Array<{ id: string; label: string; pubkey: string }>>(
    popup,
    { type: "keys.list" }
  );
  const first = keys.find((k) => k.label === FIRST_KEY)!;
  const second = keys.find((k) => k.label === SECOND_KEY)!;
  // The run outlasts the default auto-lock, which would turn every later
  // surface into a lock screen.
  await sendExtensionRpc(popup, {
    type: "settings.update",
    patch: { relays: ["wss://localhost:1"], autoLockMinutes: 60 },
    password: PASSWORD,
  });
  await sendExtensionRpc(popup, {
    type: "policy.setOrigin",
    origin: DAPP_ORIGIN,
    patch: { trustLevel: "high", identityDisclosure: "allow", name: "Fixture dapp" },
    password: PASSWORD,
  });
  // A disclosure grant belongs to the key selected when it is made, so the
  // site reads two identities only if it is granted once under each.
  await sendExtensionRpc(popup, { type: "vault.select", id: second.id });
  await sendExtensionRpc(popup, {
    type: "policy.setOrigin",
    origin: DAPP_ORIGIN,
    patch: { identityDisclosure: "allow" },
    password: PASSWORD,
  });
  await sendExtensionRpc(popup, { type: "vault.select", id: first.id });
  await sendExtensionRpc(popup, {
    type: "policy.setOrigin",
    origin: "https://snort.social",
    patch: { trustLevel: "medium" },
  });
  await sendExtensionRpc(popup, {
    type: "policy.setOrigin",
    origin: "https://primal.net",
    patch: { trustLevel: "low", identityDisclosure: "deny" },
  });

  // Saved over RPC rather than through the Profile form, which would load the
  // picture URL: nothing in this run may reach a real host. The header reads
  // only the stored local copy, and Refresh picture needs a URL on the profile.
  // The publish has nowhere to go and says so; the optimistic write to the
  // profile cache, which is what the Profile page reads, happens first.
  await sendExtensionRpc(popup, {
    type: "profile.update",
    params: {
      metadata: {
        name: "audit",
        display_name: FIRST_KEY,
        about: "Signs things locally.",
        website: "https://localhost:1",
        picture: "https://localhost:1/avatar.png",
      },
    },
  }).catch((error: Error) => {
    if (!/Publish failed on all relays/.test(error.message)) throw error;
  });
  const picture = twoToneImage(48, 48, [93, 63, 211], [244, 240, 255]);
  await sendExtensionRpc(popup, {
    type: "avatar.save",
    pubkey: first.pubkey,
    sourceUrl: "https://localhost:1/avatar.png",
    dataUrl: `data:image/png;base64,${picture.toString("base64")}`,
  });
}

/**
 * Signed activity, one denial, and a queue of three pending requests across two
 * origins, one of them over the auto-sign budget. Returns with the queue still
 * pending so the approval window can be judged with it.
 */
async function seedActivityAndQueue(
  popup: Page,
  context: BrowserContext
): Promise<{ dapp: Page; alt: Page }> {
  await grantKindAllow(popup, DAPP_ORIGIN, 7, PASSWORD);
  const dapp = await openDapp(context);

  await dapp.evaluate(async () => {
    for (let i = 0; i < 60; i++) {
      await window.testSignEvent({
        kind: 7,
        content: "+",
        tags: [],
        created_at: Math.floor(Date.now() / 1000) + i,
      });
    }
  });

  // Kind 1 is protected, so it prompts; deny it so the log carries a refusal.
  await dapp.evaluate(() => {
    void window
      .testSignEvent({ kind: 1, content: "Declined note", tags: [], created_at: Math.floor(Date.now() / 1000) })
      .catch(() => undefined);
  });
  await resolveFirst(popup, "deny");

  await dapp.evaluate(() => {
    void window
      .testSignEvent({ kind: 1, content: "A note waiting for approval", tags: [], created_at: Math.floor(Date.now() / 1000) })
      .catch(() => undefined);
    void window
      .testSignEvent({ kind: 7, content: "the sixty-first", tags: [], created_at: Math.floor(Date.now() / 1000) + 61 })
      .catch(() => undefined);
  });

  const alt = await context.newPage();
  await alt.goto(`${ALT_ORIGIN}/test-page.html`);
  await expect(alt.locator("#status")).toHaveText("window.nostr available");
  await alt.evaluate(() => {
    void window.testGetPublicKey().catch(() => undefined);
  });

  await expect
    .poll(async () => (await pending(popup)).length, { timeout: 15_000 })
    .toBe(3);
  return { dapp, alt };
}

async function pending(popup: Page): Promise<Array<{ id: string }>> {
  const data = await sendExtensionRpc<{ requests: Array<{ id: string }> }>(popup, {
    type: "approval.getAll",
  });
  return data.requests;
}

async function resolveFirst(popup: Page, action: string): Promise<void> {
  await expect.poll(async () => (await pending(popup)).length, { timeout: 10_000 }).toBeGreaterThan(0);
  const [first] = await pending(popup);
  await sendExtensionRpc(popup, { type: "approval.resolve", requestId: first.id, action });
}

async function resolveAll(popup: Page, action: string): Promise<void> {
  for (const request of await pending(popup)) {
    await sendExtensionRpc(popup, { type: "approval.resolve", requestId: request.id, action });
  }
}

async function auditApprovalWindow(
  context: BrowserContext,
  extensionId: string,
  popup: Page,
  auditor: Auditor
): Promise<void> {
  const approval = await waitForApprovalPage(context, extensionId);
  await auditor.prepare(approval);
  await approval.reload();
  const items = approval.getByTestId("approval-request-item");
  await expect(items.first()).toBeVisible({ timeout: 15_000 });

  // Wide: the queue and the open request side by side, as a popup window opens.
  // Only the first site's rows are unfolded; the others are folded away.
  await auditor.audit(approval, "approval queue and detail, wide");
  const folded = approval.getByRole("button", { expanded: false });
  for (let i = await folded.count(); i > 0; i--) await folded.first().click();

  // Compact: one pane at a time, with a way back to the queue.
  await approval.setViewportSize({ width: 400, height: 600 });
  const back = approval.getByRole("button", { name: "Back to approval queue" });
  if (await back.isVisible().catch(() => false)) await back.click();
  await expect(items.first()).toBeVisible();
  await auditor.audit(approval, "approval queue, compact");

  const count = await items.count();
  expect(count, "the queue should hold all three pending requests").toBe(3);
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    await items.nth(i).click();
    await expect(
      approval.locator('[data-testid="approval-detail"], [data-testid="disclosure-detail"]')
    ).toBeVisible({ timeout: 10_000 });
    const kind = (await approval.getByTestId("auto-sign-budget-notice").isVisible())
      ? "over the auto-sign budget"
      : (await approval.getByTestId("disclosure-detail").isVisible())
        ? "public key request"
        : "signing request";
    seen.add(kind);
    await auditor.audit(approval, `approval detail, ${kind}`);
    await back.click();
    await expect(items.first()).toBeVisible();
  }
  expect([...seen].sort(), "each kind of request should have been judged").toEqual([
    "over the auto-sign budget",
    "public key request",
    "signing request",
  ]);

  await resolveAll(popup, "deny");
  await approval.close().catch(() => undefined);
}

async function auditPopupScreens(popup: Page, auditor: Auditor): Promise<void> {
  await popup.reload();
  await expect(popup.getByRole("heading", { level: 2, name: FIRST_KEY })).toBeVisible({
    timeout: 20_000,
  });
  await expect(popup.getByRole("region", { name: "Backup reminder" })).toBeVisible();
  await expect(popup.getByRole("region", { name: "Recent activity" })).toBeVisible({
    timeout: 15_000,
  });
  await auditor.audit(popup, "home with backup banner");

  await popup.getByLabel("Select active key").click();
  await expect(popup.getByRole("menuitemradio").first()).toBeVisible();
  await auditor.audit(popup, "home key selector open");
  await popup.keyboard.press("Escape");

  await popupNav(popup, /Profile/i).click();
  await expect(popup.getByText("Profile Settings")).toBeVisible();
  const edit = popup.getByRole("button", { name: /Edit Profile/i });
  await expect(edit).toBeEnabled({ timeout: 30_000 });
  await expect(popup.getByRole("button", { name: "Refresh picture" })).toBeVisible();
  await expect(popup.locator("header img")).toBeVisible();
  await auditor.audit(popup, "profile view");
  await edit.click();
  await expect(popup.getByRole("button", { name: /Cancel/i })).toBeVisible();
  await auditor.audit(popup, "profile edit");
  await popup.getByRole("button", { name: /Cancel/i }).click();

  await popupNav(popup, /Activity/i).click();
  await expect(popup.getByText("Recent Activity")).toBeVisible();
  await expect(popup.getByText(/reaction/i).first()).toBeVisible();
  await auditor.audit(popup, "popup activity");
  await popup.getByLabel("Filter by event kind").click();
  await expect(popup.getByRole("option").first()).toBeVisible();
  await auditor.audit(popup, "popup activity, kind filter open");
  await popup.keyboard.press("Escape");

  await popupNav(popup, /Settings/i).click();
  await expect(popup.getByText("Quick controls for this signer window.")).toBeVisible();
  await auditor.audit(popup, "popup settings");

  await popupNav(popup, /Home/i).click();
}

async function auditOptions(
  context: BrowserContext,
  extensionId: string,
  auditor: Auditor
): Promise<void> {
  const options = await openExtensionPage(
    context,
    auditor,
    `chrome-extension://${extensionId}/options.html`,
    { width: 1280, height: 900 }
  );
  await expect(options.getByText("Ostrilo Settings")).toBeVisible({ timeout: 15_000 });

  const tabs: Array<[string, string]> = [
    ["General", "settings general"],
    ["Keys & Identities", "settings keys"],
    ["Security", "settings security"],
    ["Permissions", "settings permissions"],
    ["Activity Log", "settings activity"],
    ["Relays", "settings relays"],
    ["Advanced", "settings advanced"],
  ];
  for (const [label, surface] of tabs) {
    await options.getByRole("tab", { name: label }).click();
    await options.waitForTimeout(300);
    await auditor.audit(options, surface);
  }

  await options.getByRole("tab", { name: "Keys & Identities" }).click();
  await options.getByRole("button", { name: `Back up ${FIRST_KEY}` }).click();
  const reauth = options.getByRole("dialog");
  await expect(reauth).toBeVisible();
  await auditor.audit(options, "settings keys re-authenticate dialog");
  await reauth.locator("#reauth-password").fill(PASSWORD);
  await reauth.getByRole("button", { name: "Confirm" }).click();

  const backup = options.getByRole("dialog", { name: `Back up “${FIRST_KEY}”` });
  await expect(backup).toBeVisible({ timeout: 20_000 });
  await auditor.audit(options, "settings keys back up dialog");

  await backup.getByLabel("Backup passphrase", { exact: true }).fill(BACKUP_PASSPHRASE);
  await backup.getByLabel("Confirm backup passphrase", { exact: true }).fill(BACKUP_PASSPHRASE);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ostrilo-a11y-"));
  try {
    const downloaded = options.waitForEvent("download", { timeout: 30_000 });
    await backup.getByRole("button", { name: "Save file" }).click();
    const file = path.join(dir, "backup.json");
    await (await downloaded).saveAs(file);
    await expect(backup.getByLabel("Choose backup file")).toBeAttached();
    await auditor.audit(options, "settings keys back up dialog with file check");
    await backup.getByLabel("Choose backup file").setInputFiles(file);
    await backup.getByLabel("Backup passphrase", { exact: true }).fill(BACKUP_PASSPHRASE);
    await backup.getByRole("button", { name: "Check file" }).click();
    await expect(backup.getByText("Backup verified")).toBeVisible({ timeout: 20_000 });
    await auditor.audit(options, "settings keys back up dialog verified");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  await options.close();
}

async function auditLockStates(
  context: BrowserContext,
  extensionId: string,
  popup: Page,
  auditor: Auditor
): Promise<void> {
  await popupNav(popup, /Lock extension/i).click();
  await expect(popup.getByTestId("lock-reason")).toHaveText("You locked Ostrilo.", {
    timeout: 15_000,
  });
  await auditor.audit(popup, "lock screen");

  const field = popup.getByLabel(/master password/i).first();
  await field.fill("not-the-password");
  await popup.getByRole("button", { name: "Unlock" }).click();
  await expect(popup.getByRole("alert").first()).toBeVisible({ timeout: 15_000 });
  await auditor.audit(popup, "lock screen with wrong password");

  await field.fill(PASSWORD);
  await popup.getByRole("button", { name: "Unlock" }).click();
  await expect(popup.getByRole("heading", { level: 2, name: FIRST_KEY })).toBeVisible({
    timeout: 15_000,
  });

  // The background not answering is simulated at the page, which is the only
  // seam a surface has to it: state.getLock is the first call a surface makes.
  const unreachable = await context.newPage();
  await auditor.prepare(unreachable);
  await unreachable.setViewportSize({ width: 390, height: 700 });
  await unreachable.addInitScript(() => {
    const runtime = (globalThis as unknown as { chrome: { runtime: { sendMessage: unknown } } })
      .chrome.runtime;
    const original = (runtime.sendMessage as (...args: unknown[]) => unknown).bind(runtime);
    runtime.sendMessage = (...args: unknown[]) => {
      const message = args[0] as { type?: string } | undefined;
      if (message?.type === "state.getLock") {
        return Promise.reject(new Error("The message port closed before a response was received."));
      }
      return original(...args);
    };
  });
  await unreachable.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(unreachable.getByRole("heading", { name: "Can't reach Ostrilo" })).toBeVisible({
    timeout: 15_000,
  });
  await auditor.audit(unreachable, "background unreachable");
  await unreachable.close();
}

/**
 * Damages the second key's stored record and unlocks again: the vault opens
 * with the first key and names the second unreadable, which is the state Home,
 * Profile and Settings must draw for a selected key that cannot be read.
 */
async function auditUnreadableKey(popup: Page, auditor: Auditor): Promise<void> {
  const keys = await sendExtensionRpc<Array<{ id: string; label: string }>>(popup, {
    type: "keys.list",
  });
  const second = keys.find((k) => k.label === SECOND_KEY);
  if (!second) throw new Error("seeded second key is missing");
  await sendExtensionRpc(popup, { type: "vault.select", id: second.id });
  await popup.evaluate(async (id) => {
    const chromeApi = (globalThis as unknown as {
      chrome: { storage: { local: { get: (k: string) => Promise<Record<string, unknown>>; set: (v: unknown) => Promise<void> } } };
    }).chrome;
    const { encryptedKeys } = (await chromeApi.storage.local.get("encryptedKeys")) as {
      encryptedKeys: Array<Record<string, unknown> & { id: string }>;
    };
    // Flipping the low bit of every byte breaks the AEAD tag, which is what a
    // bit-rotted record looks like to the vault.
    const damaged = encryptedKeys.map((record) =>
      record.id === id
        ? { ...record, ct: (record.ct as number[]).map((byte) => byte ^ 1) }
        : record
    );
    await chromeApi.storage.local.set({ encryptedKeys: damaged });
  }, second.id);
  await sendExtensionRpc(popup, { type: "vault.lock" });
  await popup.reload();
  await popup.getByLabel(/master password/i).first().fill(PASSWORD);
  await popup.getByRole("button", { name: "Unlock" }).click();
  await expect(popup.getByText(/could not be read/i).first()).toBeVisible({ timeout: 20_000 });
  await auditor.audit(popup, "home with an unreadable key");

  await popupNav(popup, /Profile/i).click();
  await expect(popup.getByText("Profile Settings")).toBeVisible();
  await auditor.audit(popup, "profile with an unreadable key");
}

test("known false positives drop only the nodes Radix produced", async ({ page }) => {
  // Two regions hidden from assistive technology that still hold a focusable
  // button. Only the first carries the marker Radix's own hiding leaves.
  await page.setContent(`<!doctype html><html lang="en"><head><title>probe</title></head><body>
    <main aria-hidden="true" data-aria-hidden="true"><button>Behind a Radix popover</button></main>
    <section aria-hidden="true" id="ours"><button>Hidden by our own markup</button></section>
  </body></html>`);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const hidden = violations.find((v) => v.id === "aria-hidden-focus");
  expect(hidden?.nodes, "the probe should trip aria-hidden-focus on both regions").toHaveLength(2);

  const kept = unexplainedNodes("key selector open (light)", "aria-hidden-focus", hidden!.nodes);
  expect(kept.map((n) => n.target.join(" "))).toEqual(["#ours"]);

  // The same node on a surface with no entry, or under another rule, is kept.
  expect(unexplainedNodes("home (light)", "aria-hidden-focus", hidden!.nodes)).toHaveLength(2);
  expect(unexplainedNodes("key selector open (light)", "color-contrast", hidden!.nodes)).toHaveLength(2);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: no serious or critical violations across every surface (${theme})`, async ({
    openPopup,
    extensionContext,
    extensionId,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
    test.setTimeout(300_000);

    const auditor = new Auditor(theme);
    const popup = await openPopup();
    await auditor.prepare(popup);
    await popup.setViewportSize({ width: 390, height: 700 });
    await popup.reload();

    await auditOnboarding(popup, auditor);
    await seedVault(popup);
    const { dapp, alt } = await seedActivityAndQueue(popup, extensionContext);
    await auditApprovalWindow(extensionContext, extensionId, popup, auditor);
    await dapp.close();
    await alt.close();

    await auditPopupScreens(popup, auditor);
    await auditOptions(extensionContext, extensionId, auditor);
    await auditLockStates(extensionContext, extensionId, popup, auditor);
    await auditUnreadableKey(popup, auditor);

    await testInfo.attach(`axe-findings-${theme}.json`, {
      body: JSON.stringify(auditor.findings, null, 2),
      contentType: "application/json",
    });
    const minor = auditor.findings.filter((f) => f.impact === "moderate" || f.impact === "minor");
    console.log(`audited ${auditor.surfaces.length} surfaces (${theme}); findings ${auditor.findings.length}`);
    if (minor.length > 0) console.log(`axe moderate/minor (${theme}):\n${format(minor)}`);

    for (const required of REQUIRED_SURFACES) {
      expect(
        auditor.surfaces.some((name) => name.startsWith(required)),
        `no audit of "${required}" ran`
      ).toBe(true);
    }
    expect(
      format(auditor.blocking()),
      "serious or critical axe violations (each surface is named in the line)"
    ).toBe("");
  });
}
