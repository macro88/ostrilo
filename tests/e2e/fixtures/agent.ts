/**
 * Shared helpers for driving the extension from a spec.
 *
 * These consolidate the `rpc`/`rpcOk`/`sendExtensionRpc` wrappers that several
 * specs each hand-roll. They add no capability: every privileged call below is
 * reachable only because the caller is an extension page, which is the same
 * seam the existing suite uses.
 */
import { expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

export const DAPP_ORIGIN = "https://localhost:8765";
export const DAPP_URL = `${DAPP_ORIGIN}/test-page.html`;
export const TEST_PASSWORD = "Marigold-Trellis-Pebble-2026!";

type RpcResponse<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: number;
        message: string;
        data?: { errorCode?: string; details?: string };
      };
    };

/**
 * Any extension page satisfies `isTrustedExtensionSender`, so the popup is a
 * full privileged RPC gateway. A web page reaches only the `nostr` namespace.
 */
export async function sendExtensionRpc<T>(
  page: Page,
  message: Record<string, unknown>
): Promise<T> {
  const response = await page.evaluate(
    (rpcMessage) =>
      new Promise<RpcResponse<T>>((resolve, reject) => {
        type RuntimeApi = {
          sendMessage?: (
            message: unknown,
            callback: (value: RpcResponse<T>) => void
          ) => void;
          lastError?: { message?: string };
        };
        const runtime = (globalThis as { chrome?: { runtime?: RuntimeApi } })
          .chrome?.runtime;

        if (!runtime?.sendMessage) {
          reject(new Error("Extension runtime API is not available"));
          return;
        }

        runtime.sendMessage(rpcMessage, (value: RpcResponse<T>) => {
          const lastError = runtime.lastError;
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
    const { data, message: msg } = response.error;
    const details = data?.details ? `: ${data.details}` : "";
    throw new Error(
      `RPC ${String(message.type)} failed: ${data?.errorCode ?? msg}${details}`
    );
  }

  return response.data;
}

/**
 * Seeds a usable vault without walking onboarding.
 *
 * The reload at the end is not optional. Seeding over RPC does not tell the
 * popup's React tree to re-read vault state: `state.getLock` reports unlocked
 * while the page still renders "Ostrilo is Locked" with a disabled Unlock
 * button. The existing specs never notice, because they assert on RPC results
 * rather than on rendered UI. A screenshot taken without this reload shows a
 * lock screen, and the obvious reading of it — onboarding is broken — is wrong.
 */
export async function seedUnlockedVault(
  page: Page,
  opts: { password?: string; label?: string } = {}
): Promise<void> {
  const password = opts.password ?? TEST_PASSWORD;
  const label = opts.label ?? "Agent Loop Key";

  await sendExtensionRpc(page, { type: "vault.generate", password, label });
  await sendExtensionRpc(page, { type: "vault.unlock", password });

  // Without this grant getPublicKey() does not fail. It queues an approval and
  // blocks for the full 60s approval timeout, which reads as flakiness rather
  // than as a missing grant.
  await sendExtensionRpc(page, {
    type: "policy.setOrigin",
    origin: DAPP_ORIGIN,
    patch: { identityDisclosure: "allow" },
    password,
  });
  await sendExtensionRpc(page, {
    type: "settings.update",
    patch: {
      onboardingCompleted: true,
      onboardingCompletedAt: Date.now(),
      // Point the relay list somewhere that cannot answer. Without this every
      // seeded spec opens a real WebSocket to wss://relay.primal.net the
      // moment a key exists, because profile lookups fire on a cache miss.
      // That makes the suite depend on a public third party being reachable,
      // and quietly tells that relay which identities a test run created.
      //
      // An empty list does NOT work: SettingsService.get() replaces an empty
      // relays array with DEFAULT_RELAY_URLS on the next read, deliberately,
      // so the user is never left with no relays. A syntactically valid but
      // dead wss:// URL survives sanitisation and fails instantly instead.
      relays: ["wss://localhost:1"],
    },
  });

  await page.reload();
  await expect(
    page.getByRole("heading", { level: 2, name: label })
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * Standing permission to sign this kind without prompting. Password-gated in
 * the background by design, so the password rides with the request.
 */
export async function grantKindAllow(
  page: Page,
  origin: string,
  kind: number,
  password: string = TEST_PASSWORD
): Promise<void> {
  await sendExtensionRpc(page, {
    type: "policy.setKindRule",
    origin,
    kind,
    mode: "allow",
    password,
  });
}

/** Opens the HTTPS fixture dApp and waits for the provider to be injected. */
export async function openDapp(context: BrowserContext): Promise<Page> {
  const dapp = await context.newPage();
  await dapp.setViewportSize({ width: 900, height: 700 });
  await dapp.goto(DAPP_URL);
  await expect(dapp.locator("#status")).toHaveText("window.nostr available");
  return dapp;
}

/** The approval window opens itself, so catch it whether or not it is already up. */
export async function waitForApprovalPage(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const prefix = `chrome-extension://${extensionId}/approval.html`;
  const existing = context.pages().find((p) => p.url().startsWith(prefix));
  const approvalPage =
    existing ??
    (await context.waitForEvent("page", {
      predicate: (p) => p.url().startsWith(prefix),
      timeout: 10_000,
    }));
  await approvalPage.setViewportSize({ width: 960, height: 640 });
  await approvalPage.waitForLoadState("domcontentloaded");
  return approvalPage;
}

/**
 * Resolves the first pending approval without a click. This carries the same
 * policy side effects as pressing the button, so it is a shortcut past the UI,
 * not past the decision.
 */
export async function resolveNextApproval(
  page: Page,
  action: string
): Promise<void> {
  await expect
    .poll(
      async () => {
        const data = await sendExtensionRpc<{
          requests: Array<{ id: string }>;
        }>(page, { type: "approval.getAll" });
        return data.requests.length;
      },
      { timeout: 10_000 }
    )
    .toBeGreaterThan(0);

  const data = await sendExtensionRpc<{ requests: Array<{ id: string }> }>(
    page,
    { type: "approval.getAll" }
  );

  await sendExtensionRpc(page, {
    type: "approval.resolve",
    requestId: data.requests[0].id,
    action,
  });
}
