import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";

type RpcResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; details?: string };

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
      `RPC ${String(message.type)} failed: ${response.error}${
        response.details ? ` (${response.details})` : ""
      }`
    );
  }

  return response.data;
}

async function openOptionsFromRuntime(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const chromeApi = (globalThis as any).chrome;
        chromeApi.runtime.openOptionsPage(() => {
          const lastError = chromeApi.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
            return;
          }
          resolve();
        });
      })
  );
}

const PASSWORD = "Cobalt-Mantle-Trellis-2026!";

/**
 * The options page is lock-gated now: with no keys it shows onboarding
 * guidance, and with a locked vault it shows the lock screen. Neither state
 * renders the tabs, so every test here has to create and unlock a vault
 * before the page under test exists at all.
 */
async function createAndUnlock(page: Page) {
  await sendExtensionRpc(page, {
    type: "vault.generate",
    password: PASSWORD,
    label: "Options E2E Key",
  });
  await sendExtensionRpc(page, { type: "vault.unlock", password: PASSWORD });
}

test.describe("Options page", () => {
  test("opens from extension runtime and supports tab deep links", async ({
    openPopup,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await createAndUnlock(popup);
    const optionsPromise = extensionContext.waitForEvent("page");

    await openOptionsFromRuntime(popup);

    const options = await optionsPromise;
    await options.waitForLoadState("domcontentloaded");
    await expect(options).toHaveURL(/options\.html/);
    await expect(
      options.getByRole("heading", { name: "Ostrilo Settings" })
    ).toBeVisible();
    const loadDurationMs = await options.evaluate(() => {
      const [navigation] = performance.getEntriesByType(
        "navigation"
      ) as PerformanceNavigationTiming[];

      return navigation.domContentLoadedEventEnd - navigation.startTime;
    });

    expect(loadDurationMs).toBeLessThan(500);

    for (const tabName of [
      "General",
      "Keys & Identities",
      "Security",
      "Permissions",
      "Activity Log",
      "Relays",
      "Advanced",
    ]) {
      await expect(options.getByRole("tab", { name: tabName })).toBeVisible();
    }

    await options.getByRole("tab", { name: "Security" }).click();
    await expect(options).toHaveURL(/options\.html#security/);
    await expect(
      options.getByRole("heading", { name: "Security", exact: true })
    ).toBeVisible();

    const tabSwitchMs = await options.evaluate(async () => {
      const startedAt = performance.now();
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return performance.now() - startedAt;
    });

    expect(tabSwitchMs).toBeLessThan(100);
    await expect(options).toHaveURL(/options\.html#permissions/);

    await options.getByRole("tab", { name: "Relays" }).click();
    await expect(options).toHaveURL(/options\.html#relays/);

    await options.reload();
    await expect(options.getByRole("tab", { name: "Relays" })).toHaveAttribute(
      "data-state",
      "active"
    );
    await expect(options.getByRole("heading", { name: "Relays" })).toBeVisible();
  });

  test("syncs local settings updates between options and popup contexts", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await createAndUnlock(popup);
    const options = await openOptions();

    await options.getByRole("combobox", { name: "Theme" }).click();
    await options.getByRole("option", { name: "Dark" }).click();

    await expect
      .poll(() =>
        popup.evaluate(() => document.documentElement.classList.contains("dark"))
      )
      .toBe(true);

    await sendExtensionRpc(popup, {
      type: "settings.update",
      patch: { theme: "light" },
    });

    await expect
      .poll(() =>
        options.evaluate(() =>
          document.documentElement.classList.contains("dark")
        )
      )
      .toBe(false);
  });
});
