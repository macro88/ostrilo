import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import {
  seedUnlockedVault,
  sendExtensionRpc,
  openDapp,
  waitForApprovalPage,
  resolveNextApproval,
  DAPP_ORIGIN,
} from "./fixtures/agent";
import {
  APPROVAL_TIMEOUT_MS,
  PROVIDER_TIMEOUT_GRACE_MS,
} from "@/application/services/approval-queue.service";

/**
 * The fail-closed default: a prompt nobody answers.
 *
 * This is the only decision in the product that is made without a user. A
 * signing prompt that is never clicked must expire into a DENIAL, silently,
 * and it must leave the extension knowing exactly as much as it knew before —
 * an unanswered question teaches nothing. The opposite behaviour is the worst
 * bug this codebase could ship: a timeout that resolved as an approval would
 * sign for an origin the user deliberately walked away from, which is the
 * precise attack shape of "open a prompt and wait for the user to close the
 * laptop".
 *
 * `approval-flow.spec.ts` names the timeout in its header as one of the
 * journeys the old, assertion-free version of that file pretended to cover.
 * This file is where it is actually covered.
 *
 * Two deadlines exist and they are not interchangeable:
 *
 *   APPROVAL_TIMEOUT_MS (60s)                     - the extension-side queue
 *                                                   deadline. Authoritative.
 *   + PROVIDER_TIMEOUT_GRACE_MS (5s)              - the page-side backstop in
 *                                                   injected.ts, which exists
 *                                                   only so a page is not left
 *                                                   with a promise that never
 *                                                   settles if the extension
 *                                                   goes away mid-request.
 *
 * Both reject the page with the same word. So "the promise rejected with
 * timeout" is NOT on its own evidence that the extension denied anything — a
 * service worker that died and never ran `handleTimeout` produces a
 * byte-identical rejection five seconds later. That is why the slow test below
 * measures elapsed time in the page and requires the rejection to arrive
 * strictly before the backstop could have fired. Without that bound this file
 * would be exactly the kind of test it was written to replace.
 *
 * Numbers are imported, never retyped. These two constants used to disagree —
 * the page gave up at 30 seconds while the queue ran for 60, so a user who
 * approved at 45 produced a real signature over a real event that the page had
 * already thrown away. A test that hard-coded 60000 would not notice them
 * drifting apart again.
 */

const UNANSWERED_CONTENT = "nobody is going to answer this prompt";

type SignOutcome =
  | { ok: true; sig: string; elapsedMs: number }
  | { ok: false; error: string; elapsedMs: number };

/**
 * Fires a signing request and leaves it in flight, recording when it started
 * and whether it has settled yet. The elapsed time is measured in the PAGE,
 * from the moment before `signEvent` is called, because the question this file
 * answers is "which of the two deadlines fired" and only the page can see the
 * one it owns.
 */
async function beginSignRequest(
  dapp: Page,
  kind: number,
  content: string
): Promise<void> {
  await dapp.evaluate(
    ({ kind, content }) => {
      const w = window as unknown as {
        __startedAt: number;
        __settled: SignOutcome | null;
        __outcome: Promise<SignOutcome>;
      };
      w.__startedAt = Date.now();
      w.__settled = null;
      w.__outcome = window
        .testSignEvent({
          kind,
          content,
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
        })
        .then((value: { sig: string }) => ({
          ok: true as const,
          sig: value.sig,
          elapsedMs: Date.now() - w.__startedAt,
        }))
        .catch((error: unknown) => ({
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
          elapsedMs: Date.now() - w.__startedAt,
        }));
      void w.__outcome.then((settled) => {
        w.__settled = settled;
      });
    },
    { kind, content }
  );
}

async function readSignOutcome(dapp: Page): Promise<SignOutcome> {
  return (await dapp.evaluate(
    () => (window as unknown as { __outcome: Promise<SignOutcome> }).__outcome
  )) as SignOutcome;
}

/** Has the page's promise settled yet? Never blocks. */
async function hasSettled(dapp: Page): Promise<boolean> {
  return await dapp.evaluate(
    () =>
      (window as unknown as { __settled: SignOutcome | null }).__settled !== null
  );
}

/** Milliseconds since `beginSignRequest`, on the page's own clock. */
async function elapsedInPage(dapp: Page): Promise<number> {
  return await dapp.evaluate(
    () => Date.now() - (window as unknown as { __startedAt: number }).__startedAt
  );
}

/**
 * Waits on the page's clock rather than the runner's. The property under test
 * is a wall-clock deadline, so there is no event to await instead; polling the
 * same clock the deadline is measured against is the honest way to express it.
 */
async function waitUntilElapsed(dapp: Page, ms: number): Promise<void> {
  await expect
    .poll(() => elapsedInPage(dapp), {
      timeout: ms + 30_000,
      intervals: [1_000],
    })
    .toBeGreaterThanOrEqual(ms);
}

async function originPolicy(page: Page) {
  const settings = await sendExtensionRpc<{
    origins?: Array<{
      origin: string;
      trustLevel?: string;
      rules?: Record<string, string>;
      sessionGrantAll?: boolean;
      identityDisclosure?: string;
    }>;
  }>(page, { type: "settings.get" });
  return settings.origins?.find((o) => o.origin === DAPP_ORIGIN);
}

async function pendingRequests(page: Page) {
  const data = await sendExtensionRpc<{
    requests: Array<{
      id: string;
      origin: string;
      createdAt: number;
      timeoutAt: number;
    }>;
  }>(page, { type: "approval.getAll" });
  return data.requests;
}

async function activityEntries(page: Page) {
  const data = await sendExtensionRpc<{
    entries: Array<{
      origin: string;
      kind?: number;
      operation?: string;
      decision: "allow" | "deny";
      reason?: string;
      contentPreview?: string;
      keyId?: string;
    }>;
    total: number;
  }>(page, { type: "activity.getRecent", limit: 50 });
  return data.entries;
}

test.describe("approval deadline", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  /**
   * Everything here is fast, and it pins the two halves of the slow test that
   * would otherwise be unfalsifiable on their own: the deadline the queue
   * actually attaches to a request, and the word a DELIBERATE refusal puts on
   * the wire. The slow test asserts the page is told "timeout"; that assertion
   * is only worth something because this one shows a user denial says
   * "denied" instead.
   */
  test("a queued request carries the 60-second deadline, and a user denial is not a timeout", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    const dapp = await openDapp(extensionContext);

    // No digits in the content: the countdown is read out of the queue row's
    // text below, and a "12:30" in a preview would be indistinguishable.
    await beginSignRequest(dapp, 7, "deadline check");
    const approvalPage = await waitForApprovalPage(extensionContext, extensionId);

    const queued = await pendingRequests(popup);
    expect(queued).toHaveLength(1);

    // The deadline the background actually installed, not the one the module
    // declares. `background.ts` constructs `new ApprovalQueueService()` with no
    // argument, so the shipped deadline is the exported default — and this is
    // the assertion that notices if someone passes a different one.
    expect(queued[0].timeoutAt - queued[0].createdAt).toBe(
      APPROVAL_TIMEOUT_MS / 1000
    );

    // And the user can see it running down. The countdown is the only warning
    // a user gets that walking away is itself an answer, so it has to be on
    // screen, not merely in the queue entry.
    const item = approvalPage.getByTestId("approval-request-item").first();
    await expect(item).toBeVisible();
    const countdown = (await item.innerText()).match(/(\d+):(\d{2})/);
    expect(countdown, "queue row shows no m:ss countdown").not.toBeNull();
    const secondsShown =
      Number(countdown![1]) * 60 + Number(countdown![2]);
    // Generous at the bottom for a slow machine between enqueue and paint, but
    // nowhere near wide enough to survive the deadline being halved.
    expect(secondsShown).toBeGreaterThanOrEqual(45);
    expect(secondsShown).toBeLessThanOrEqual(APPROVAL_TIMEOUT_MS / 1000);

    // Now answer it, so the contrast the slow test depends on is recorded
    // here: a refusal the user actually made says "denied".
    await resolveNextApproval(popup, "deny");
    const outcome = await readSignOutcome(dapp);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBe("denied");
      expect(outcome.error).not.toBe("timeout");
    }
  });
});

/**
 * ONE test, and it costs a full minute of wall clock.
 *
 * The deadline is sixty seconds and there is no seam to shorten it: the queue
 * is constructed inside `defineBackground` with no injected clock, and the
 * timeout is a real `setTimeout` in the service worker. Faking time from the
 * test side would mean testing a different extension than the one that ships.
 * So this test waits, and it is quarantined in its own describe with its own
 * `test.setTimeout` so a reader who wonders why this file takes a minute finds
 * the answer next to the cost.
 *
 * Every property that can be checked in the same sixty seconds is checked in
 * this one test rather than paid for again: mid-flight non-resolution, the
 * rejection and which deadline produced it, the emptied queue, the activity
 * record, the untouched policy, the approval window's state, and that the next
 * request still prompts.
 *
 * What this test is known to catch, verified by mutating the product and
 * watching it fail:
 *
 *   `handleTimeout` resolving `("allow", "allow_once")` instead of
 *   `("deny", "deny")` — the timeout-approves-instead-of-denies bug, the worst
 *   one available here. Fails on `expect(outcome.ok).toBe(false)`: the dApp
 *   came back with a real signature for a prompt nobody answered.
 *
 *   The queue deadline never firing in time (default `timeoutMs` multiplied by
 *   ten), so the page's own backstop does the rejecting instead. The promise
 *   still rejects with "timeout", the queue still empties, and the activity log
 *   still shows a denial — every assertion here passes EXCEPT the elapsed-time
 *   bound, which fails with "Expected: < 65000, Received: 65003". That is the
 *   assertion earning its keep.
 *
 * What it will NOT catch, stated plainly: the "no standing rule" assertions
 * cannot be tripped by any change to the queue, because the queue has no route
 * to the policy service — rules are written in `approval.resolve`, which a
 * timeout never reaches. Those assertions are the requirement written down
 * where a future regression would land: a "remember my last answer" feature, or
 * any expiry path routed through `approval.resolve` with a remembering action.
 */
test.describe("an unanswered approval", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("is auto-denied at the deadline and teaches the extension nothing", async ({
    openPopup,
    extensionContext,
    extensionId,
  }) => {
    test.setTimeout(APPROVAL_TIMEOUT_MS + 60_000);

    const popup = await openPopup();
    await seedUnlockedVault(popup);
    const dapp = await openDapp(extensionContext);

    // Seeding writes no activity, but clearing makes the later assertion
    // "exactly one entry, and it is a denial" exact rather than approximate.
    await sendExtensionRpc(popup, { type: "activity.clear" });
    expect(await activityEntries(popup)).toHaveLength(0);

    await beginSignRequest(dapp, 7, UNANSWERED_CONTENT);

    const approvalPage = await waitForApprovalPage(extensionContext, extensionId);
    await expect(
      approvalPage.getByTestId("approval-request-item")
    ).toHaveCount(1);

    // Nothing is clicked from here on. That is the entire point of the test.

    // Halfway: the request must still be waiting. A deadline that fired early
    // would be a different bug — the user reaches for the mouse and the prompt
    // has already answered for them — and it would otherwise pass every
    // assertion below.
    await waitUntilElapsed(dapp, APPROVAL_TIMEOUT_MS / 2);
    expect(await hasSettled(dapp)).toBe(false);
    expect(await pendingRequests(popup)).toHaveLength(1);

    // Blocks until the extension gives up. ~30 further seconds.
    const outcome = await readSignOutcome(dapp);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      // The exact error code the content script forwards to the page. A user
      // denial says "denied" (pinned by the fast test above) and a locked
      // vault says "locked", so this single equality separates the timeout
      // from every other way this promise can reject — including the two that
      // a laxer `toMatch(/denied|timeout/)` would have let through.
      expect(outcome.error).toBe("timeout");

      // WHICH timeout. `injected.ts` runs its own backstop at
      // APPROVAL_TIMEOUT_MS + PROVIDER_TIMEOUT_GRACE_MS and rejects with the
      // same word, so a service worker that was evicted and never ran
      // `handleTimeout` still produces `error === "timeout"` — five seconds
      // later, with the request left sitting in a queue nobody emptied. The
      // upper bound is what makes this an assertion about the EXTENSION
      // denying, which is the fail-closed behaviour under test.
      expect(outcome.elapsedMs).toBeLessThan(
        APPROVAL_TIMEOUT_MS + PROVIDER_TIMEOUT_GRACE_MS
      );
      // And it really did wait the full deadline rather than failing fast for
      // some unrelated reason that happens to be spelled "timeout".
      expect(outcome.elapsedMs).toBeGreaterThan(APPROVAL_TIMEOUT_MS * 0.9);
    }

    // The queue drains itself. A timed-out entry that stayed pending would
    // hold one of the five per-origin slots forever and eventually lock a
    // well-behaved site out of prompting at all.
    await expect
      .poll(async () => (await pendingRequests(popup)).length, {
        timeout: 10_000,
      })
      .toBe(0);

    // The audit trail records what happened to the user's key, and "nothing
    // was signed" is exactly what has to be recorded. If the timeout ever
    // resolved as an approval this entry would read allow and carry a keyId.
    const entries = await activityEntries(popup);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      origin: DAPP_ORIGIN,
      kind: 7,
      decision: "deny",
      contentPreview: UNANSWERED_CONTENT,
    });
    expect(entries[0].keyId).toBeUndefined();
    // A timed-out signature says so, so it can be told apart from a refusal.
    expect(entries[0].reason).toBe("timeout");

    // Nothing was learned. An unanswered question is not consent, and it is
    // not a refusal either: no per-kind rule, no session grant, and the
    // disclosure decision left exactly as the seed set it.
    const policy = await originPolicy(popup);
    expect(Object.keys(policy?.rules ?? {})).toHaveLength(0);
    expect(policy?.sessionGrantAll).toBeFalsy();
    expect(policy?.identityDisclosure).toBe("allow");

    // The window does not lie about what is waiting. The background only
    // closes it from `approval.resolve`, so after a timeout it stays open and
    // must show an empty queue rather than a stale, clickable request.
    if (!approvalPage.isClosed()) {
      await expect(
        approvalPage.getByRole("heading", { name: "No Pending Requests" })
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        approvalPage.getByTestId("approval-request-item")
      ).toHaveCount(0);
    }

    // Proven by behaviour, not only by stored state: the same site asking for
    // the same kind again is asked about again.
    await beginSignRequest(dapp, 7, "asks again after a timeout");
    await expect
      .poll(async () => (await pendingRequests(popup)).length, {
        timeout: 10_000,
      })
      .toBe(1);
  });
});

/*
 * NOT COVERED HERE, deliberately:
 *
 * - The page-side backstop firing on its own (extension gone mid-request).
 *   Reaching it requires killing the service worker between enqueue and
 *   deadline; Playwright can evict a worker, but Chrome revives it on the next
 *   runtime message, and the resurrected worker has an empty queue — so the
 *   test would be measuring worker lifecycle, not the provider. The bound
 *   asserted above (the rejection arrives before that backstop could fire) is
 *   the part that protects the user, and it is covered.
 *
 * - Timeout of an identity-disclosure prompt. Same deadline, same
 *   `handleTimeout`, and it records `reason: "timeout"` the same way.
 *   A second sixty-second test for the same queue timer would double this
 *   file's runtime to re-exercise one branch of a handler.
 */
