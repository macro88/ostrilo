import { test, expect, Page } from "./fixtures/extension";

/**
 * `nostr.getPublicKey` answered any https page silently, as often as it was
 * asked, while the vault was unlocked. It carried no origin, so the background
 * could not have gated it even if it had wanted to.
 *
 * The harm is linkage, not secrecy: the npub is published on relays. What is
 * being protected is the user's ability to decide which sites tie their
 * browsing to that identity — and, for a script that never asks to sign, this
 * is the only gate that will ever run.
 */

const PASSWORD = "Lantern-Thicket-Cobalt-2026!";
const DAPP_ORIGIN = "https://localhost:8765";
const DAPP_URL = `${DAPP_ORIGIN}/test-page.html`;

type RpcResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { data?: { errorCode?: string } } };

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
  const response = await rpc<T>(page, message);
  if (!response.ok) {
    throw new Error(`rpc failed: ${JSON.stringify(response)}`);
  }
  return response.data;
}

async function createAndUnlock(page: Page) {
  await rpcOk(page, {
    type: "vault.generate",
    password: PASSWORD,
    label: "Disclosure E2E Key",
  });
  await rpcOk(page, { type: "vault.unlock", password: PASSWORD });
  await rpcOk(page, {
    type: "settings.update",
    patch: {
      sidePanel: false,
      onboardingCompleted: true,
      onboardingCompletedAt: Date.now(),
    },
  });
}

/** Asks for the public key without awaiting, so the prompt can be driven. */
async function askForPublicKey(dapp: Page) {
  await dapp.evaluate(() => {
    (globalThis as any).__disclosureResult = window
      .nostr!.getPublicKey()
      .then((value: string) => ({ ok: true, value }))
      .catch((error: Error) => ({ ok: false, error: error.message }));
  });
}

async function readDisclosureResult(dapp: Page) {
  return await dapp.evaluate(
    () => (globalThis as any).__disclosureResult as Promise<unknown>
  );
}

async function openDapp(dapp: Page) {
  await dapp.goto(DAPP_URL);
  await dapp.waitForFunction(() => typeof window.nostr !== "undefined", {
    timeout: 5000,
  });
}

async function waitForApprovalPage(extensionContext: any, extensionId: string) {
  const prefix = `chrome-extension://${extensionId}/approval.html`;
  const existing = extensionContext
    .pages()
    .find((page: Page) => page.url().startsWith(prefix));
  const approvalPage =
    existing ??
    (await extensionContext.waitForEvent("page", {
      predicate: (page: Page) => page.url().startsWith(prefix),
      timeout: 10_000,
    }));
  await approvalPage.setViewportSize({ width: 960, height: 640 });
  await approvalPage.waitForLoadState("domcontentloaded");
  return approvalPage;
}

test.describe("identity disclosure consent", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("an unconsented page is prompted, and approving returns the key", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await createAndUnlock(popup);

    const dapp = await extensionContext.newPage();
    await openDapp(dapp);
    await askForPublicKey(dapp);

    // The whole point: an unlocked vault is no longer sufficient.
    const approvalPage = await waitForApprovalPage(
      extensionContext,
      extensionId
    );
    await approvalPage.getByTestId("approval-request-item").first().click();

    const detail = approvalPage.getByTestId("disclosure-detail");
    await expect(detail).toBeVisible({ timeout: 10_000 });
    // The copy must not call the public key a secret — it is on relays.
    await expect(detail).toContainText(/not a secret/i);
    await expect(detail).toContainText(/linkage/i);

    const share = approvalPage.getByRole("button", {
      name: "Share public key",
    });
    await expect(share).toBeEnabled({ timeout: 5_000 });
    await share.click();

    const result = (await readDisclosureResult(dapp)) as {
      ok: boolean;
      value?: string;
    };
    expect(result.ok).toBe(true);
    expect(result.value).toMatch(/^[0-9a-f]{64}$/);
  });

  test("denying rejects with the disclosure code, not the signing one", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await createAndUnlock(popup);

    const dapp = await extensionContext.newPage();
    await openDapp(dapp);
    await askForPublicKey(dapp);

    const approvalPage = await waitForApprovalPage(
      extensionContext,
      extensionId
    );
    await approvalPage.getByTestId("approval-request-item").first().click();
    await expect(approvalPage.getByTestId("disclosure-detail")).toBeVisible({
      timeout: 10_000,
    });
    // Scoped to the detail pane: the queue list carries its own "Deny all".
    await approvalPage
      .getByTestId("disclosure-detail")
      .getByRole("button", { name: "Deny" })
      .click();

    const result = (await readDisclosureResult(dapp)) as {
      ok: boolean;
      error?: string;
    };
    expect(result.ok).toBe(false);
    // A client must be able to tell a refused IDENTITY from a refused
    // SIGNATURE: retrying makes sense for one and not the other.
    expect(result.error).toContain("disclosure_refused");
    expect(result.error).not.toBe("denied");
  });

  test("a consented origin is not prompted again", async ({
    openPopup,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await createAndUnlock(popup);
    await rpcOk(popup, {
      type: "policy.setOrigin",
      origin: DAPP_ORIGIN,
      patch: { identityDisclosure: "allow" },
    });

    const dapp = await extensionContext.newPage();
    await openDapp(dapp);

    const pubkey = await dapp.evaluate(() => window.nostr!.getPublicKey());
    expect(pubkey).toMatch(/^[0-9a-f]{64}$/);

    const approvalWindows = extensionContext
      .pages()
      .filter((page: Page) => page.url().includes("/approval.html"));
    expect(approvalWindows).toHaveLength(0);
  });

  test("a denied origin cannot re-summon the prompt by reloading", async ({
    openPopup,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await createAndUnlock(popup);
    await rpcOk(popup, {
      type: "policy.setOrigin",
      origin: DAPP_ORIGIN,
      patch: { identityDisclosure: "deny" },
    });

    const dapp = await extensionContext.newPage();

    // Without remembered deny, any https origin could re-summon a focused OS
    // window on every page load — the abuse shape this codebase removed once
    // already when it deleted `openUnlockPrompt`.
    for (let i = 0; i < 3; i++) {
      await openDapp(dapp);
      const result = await dapp.evaluate(async () => {
        try {
          return { ok: true, value: await window.nostr!.getPublicKey() };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("disclosure_refused");
      await dapp.reload();
    }

    const approvalWindows = extensionContext
      .pages()
      .filter((page: Page) => page.url().includes("/approval.html"));
    expect(
      approvalWindows,
      "SECURITY REGRESSION: a denied origin re-opened the approval window"
    ).toHaveLength(0);
  });

  test("a locked vault refuses without prompting", async ({
    openPopup,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await createAndUnlock(popup);
    await rpcOk(popup, { type: "vault.lock" });

    const dapp = await extensionContext.newPage();
    await openDapp(dapp);

    const result = await dapp.evaluate(async () => {
      try {
        return { ok: true, value: await window.nostr!.getPublicKey() };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("locked");

    const approvalWindows = extensionContext
      .pages()
      .filter((page: Page) => page.url().includes("/approval.html"));
    expect(approvalWindows).toHaveLength(0);
  });

  test("a polling origin is rate limited", async ({
    openPopup,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await createAndUnlock(popup);
    await rpcOk(popup, {
      type: "policy.setOrigin",
      origin: DAPP_ORIGIN,
      patch: { identityDisclosure: "allow" },
    });

    const dapp = await extensionContext.newPage();
    await openDapp(dapp);

    // A tab left open used to poll in a loop and capture the npub the
    // millisecond the vault unlocked. The auto-lock timeout is no defence
    // against that; the per-origin allowance is.
    const outcomes = await dapp.evaluate(async () => {
      const results: string[] = [];
      for (let i = 0; i < 12; i++) {
        try {
          await window.nostr!.getPublicKey();
          results.push("ok");
        } catch (err) {
          results.push(err instanceof Error ? err.message : String(err));
        }
      }
      return results;
    });

    expect(outcomes.some((o) => o.includes("rate_limited"))).toBe(true);
  });
});
