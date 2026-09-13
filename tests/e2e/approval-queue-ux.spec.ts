import { test, expect, Page } from "./fixtures/extension";

const PASSWORD = "Lantern-Thicket-Cobalt-2026!";
const DAPP_ORIGIN = "https://localhost:8765";
// A genuinely different origin, on the same server and the same throwaway
// certificate (its SAN covers both names). The de-duplication tests exist to
// prove that two origins asking for a byte-identical event get two separate
// approvals, so these two constants must not collapse to one value.
const ALT_DAPP_ORIGIN = "https://127.0.0.1:8765";
const DAPP_URL = `${DAPP_ORIGIN}/test-page.html`;
const ALT_DAPP_URL = `${ALT_DAPP_ORIGIN}/test-page.html`;

type RpcResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: RpcErrorObject };

type RpcErrorObject = {
  code: number;
  message: string;
  data?: {
    errorCode?: string;
    details?: string;
  };
};

type SignResult =
  | {
      ok: true;
      value: { id: string; pubkey: string; sig: string; content: string };
    }
  | { ok: false; error: string };

function formatRpcError(error: RpcErrorObject): string {
  const code = error.data?.errorCode ?? error.message;
  const details = error.data?.details ? `: ${error.data.details}` : "";
  return `${code}${details}`;
}

async function sendExtensionRpc<T>(
  page: Page,
  message: Record<string, unknown>
): Promise<T> {
  const response = await page.evaluate(
    (rpcMessage) =>
      new Promise<RpcResponse<T>>((resolve, reject) => {
        const chromeApi = (globalThis as any).chrome;
        const runtime = chromeApi?.runtime;

        if (!runtime?.sendMessage) {
          reject(new Error("Extension runtime API is not available"));
          return;
        }

        runtime.sendMessage(rpcMessage, (value: RpcResponse<T>) => {
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

  if (!response.ok) {
    throw new Error(
      `RPC ${String(message.type)} failed: ${formatRpcError(response.error)}`
    );
  }

  return response.data;
}

async function configureUnlockedSigner(
  page: Page,
  origins: string[] = [DAPP_ORIGIN]
) {
  await sendExtensionRpc(page, {
    type: "vault.generate",
    password: PASSWORD,
    label: "Approval Queue E2E Key",
  });
  await sendExtensionRpc(page, {
    type: "vault.unlock",
    password: PASSWORD,
  });
  await sendExtensionRpc(page, {
    type: "settings.update",
    patch: {
      sidePanel: false,
      onboardingCompleted: true,
      onboardingCompletedAt: Date.now(),
    },
  });

  for (const origin of origins) {
    await sendExtensionRpc(page, {
      type: "policy.setKindRule",
      origin,
      kind: 1,
      mode: "ask",
    });
  }
}

async function openDapp(page: Page, url = DAPP_URL) {
  await page.goto(url);
  await expect(page.locator("#status")).toHaveText("window.nostr available");
}

function createUnsignedEvent(content: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: 1,
    content,
    tags: [],
    created_at: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

async function queueSignRequests(
  page: Page,
  events: Record<string, unknown>[]
) {
  await page.evaluate((eventsToSign) => {
    (globalThis as any).__ostriloSignResults = eventsToSign.map((event) =>
      (globalThis as any).testSignEvent(event).then(
        (value: unknown) => ({ ok: true, value }),
        (error: Error) => ({ ok: false, error: error.message })
      )
    );
  }, events);
}

async function readSignResults(page: Page): Promise<SignResult[]> {
  return page.evaluate(() =>
    Promise.all((globalThis as any).__ostriloSignResults)
  );
}

async function waitForApprovalPage(extensionContext: any, extensionId: string) {
  const approvalUrlPrefix = `chrome-extension://${extensionId}/approval.html`;
  const existing = extensionContext
    .pages()
    .find((page: Page) => page.url().startsWith(approvalUrlPrefix));

  const approvalPage =
    existing ??
    (await extensionContext.waitForEvent("page", {
      predicate: (page: Page) => page.url().startsWith(approvalUrlPrefix),
      timeout: 10_000,
    }));

  await approvalPage.setViewportSize({ width: 960, height: 640 });
  await approvalPage.waitForLoadState("domcontentloaded");
  await expect(approvalPage.getByTestId("approval-inbox")).toBeVisible({
    timeout: 10_000,
  });
  return approvalPage;
}

function approvalPages(extensionContext: any) {
  return extensionContext
    .pages()
    .filter((page: Page) => page.url().includes("/approval.html"));
}

async function waitForPageClosed(page: Page) {
  if (!page.isClosed()) {
    await page.waitForEvent("close", { timeout: 10_000 });
  }
}

/**
 * Approves every queued request, one at a time.
 *
 * "Approve all from site" is gone. Approving in bulk is approving without
 * looking, and the reliable way to get a signature a user did not mean to
 * give is to ask many times and offer one button that answers all of them.
 * Bulk DENY remains, so a user buried in prompts still has a way out.
 *
 * The detail pane also no longer re-binds to the next queued request after a
 * resolution, so each approval means: pick from the list, wait out the
 * approve cooldown, approve.
 */
async function approveEachRequest(approvalPage: Page, count: number) {
  for (let i = 0; i < count; i++) {
    const item = approvalPage.getByTestId("approval-request-item").first();
    await item.click();
    const approve = approvalPage.getByRole("button", {
      name: "Approve & sign",
    });
    // The approve action is disabled for 500ms whenever the pane binds to a
    // request it was not previously showing.
    await expect(approve).toBeEnabled({ timeout: 5_000 });
    await approve.click();

    const remaining = count - i - 1;
    if (remaining === 0) {
      // The window closes once the queue empties, so there is no locator
      // left to count. The caller asserts on the page closing instead.
      break;
    }
    await expect(
      approvalPage.getByTestId("approval-request-item")
    ).toHaveCount(remaining, { timeout: 10_000 });
  }
}

test.describe("Approval queue UX", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("queues concurrent requests in one inbox window and closes after batch approval", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await configureUnlockedSigner(popup);

    const dapp = await extensionContext.newPage();
    await openDapp(dapp);

    const events = Array.from({ length: 5 }, (_, index) =>
      createUnsignedEvent(`Concurrent approval request ${index + 1}`)
    );

    await queueSignRequests(dapp, events);
    const approvalPage = await waitForApprovalPage(extensionContext, extensionId);

    await expect(approvalPage.getByTestId("approval-request-item")).toHaveCount(
      5
    );
    expect(approvalPages(extensionContext)).toHaveLength(1);

    // Nothing is selected on arrival. The pane used to auto-bind to
    // requests[0] and to re-bind to the next one after every resolution, so
    // the approve button the user had just clicked reappeared under their
    // cursor bound to a DIFFERENT event.
    await expect(approvalPage.getByTestId("approval-detail")).toHaveCount(0);
    await approvalPage.getByTestId("approval-request-item").first().click();
    await expect(approvalPage.getByTestId("approval-detail")).toContainText(
      "Concurrent approval request 1"
    );

    await approveEachRequest(approvalPage, 5);

    const results = await readSignResults(dapp);
    expect(results).toHaveLength(5);
    for (const result of results) {
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toMatch(/^[0-9a-f]{64}$/);
        expect(result.value.sig).toMatch(/^[0-9a-f]{128}$/);
      }
    }

    await waitForPageClosed(approvalPage);
  });

  test("deduplicates identical events and resolves both callers from one approval", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await configureUnlockedSigner(popup);

    const dapp = await extensionContext.newPage();
    await openDapp(dapp);

    const duplicateEvent = createUnsignedEvent("Duplicate retry event", {
      created_at: 1_800_000_000,
      tags: [["e", "a".repeat(64)]],
    });

    await queueSignRequests(dapp, [duplicateEvent, duplicateEvent]);
    const approvalPage = await waitForApprovalPage(extensionContext, extensionId);

    await expect(approvalPage.getByTestId("approval-request-item")).toHaveCount(
      1
    );
    await approveEachRequest(approvalPage, 1);

    const results = await readSignResults(dapp);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.ok)).toBe(true);
    if (results[0].ok && results[1].ok) {
      expect(results[0].value.id).toBe(results[1].value.id);
      expect(results[0].value.sig).toMatch(/^[0-9a-f]{128}$/);
      expect(results[1].value.sig).toMatch(/^[0-9a-f]{128}$/);
    }

    await waitForPageClosed(approvalPage);
  });

  test("batch actions apply to one origin without resolving other origins", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await configureUnlockedSigner(popup, [DAPP_ORIGIN, ALT_DAPP_ORIGIN]);

    const dapp = await extensionContext.newPage();
    await openDapp(dapp, DAPP_URL);
    const altDapp = await extensionContext.newPage();
    await openDapp(altDapp, ALT_DAPP_URL);

    await queueSignRequests(dapp, [
      createUnsignedEvent("Origin A request 1"),
      createUnsignedEvent("Origin A request 2"),
      createUnsignedEvent("Origin A request 3"),
    ]);
    await queueSignRequests(altDapp, [
      createUnsignedEvent("Origin B request 1"),
      createUnsignedEvent("Origin B request 2"),
    ]);

    const approvalPage = await waitForApprovalPage(extensionContext, extensionId);

    await expect(approvalPage.getByTestId("approval-origin-group")).toHaveCount(
      2
    );
    await expect(approvalPage.getByTestId("approval-request-item")).toHaveCount(
      5
    );

    // Deny all from ORIGIN A, leaving origin B untouched. The test is about
    // batch actions being scoped to one origin; bulk approve no longer
    // exists, so the scoped action under test is the denial.
    const originAGroup = approvalPage
      .getByTestId("approval-origin-group")
      .filter({ hasText: "localhost:8765" })
      .first();
    await originAGroup
      .getByRole("button", { name: /Deny all from site/i })
      .click();

    await expect(approvalPage.getByTestId("approval-request-item")).toHaveCount(
      2
    );
    await expect(
      approvalPage
        .getByTestId("approval-request-item")
        .filter({ hasText: "Origin B request 1" })
    ).toBeVisible();

    // Now approve what is left, which is origin B only.
    await approveEachRequest(approvalPage, 2);

    const originAResults = await readSignResults(dapp);
    expect(
      originAResults.every((result) => !result.ok),
      "denying one origin must resolve only that origin's requests"
    ).toBe(true);

    const originBResults = await readSignResults(altDapp);
    expect(originBResults.every((result) => result.ok)).toBe(true);

    await waitForPageClosed(approvalPage);
  });

  test("shows full event details and reopens the queue from Activity after manual close", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await configureUnlockedSigner(popup);

    const dapp = await extensionContext.newPage();
    await openDapp(dapp);

    const longContent =
      "Full detail payload " +
      "x".repeat(120) +
      " should remain visible in the detail pane";
    await queueSignRequests(dapp, [
      createUnsignedEvent(longContent, {
        tags: [
          ["e", "b".repeat(64), "wss://relay.example"],
          ["p", "c".repeat(64)],
        ],
      }),
    ]);

    let approvalPage = await waitForApprovalPage(extensionContext, extensionId);

    await expect(approvalPage.getByTestId("approval-request-item")).toContainText(
      "Full detail payload"
    );
    await approvalPage.getByTestId("approval-request-item").first().click();
    await expect(approvalPage.getByTestId("approval-detail")).toContainText(
      longContent
    );
    await expect(approvalPage.getByTestId("approval-tags-json")).toContainText(
      "wss://relay.example"
    );
    await expect(
      approvalPage.getByTestId("approval-detail").getByText("Created", {
        exact: true,
      })
    ).toBeVisible();

    await approvalPage.close();
    await expect
      .poll(() => approvalPages(extensionContext).length)
      .toBe(0);

    const activityPopup = await openPopup();
    await activityPopup.getByRole("button", { name: "Activity" }).click();
    await expect(
      activityPopup.getByRole("button", { name: /Pending Approvals/i })
    ).toBeVisible();
    await activityPopup
      .getByRole("button", { name: /Open Approval Window/i })
      .click();

    approvalPage = await waitForApprovalPage(extensionContext, extensionId);
    // Reopening lands on the queue list, not on a pre-selected request:
    // the pane binds only to what the user picks.
    await approvalPage.getByTestId("approval-request-item").first().click();
    await expect(approvalPage.getByTestId("approval-detail")).toContainText(
      longContent
    );

    const closeAfterDeny = approvalPage.waitForEvent("close", {
      timeout: 10_000,
    });
    await approvalPage
      .getByTestId("approval-detail")
      .getByRole("button", { name: "Deny" })
      .click({ noWaitAfter: true })
      .catch((error: unknown) => {
        if (!approvalPage.isClosed()) {
          throw error;
        }
      });
    await closeAfterDeny.catch(() => {
      if (!approvalPage.isClosed()) {
        throw new Error("Approval window did not close after denial");
      }
    });

    const results = await readSignResults(dapp);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
  });
});

test.describe("approval flood controls", () => {
  test("refuses a flooding origin with rate_limited and offers no bulk approve", async ({
    openPopup,
    extensionContext,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    const popup = await openPopup();
    await configureUnlockedSigner(popup);

    const dapp = await extensionContext.newPage();
    await openDapp(dapp);

    // Fire more requests than the origin is allowed, without awaiting any of
    // them - which is exactly what a hostile page does.
    const outcomes = await dapp.evaluate(async () => {
      const attempts = Array.from({ length: 12 }, (_, i) =>
        window
          .nostr!.signEvent({
            kind: 1,
            created_at: Math.floor(Date.now() / 1000),
            tags: [],
            content: `flood ${i}`,
          })
          .then(() => "signed")
          .catch((err: unknown) =>
            err instanceof Error ? err.message : String(err)
          )
      );
      // Give the extension a moment to refuse the ones over the limit.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return Promise.race([
        Promise.all(attempts),
        new Promise<string[]>((resolve) =>
          setTimeout(() => resolve([]), 5000)
        ),
      ]);
    });

    // Whatever else happened, nothing was signed without a prompt, and at
    // least one attempt was refused outright.
    expect(
      outcomes.filter((o) => o === "signed"),
      "SECURITY REGRESSION: a flood produced signatures with no approval"
    ).toHaveLength(0);

    // Bulk approve is gone; bulk deny remains, because refusing without
    // looking is always safe and a user buried in prompts needs a way out.
    const approvalPages = extensionContext
      .pages()
      .filter((p) => p.url().includes("approval"));
    for (const approval of approvalPages) {
      const body = (await approval.textContent("body")) ?? "";
      expect(
        body,
        "SECURITY REGRESSION: bulk approve is back"
      ).not.toContain("Approve all from site");
    }
  });
});
