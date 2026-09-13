import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";

const PASSWORD = "Juniper-Bramble-Saffron-2026!";
const DAPP_ORIGIN = "http://127.0.0.1:8765";
const DAPP_URL = `${DAPP_ORIGIN}/test-page.html`;

type RpcResponse<T = unknown> =
  | { ok: true; data: T }
  | {
      ok: false;
      error:
        | string
        | { message: string; data?: { errorCode?: string }; details?: string };
      details?: string;
    };

type SignedEventResult =
  | { success: true; signed: { kind: number; sig: string } }
  | { success: false; error: string };

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
    const error = response.error;
    const code =
      typeof error === "string"
        ? error
        : error.data?.errorCode ?? error.details ?? error.message;
    throw new Error(`RPC ${String(message.type)} failed: ${code}`);
  }

  return response.data;
}

async function completeCreateKeyOnboarding(page: Page) {
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(page.getByRole("heading", { name: "Welcome to Ostrilo" }))
    .toBeVisible();

  await page.getByText("Create New Key", { exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Create Your Nostr Key" }))
    .toBeVisible();
  await page.getByLabel("Key Name").fill("Remembered Allow Test Key");
  await page.getByLabel("Master Password").fill(PASSWORD);
  await page.getByLabel("Confirm Password").fill(PASSWORD);
  await expect(page.getByText(/Good|Strong/)).toBeVisible();

  await page.getByRole("button", { name: /Create Key/i }).click();
  await expect(page.getByRole("heading", { name: "Backup Your Key" }))
    .toBeVisible({ timeout: 15_000 });
  // Finish is gated on backup verification, not on the acknowledgement
  // checkbox. Reveal, read the key, and re-enter its last 8 characters.
  await page.getByRole("button", { name: "Reveal Private Key" }).click();
  await page.getByRole("button", { name: "Show private key" }).click();
  const nsec = await page.getByLabel("Private Key (nsec format)").inputValue();
  await page
    .getByRole("checkbox", { name: "Confirm private key backup" })
    .check();
  await page.getByLabel("Last 8 characters of your nsec").fill(nsec.slice(-8));
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByText("Backup verified")).toBeVisible();
  await page.getByRole("button", { name: "Finish" }).click();

  await expect(
    page.getByRole("heading", { level: 2, name: "Remembered Allow Test Key" })
  ).toBeVisible({ timeout: 15_000 });
}

async function signEventFromDapp(
  dapp: Page,
  content: string
): Promise<SignedEventResult> {
  return dapp.evaluate(async (eventContent) => {
    try {
      const signed = await window.testSignEvent({
        kind: 10002,
        content: eventContent,
        tags: [["r", "wss://relay.primal.net", "read"]],
        created_at: Math.floor(Date.now() / 1000),
      });

      return { success: true, signed };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, content);
}

async function readRelayListRule(page: Page): Promise<string | undefined> {
  const settings = await sendExtensionRpc<{
    origins: Array<{ origin: string; rules?: Record<string, string> }>;
  }>(page, { type: "settings.get" });
  return settings.origins.find((origin) => origin.origin === DAPP_ORIGIN)
    ?.rules?.["10002"];
}

test.describe("Remembered site signing policy", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("remembered allow saves a visible rule and auto-signs the next matching request", async ({
    openPopup,
    openOptions,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await completeCreateKeyOnboarding(popup);

    const dapp = await extensionContext.newPage();
    await dapp.goto(DAPP_URL);
    await expect(dapp.locator("#status")).toHaveText("window.nostr available");

    const approvalPagePromise = extensionContext.waitForEvent("page");
    const firstSignPromise = signEventFromDapp(
      dapp,
      "First relay list request should prompt"
    );

    await expect
      .poll(async () => {
        const data = await sendExtensionRpc<{
          requests: Array<{ id: string; event: { kind: number } }>;
        }>(popup, { type: "approval.getAll" });
        return data.requests.length;
      })
      .toBe(1);

    const approvalPage = await approvalPagePromise;
    await approvalPage.waitForLoadState("domcontentloaded");
    await approvalPage.getByTestId("approval-request-item").click();
    await expect(approvalPage.getByTestId("approval-detail")).toBeVisible();
    await expect(approvalPage.getByTestId("remember-scope-copy")).toContainText(
      "Remember this decision for this site and event kind"
    );
    await expect(approvalPage.getByTestId("remember-scope-copy")).toContainText(
      "Kind 10002"
    );

    await approvalPage
      .getByLabel("Remember this decision for this site and event kind")
      .check();
    await approvalPage.getByRole("button", { name: "Approve & sign" }).click();

    const firstSign = await firstSignPromise;
    expect(firstSign.success).toBe(true);
    if (firstSign.success) {
      expect(firstSign.signed.kind).toBe(10002);
      expect(firstSign.signed.sig).toMatch(/^[0-9a-f]{128}$/);
    }

    await expect.poll(() => readRelayListRule(popup)).toBe("allow");

    const secondSign = await signEventFromDapp(
      dapp,
      "Second relay list request should auto-sign"
    );
    expect(secondSign.success).toBe(true);
    if (secondSign.success) {
      expect(secondSign.signed.kind).toBe(10002);
      expect(secondSign.signed.sig).toMatch(/^[0-9a-f]{128}$/);
    }

    const queueAfterSecond = await sendExtensionRpc<{
      requests: Array<{ id: string }>;
    }>(popup, { type: "approval.getAll" });
    expect(queueAfterSecond.requests).toHaveLength(0);

    const options = await openOptions();
    await options.getByRole("tab", { name: "Permissions" }).click();
    await expect(
      options.getByRole("heading", { name: "Permissions" })
    ).toBeVisible();
    await expect(options.getByText(DAPP_ORIGIN)).toBeVisible();

    const relayListRule = options.getByTestId("origin-policy-kind-10002");
    await expect(relayListRule).toContainText("Relay List");
    await expect(relayListRule.getByRole("button", { name: "Allow" }))
      .toHaveAttribute("aria-pressed", "true");

    await relayListRule.getByRole("button", { name: "Ask" }).click();
    await expect.poll(() => readRelayListRule(popup)).toBe("ask");
  });
});
