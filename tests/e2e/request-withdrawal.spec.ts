import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import type { BrowserContext } from "@playwright/test";
import {
  seedUnlockedVault,
  sendExtensionRpc,
  openDapp,
  waitForApprovalPage,
  DAPP_ORIGIN,
} from "./fixtures/agent";

/**
 * Request withdrawal: `nostr.cancelRequest`.
 *
 * This is the ONLY path from a web page into the approval queue's resolution
 * machinery. Everything else a page can reach (`getPublicKey`, `signEvent`)
 * only ever ADDS to the queue; this one takes something out of it. That makes
 * it the one page-driven call whose failure mode is a signature, so it is the
 * one that most needs an end-to-end test.
 *
 * Until this file existed, its safety property was asserted by prose.
 * `approval-queue.service.ts:180` says "It can only ever DENY. There is
 * deliberately no approving counterpart - a page-reachable path that resolves
 * an approval as allowed would be a way to sign without asking anyone", and
 * `content.ts:85` says "the worst a hostile page achieves by forging one is
 * cancelling its own prompt". Both claims were true and neither was tested
 * through the real content script, the real origin stamping, or the real
 * approval window. The unit test at
 * `tests/security/provider-request-boundary.test.ts:261` drives the handler
 * directly with an origin it supplies itself, which is precisely the value an
 * attacker would want to control — so it cannot show that the origin a page
 * gets is the one the content script computed.
 *
 * Why the page-side deadline is never waited out here: the injected provider
 * posts its own OSTRILO_NOSTR_CANCEL at APPROVAL_TIMEOUT_MS +
 * PROVIDER_TIMEOUT_GRACE_MS, which is 65 seconds. These tests post the same
 * message the provider posts, with the id taken from the in-flight request, so
 * they exercise the identical bridge without the wall clock.
 *
 * Two properties are asserted throughout, and they are not the same property:
 *   1. A withdrawal removes the prompt.        (liveness — the user is not
 *      left staring at a dialog nobody is waiting for)
 *   2. A withdrawal resolves as a DENIAL.      (safety — no cancel, however
 *      shaped or addressed, can yield a signature)
 * Property 1 alone is satisfied by a cancel that APPROVES: the queue empties
 * either way. So every test below checks what the page received and what the
 * activity log recorded, not just the queue depth.
 */

/** A genuinely different origin: same server, same throwaway cert SAN. */
const ALT_DAPP_ORIGIN = "https://127.0.0.1:8765";
const ALT_DAPP_URL = `${ALT_DAPP_ORIGIN}/test-page.html`;

type SignOutcome = { ok: true; sig: string } | { ok: false; error: string };

type QueuedRequest = {
  id: string;
  origin: string;
  operation: string;
  clientRequestId?: string;
  event?: { kind: number; content: string };
};

type ActivityEntry = {
  origin: string;
  kind?: number;
  operation?: string;
  decision: "allow" | "deny";
  reason?: string;
  contentPreview?: string;
  keyId?: string;
};

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
        .then((value: { sig: string }) => ({ ok: true, sig: value.sig }))
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

/**
 * Whether the page's promise has settled yet, without blocking on it.
 *
 * "Still pending" is a real assertion for a victim origin: it says the prompt
 * was not resolved behind the page's back, which `approval.getAll` alone
 * cannot distinguish from a request that was resolved and re-queued.
 */
async function signOutcomeIfSettled(
  dapp: Page
): Promise<SignOutcome | "pending"> {
  return (await dapp.evaluate(async (graceMs) => {
    const w = window as unknown as { __outcome?: Promise<SignOutcome> };
    if (!w.__outcome) return "pending";
    return await Promise.race([
      w.__outcome,
      new Promise<"pending">((resolve) =>
        setTimeout(() => resolve("pending"), graceMs)
      ),
    ]);
  }, 1000)) as SignOutcome | "pending";
}

/**
 * The message the injected provider posts when its own deadline fires.
 *
 * `extra` exists so a test can decorate the message the way a hostile page
 * would — the point being that the content script builds the RPC from its own
 * `window.location.origin` and the id, and carries nothing else across.
 */
async function postCancel(
  dapp: Page,
  clientRequestId: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await dapp.evaluate(
    ({ id, extra }) => {
      window.postMessage(
        { type: "OSTRILO_NOSTR_CANCEL", id, ...extra },
        window.location.origin
      );
    },
    { id: clientRequestId, extra }
  );
}

async function queuedRequests(page: Page): Promise<QueuedRequest[]> {
  const data = await sendExtensionRpc<{ requests: QueuedRequest[] }>(page, {
    type: "approval.getAll",
  });
  return data.requests;
}

async function waitForQueueDepth(
  page: Page,
  depth: number
): Promise<QueuedRequest[]> {
  await expect
    .poll(async () => (await queuedRequests(page)).length, { timeout: 15_000 })
    .toBe(depth);
  return queuedRequests(page);
}

/** Activity rows for signing decisions; disclosure rows are a different story. */
async function signingActivity(page: Page): Promise<ActivityEntry[]> {
  const data = await sendExtensionRpc<{ entries: ActivityEntry[] }>(page, {
    type: "activity.getRecent",
    limit: 50,
  });
  return data.entries.filter((e) => e.operation !== "identity_disclosure");
}

async function openDappAt(context: BrowserContext, url: string): Promise<Page> {
  const dapp = await context.newPage();
  await dapp.setViewportSize({ width: 900, height: 700 });
  await dapp.goto(url);
  await expect(dapp.locator("#status")).toHaveText("window.nostr available");
  return dapp;
}

test.describe("request withdrawal", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  /**
   * The whole journey, end to end: a prompt the user is looking at, a page that
   * gives up, and the three things that must follow.
   *
   * The queue emptying is the WEAKEST of the three assertions here and would
   * pass just as happily if the withdrawal resolved as an approval — that is
   * the regression this file exists to catch, so the outcome the page received
   * and the row the activity log wrote are checked too. A cancel that approved
   * would hand back a 128-hex signature and write `decision: "allow"` with a
   * `keyId`; a denial writes neither.
   */
  test("a withdrawn request leaves the queue, rejects the page, and is logged as a denial", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    const dapp = await openDapp(extensionContext);

    await beginSignRequest(dapp, 7, "withdrawn before the user answered");

    // Drive the real approval window and open the detail pane, so the state
    // being withdrawn from is the one a user actually sees: a request selected,
    // with an enabled Approve button under the cursor.
    const approvalPage = await waitForApprovalPage(extensionContext, extensionId);
    await approvalPage.getByTestId("approval-request-item").first().click();
    await expect(approvalPage.getByTestId("approval-detail")).toBeVisible();
    await expect(
      approvalPage.getByRole("button", { name: "Approve & sign" })
    ).toBeEnabled();

    const [queued] = await waitForQueueDepth(popup, 1);
    expect(queued.origin).toBe(DAPP_ORIGIN);
    expect(queued.event?.content).toBe("withdrawn before the user answered");
    // The page's own correlation id, round-tripped through the content script
    // and the queue. Without it there is nothing to withdraw by.
    expect(queued.clientRequestId).toBeTruthy();

    await postCancel(dapp, queued.clientRequestId!);

    // 1. The prompt is gone from the queue...
    await waitForQueueDepth(popup, 0);

    // ...and gone from the window the user was looking at. This is the failure
    // the withdrawal path was built for: an approval button still sitting there
    // for a request nobody is waiting for, whose signature would go nowhere.
    await expect(
      approvalPage.getByRole("heading", { name: "No Pending Requests" })
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      approvalPage.getByRole("button", { name: "Approve & sign" })
    ).toHaveCount(0);

    // 2. The page's promise rejects, and specifically as a refusal. `denied` is
    // the errorCode the content script relays for RPC_ERROR_CODES.DENIED.
    // Asserting only "it rejected" would also accept a locked vault or a
    // timeout, which are different events with different meanings.
    const outcome = await readSignOutcome(dapp);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBe("denied");
    } else {
      // Unreachable unless the withdrawal signed something. Named explicitly so
      // the failure output shows the signature rather than a bare `false`.
      expect(outcome.sig, "a withdrawal must never produce a signature").toBe(
        undefined
      );
    }

    // 3. The audit trail says refused. A user reading their own history must
    // never find a withdrawal recorded as something they allowed.
    await expect
      .poll(async () => (await signingActivity(popup)).length, {
        timeout: 10_000,
      })
      .toBe(1);
    const [logged] = await signingActivity(popup);
    expect(logged.decision).toBe("deny");
    // Nobody pressed deny: the page gave up, which the log says as unanswered.
    expect(logged.reason).toBe("timeout");
    expect(logged.kind).toBe(7);
    expect(logged.origin).toBe(DAPP_ORIGIN);
    // keyId is written only on the signing path, so its absence is independent
    // evidence that no key was used.
    expect(logged.keyId).toBeUndefined();
  });

  /**
   * The cross-origin claim, which is the reason a forged cancel is considered
   * harmless: "the origin is supplied by the content script, not the page, so
   * one site cannot cancel another's prompt."
   *
   * A page cannot lie about its origin here even if it tries — the content
   * script reads `window.location.origin` in its own isolated world and never
   * looks at the message for it. What a hostile page CAN do is learn or guess
   * another page's clientRequestId (a UUID, so not in practice, but the queue
   * must not depend on that) and post a cancel carrying it. That is what this
   * test does, in both directions.
   *
   * The ordering argument matters, because "nothing happened" is easy to assert
   * vacuously: after the two forged cancels, localhost withdraws its OWN
   * request and the queue is polled down to exactly one entry. The legitimate
   * withdrawal landing proves the bridge is live and that the forged messages
   * ahead of it were delivered and processed — so the surviving entry being
   * 127.0.0.1's is a real refusal, not a message that never arrived.
   */
  test("one origin cannot withdraw another origin's prompt", async ({
    openPopup,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const localhostDapp = await openDapp(extensionContext);
    const loopbackDapp = await openDappAt(extensionContext, ALT_DAPP_URL);

    await beginSignRequest(localhostDapp, 7, "localhost request");
    await beginSignRequest(loopbackDapp, 7, "loopback request");

    const queued = await waitForQueueDepth(popup, 2);
    const localhostRequest = queued.find((r) => r.origin === DAPP_ORIGIN)!;
    const loopbackRequest = queued.find((r) => r.origin === ALT_DAPP_ORIGIN)!;
    expect(localhostRequest, "localhost request must be queued").toBeTruthy();
    expect(loopbackRequest, "127.0.0.1 request must be queued").toBeTruthy();
    // Two origins, two independent prompts: if these collapsed into one entry
    // the rest of this test would be testing nothing.
    expect(localhostRequest.id).not.toBe(loopbackRequest.id);

    // Each page posts a withdrawal carrying the OTHER page's correlation id.
    await postCancel(localhostDapp, loopbackRequest.clientRequestId!);
    await postCancel(loopbackDapp, localhostRequest.clientRequestId!);

    // Now a withdrawal that IS legitimate, from the same page as the first
    // forgery, so its arrival dates the forgery's arrival.
    await postCancel(localhostDapp, localhostRequest.clientRequestId!);

    const remaining = await waitForQueueDepth(popup, 1);
    expect(remaining[0].id).toBe(loopbackRequest.id);
    expect(remaining[0].origin).toBe(ALT_DAPP_ORIGIN);
    expect(remaining[0].event?.content).toBe("loopback request");

    // The victim is still waiting for an answer nobody has given: its prompt
    // was neither cancelled nor — the mutation this file guards against —
    // silently approved.
    expect(await signOutcomeIfSettled(loopbackDapp)).toBe("pending");

    // And the legitimate withdrawal was a denial, not a signature. If cancel
    // ever resolved as an approval, this is where it would show as ok: true.
    const withdrawn = await readSignOutcome(localhostDapp);
    expect(withdrawn.ok).toBe(false);
    if (!withdrawn.ok) expect(withdrawn.error).toBe("denied");

    // Nothing in this test was ever allowed, by any route.
    expect(
      (await signingActivity(popup)).filter((e) => e.decision === "allow")
    ).toEqual([]);
  });

  /**
   * The safety property stated as an absolute: no shape of cancel, and no
   * message a page can address to the extension, turns into an approval.
   *
   * Three attempts, in increasing order of cheek:
   *   a. a cancel decorated with the fields an attacker would hope are honoured
   *      (`action: "allow"`, `decision: "allow"`, `approve: true`). The content
   *      script copies across the id and nothing else, so these are inert —
   *      but "inert" is a property of that code, not a law of nature.
   *   b. a cancel for an id that is not queued: no entry may be disturbed.
   *   c. the page addressing the background directly with `approval.resolve`,
   *      holding the REAL internal request id. A page should never learn that
   *      id; it is handed one here anyway, because the cancel bridge is only
   *      safe while the page cannot reach the privileged namespace at all. The
   *      manifest declares no `externally_connectable`, which is what makes
   *      this fail — a future addition of that key would silently hand pages
   *      the whole RPC surface, and this assertion is where that would surface.
   */
  test("no cancel path produces an approval or a signature", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    const dapp = await openDapp(extensionContext);

    await beginSignRequest(dapp, 7, "cancel dressed up as an approval");
    const [queued] = await waitForQueueDepth(popup, 1);

    // (c) first, while there is still something to resolve.
    const directAttempt = await dapp.evaluate(
      async ({ extensionId, requestId }) => {
        type Runtime = {
          sendMessage?: (
            id: string,
            message: unknown,
            callback: (value: unknown) => void
          ) => void;
          lastError?: { message?: string };
        };
        const runtime = (globalThis as { chrome?: { runtime?: Runtime } })
          .chrome?.runtime;
        if (!runtime?.sendMessage) return "no runtime bridge on the page";
        try {
          return await new Promise<string>((resolve) => {
            runtime.sendMessage!(
              extensionId,
              {
                type: "approval.resolve",
                requestId,
                action: "allow_once",
              },
              (value: unknown) =>
                resolve(
                  runtime.lastError
                    ? `lastError: ${runtime.lastError.message}`
                    : `response: ${JSON.stringify(value)}`
                )
            );
          });
        } catch (error) {
          return `threw: ${String(error)}`;
        }
      },
      { extensionId, requestId: queued.id }
    );
    // Observed value on this Chromium: "no runtime bridge on the page". The
    // manifest declares no `externally_connectable`, so `chrome.runtime` is not
    // injected into web pages and there is nothing for the page to send to.
    // That makes THIS assertion a tripwire rather than a live check today: it
    // starts doing real work the moment someone adds that manifest key, which
    // is exactly when someone needs to be told. The queue assertion below is
    // the live one, and it holds either way.
    expect(
      directAttempt,
      "a page must not receive a successful approval.resolve response"
    ).not.toContain('"ok":true');
    expect((await queuedRequests(popup)).map((r) => r.id)).toEqual([queued.id]);
    expect(await signOutcomeIfSettled(dapp)).toBe("pending");

    // (b) a withdrawal for an id that was never queued disturbs nothing.
    await postCancel(dapp, "00000000-0000-4000-8000-000000000000");
    expect(await signOutcomeIfSettled(dapp)).toBe("pending");
    expect((await queuedRequests(popup)).map((r) => r.id)).toEqual([queued.id]);

    // (a) the real id, with approval fields bolted on.
    await postCancel(dapp, queued.clientRequestId!, {
      action: "allow",
      decision: "allow",
      approve: true,
    });

    await waitForQueueDepth(popup, 0);
    const outcome = await readSignOutcome(dapp);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBe("denied");

    // Posting the same withdrawal again must not resurrect or re-resolve it.
    await postCancel(dapp, queued.clientRequestId!, { action: "allow" });
    expect(await queuedRequests(popup)).toEqual([]);

    const activity = await signingActivity(popup);
    expect(activity.filter((e) => e.decision === "allow")).toEqual([]);
    expect(activity.every((e) => e.keyId === undefined)).toBe(true);
  });

  /**
   * NOT COVERED HERE, deliberately:
   *
   * - The provider's OWN deadline firing. `injected.ts` posts this same message
   *   after APPROVAL_TIMEOUT_MS + PROVIDER_TIMEOUT_GRACE_MS (65s), and both
   *   constants are imported from the queue service rather than duplicated, so
   *   the alignment they encode is a compile-time fact rather than a runtime
   *   one. Waiting 65 seconds in an E2E run to watch a `setTimeout` fire would
   *   add a minute per test to re-assert the bridge these tests already drive.
   *   The timeout ordering itself is pinned by unit tests over the exported
   *   constants.
   * - A cancel arriving after the extension-side 60s timeout has already
   *   auto-denied. Same reason: the queue entry is gone, `cancelByClientRequestId`
   *   returns false, and reaching that state costs a real minute of wall clock.
   */
});
