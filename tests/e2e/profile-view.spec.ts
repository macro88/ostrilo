import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import {
  seedUnlockedVault,
  sendExtensionRpc,
  TEST_PASSWORD,
} from "./fixtures/agent";

/**
 * E2E tests for the profile surface.
 *
 * These were a `describe.skip` of comments, on the grounds that a real test
 * "requires complex relay mocking infrastructure". It does not. `ProfileService`
 * is cache-first: a fetch is attempted only when `browser.storage.session`
 * holds no unexpired entry for the pubkey, so seeding that cache - the exact
 * record `cacheProfile` writes - exercises the rendering path end to end with
 * no relay in it at all.
 *
 * Every test here configures ONE relay that cannot resolve. That is the
 * measurement, not a convenience: a relay query cannot produce a name, so a
 * rendered name can only have come from the cache, and an empty state can only
 * mean the fetch path ran and found nothing. Nothing in this file depends on a
 * live relay, and nothing in it leaves the machine.
 *
 * The privacy control being guarded is the one the extension cannot delegate to
 * the browser. `manifest.json` ships `img-src 'self' data: https:`, so if a
 * future edit reintroduced `<img src={profile.picture}>` the CSP would let the
 * request through: the only thing standing between a relay-chosen host and the
 * IP address of the window holding the signing session is the component code.
 * See tests/unit/ui/features/profile/remote-media-policy.test.tsx for the unit
 * half of this rule.
 */

/**
 * A relay the browser can never connect to. `.invalid` is reserved by RFC 2606
 * and resolves nowhere, so this configures a relay without contacting one.
 */
const UNREACHABLE_RELAY = "wss://relay.ostrilo-e2e.invalid";

/** Stands in for a URL a relay chose, on a host it controls. */
const RELAY_CHOSEN_PICTURE = "https://relay-chosen-host.invalid/avatar.png";
const RELAY_CHOSEN_BANNER = "https://relay-chosen-host.invalid/banner.png";

type KeyEntry = {
  id: string;
  label?: string;
  pubkey: string;
  npub?: string;
};

type ProfileMetadata = Record<string, string>;

async function listKeys(page: Page): Promise<KeyEntry[]> {
  return await sendExtensionRpc<KeyEntry[]>(page, { type: "keys.list" });
}

/** Points the background at a relay that cannot answer. */
async function configureUnreachableRelay(page: Page): Promise<void> {
  await sendExtensionRpc(page, {
    type: "settings.update",
    patch: { relays: [UNREACHABLE_RELAY] },
  });
}

/**
 * Writes the profile cache the way `ProfileService.cacheProfile` writes it.
 *
 * There is no RPC that fills this cache without a relay: `profile.update`
 * publishes through `RelayManager.publish`, which throws when no relay accepts
 * the event, so it cannot seed a cache offline. `fetchedAt` is epoch SECONDS,
 * matching `isCacheExpired`; seconds-vs-milliseconds here would mark every
 * entry as fetched in the far future and the cache would never be consulted.
 */
async function seedProfileCache(
  page: Page,
  entries: Array<{ pubkey: string; metadata: ProfileMetadata }>
): Promise<void> {
  await page.evaluate(async (list) => {
    const chromeApi = (globalThis as any).chrome;
    const current = await chromeApi.storage.session.get("profileCache");
    const cache = current.profileCache ?? {};
    const fetchedAt = Math.floor(Date.now() / 1000);

    for (const { pubkey, metadata } of list) {
      cache[pubkey] = { pubkey, metadata, fetchedAt, ttl: 3600 };
    }

    await chromeApi.storage.session.set({ profileCache: cache });
  }, entries);
}

async function openProfileTab(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Profile Settings" })
  ).toBeVisible();
}

/** One labelled card on the profile surface, located by its own heading. */
function profileCard(page: Page, label: string) {
  return page.locator(".ink-card").filter({
    has: page.getByRole("heading", { level: 3, name: label, exact: true }),
  });
}

/**
 * How the identity strip shortens the npub.
 *
 * `ProfileSummary` renders the shared `<Pubkey>` there, so the profile surface
 * truncates exactly the way the home screen and the settings tab do.
 */
function summaryNpub(npub: string): string {
  return `${npub.slice(0, 8)}…${npub.slice(-6)}`;
}

test.describe("profile view", () => {
  // Each test launches its own persistent context, installs the extension and
  // generates a real key, which means a real Argon2id derivation - deliberately
  // slow - before a single assertion runs. The default 30s covers the browser
  // work and leaves nothing for teardown.
  test.describe.configure({ timeout: 90_000 });

  test("renders a cached profile with no relay able to answer", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup, { label: "Profile View Key" });
    await configureUnreachableRelay(popup);

    const [key] = await listKeys(popup);
    await seedProfileCache(popup, [
      {
        pubkey: key.pubkey,
        metadata: {
          name: "Nadia Quill",
          about: "Binds books. Signs notes. Runs her own relay.",
          website: "https://nadia-quill.invalid/",
          picture: RELAY_CHOSEN_PICTURE,
          nip05: "nadia@quill.invalid",
          lud16: "nadia@wallet.invalid",
        },
      },
    ]);
    await popup.reload();

    await openProfileTab(popup);

    // Each of these could only have come from the cache: the one configured
    // relay does not resolve, so the fetch path resolves null and every row
    // would be an "Add ..." control instead of a value.
    await expect(profileCard(popup, "Display Name")).toContainText(
      "Nadia Quill"
    );
    await expect(profileCard(popup, "About")).toContainText(
      "Binds books. Signs notes. Runs her own relay."
    );
    await expect(profileCard(popup, "Website")).toContainText(
      "https://nadia-quill.invalid/"
    );
    await expect(profileCard(popup, "Picture URL")).toContainText(
      RELAY_CHOSEN_PICTURE
    );
    await expect(profileCard(popup, "NIP-05")).toContainText(
      "nadia@quill.invalid"
    );
    await expect(profileCard(popup, "Lightning Address")).toContainText(
      "nadia@wallet.invalid"
    );

    // A cache hit is not a failure, so the retry affordance must stay away.
    await expect(popup.getByRole("button", { name: "Try again" })).toHaveCount(
      0
    );
    // And the controls are live rather than stuck behind a pending fetch.
    await expect(popup.getByRole("button", { name: "Edit Profile" })).toBeEnabled();
  });

  test("shows the empty state when nothing is cached", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup, { label: "Empty Profile Key" });
    await configureUnreachableRelay(popup);
    // No seeding: this is a key whose profile the extension has never seen.
    await popup.reload();

    await openProfileTab(popup);

    // The fetch runs, finds nothing, and the surface says so in its own words
    // rather than showing a spinner forever or an error the user cannot act on.
    // The deadline is RELAY_BOUNDS.FETCH_DEADLINE_MS (5s), hence the headroom.
    // An empty field is a control, not a line of prose: every row carries the
    // same verb and opens the editor on that field. Asserted by role, because
    // "the card contains the word Add" would be true of any one of them.
    for (const field of ["Display Name", "About", "Website", "Picture URL"]) {
      await expect(
        popup.getByRole("button", { name: `Add ${field}` })
      ).toBeVisible({ timeout: 15_000 });
    }
    // The privacy statement sits under the card rather than inside the row,
    // because it holds whether or not a URL is set.
    await expect(
      popup.getByText(
        "Ostrilo loads your picture once, when you save or refresh it, and keeps a small copy for the header."
      )
    ).toBeVisible();

    // NIP-05 and Lightning cards are rendered only when the profile carries
    // them, so an empty profile must not invent placeholder rows for them.
    await expect(profileCard(popup, "NIP-05")).toHaveCount(0);
    await expect(profileCard(popup, "Lightning Address")).toHaveCount(0);

    // Nothing failed. A relay with no answer is not an error to report.
    await expect(popup.getByRole("button", { name: "Try again" })).toHaveCount(
      0
    );
    // Loading has finished; the fields are values, not "Loading...".
    await expect(popup.getByText("Loading...")).toHaveCount(0);

    // The avatar is still the local seal, now with nothing to take an initial
    // from. An unknown profile must not become a reason to fetch an image.
    await expect(popup.locator("main .seal").first()).toHaveText("?");
  });

  test("identifies the active key by its own npub, never by hex", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup, { label: "Npub Display Key" });
    await configureUnreachableRelay(popup);

    const [key] = await listKeys(popup);
    expect(key.npub, "keys.list did not return a bech32 public key").toMatch(
      /^npub1[023456789acdefghjklmnpqrstuvwxyz]+$/
    );

    await openProfileTab(popup);

    await expect(
      popup.getByText(summaryNpub(key.npub!), { exact: true })
    ).toBeVisible();

    // `ProfileView` used to encode the npub itself through a helper that
    // caught every error and returned the raw hex as a "fallback", so a failed
    // encode was indistinguishable from a successful one and the page showed a
    // hex key where an npub was promised. Hex on this surface is that bug.
    const body = (await popup.textContent("body")) ?? "";
    expect(
      body,
      "the profile surface showed the raw hex public key instead of an npub"
    ).not.toContain(key.pubkey);
  });

  test("never loads relay-chosen media, but keeps the URL inspectable", async ({
    openPopup,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup, { label: "Remote Media Key" });
    await configureUnreachableRelay(popup);

    const [key] = await listKeys(popup);
    await seedProfileCache(popup, [
      {
        pubkey: key.pubkey,
        metadata: {
          name: "Nadia Quill",
          picture: RELAY_CHOSEN_PICTURE,
          banner: RELAY_CHOSEN_BANNER,
        },
      },
    ]);
    await popup.reload();

    // Recorded across the whole browser context, so this catches the request
    // wherever it is issued from. The extension CSP ships
    // `img-src 'self' data: https:`, so nothing but the component code stands
    // between a relay-chosen host and this window.
    const relayHostRequests: string[] = [];
    extensionContext.on("request", (request) => {
      if (request.url().includes("relay-chosen-host.invalid")) {
        relayHostRequests.push(request.url());
      }
    });

    await openProfileTab(popup);
    // Inspectable, not fetched: the URL is shown as data with a copy control,
    // the same treatment this codebase gives an npub.
    await expect(profileCard(popup, "Picture URL")).toContainText(
      RELAY_CHOSEN_PICTURE
    );
    await expect(
      popup.getByRole("button", { name: "Copy Picture URL" })
    ).toBeVisible();

    expect(
      relayHostRequests,
      "SECURITY REGRESSION: the profile surface fetched a relay-chosen URL, disclosing the user's IP to a host the relay picked"
    ).toEqual([]);

    // Scoped to <main>: the header carries the extension's own bundled logo,
    // which is a local asset and not the thing under test. A `url(...)`
    // background is included because it is a fetch wearing different clothes -
    // which is why the unit rule bans `backgroundImage` on these surfaces too.
    const remoteMedia = await popup.locator("main").evaluate((main) => {
      const nodes = Array.from(main.querySelectorAll("*"));
      return nodes.flatMap((node) => {
        const found: string[] = [];
        if (
          /^(img|image|video|source|iframe|object|embed)$/i.test(node.tagName)
        ) {
          found.push(`<${node.tagName.toLowerCase()}>`);
        }
        const background = getComputedStyle(node).backgroundImage;
        if (background.includes("url(")) {
          found.push(`background-image: ${background}`);
        }
        return found;
      });
    });
    expect(
      remoteMedia,
      "SECURITY REGRESSION: the profile surface rendered a media element; a relay-chosen URL in one is a request to that host"
    ).toEqual([]);

    // The identity still reads as an identity: a local seal with the initial.
    await expect(popup.locator("main .seal").first()).toHaveText("N");

    // The banner is cached but has no card of its own, so its URL must not
    // reach the DOM at all - not as text, and certainly not as a source.
    const body = (await popup.textContent("body")) ?? "";
    expect(body).not.toContain(RELAY_CHOSEN_BANNER);

    // Opening the picture is available, but only as a deliberate act, and it
    // happens in an ordinary tab rather than in the window holding the signing
    // session. The request recorder proves the point from both sides: the only
    // request this host ever receives is the one the user asked for. The
    // opened tab's own URL is not the evidence - the host does not resolve, so
    // the tab lands on chrome-error://chromewebdata.
    const [opened] = await Promise.all([
      extensionContext.waitForEvent("page"),
      popup.getByRole("button", { name: "Open picture in a new tab" }).click(),
    ]);
    await expect
      .poll(() => relayHostRequests, { timeout: 10_000 })
      .toEqual([RELAY_CHOSEN_PICTURE]);
    await opened.close();
  });

  test("switching the active key switches the profile shown", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup, { label: "First Key" });
    await configureUnreachableRelay(popup);

    // A second key in the same vault, so it opens under the same password.
    await sendExtensionRpc(popup, {
      type: "vault.generate",
      password: TEST_PASSWORD,
      label: "Second Key",
    });

    const keys = await listKeys(popup);
    expect(keys).toHaveLength(2);
    const first = keys.find((k) => k.label === "First Key")!;
    const second = keys.find((k) => k.label === "Second Key")!;

    await seedProfileCache(popup, [
      { pubkey: first.pubkey, metadata: { name: "Nadia Quill" } },
      {
        pubkey: second.pubkey,
        metadata: { name: "Bruno Marsh", about: "Second identity, second life." },
      },
    ]);
    await popup.reload();

    await openProfileTab(popup);
    await expect(profileCard(popup, "Display Name")).toContainText(
      "Nadia Quill"
    );
    await expect(
      popup.getByText(summaryNpub(first.npub!), { exact: true })
    ).toBeVisible();

    await popup.getByRole("button", { name: "Select active key" }).click();
    await popup.getByRole("menuitemradio", { name: /Bruno Marsh/ }).click();

    // Both halves matter. A surface that swapped the name but kept the npub -
    // or the reverse - would tell the user they are signing as an identity
    // they are not.
    await expect(profileCard(popup, "Display Name")).toContainText(
      "Bruno Marsh"
    );
    await expect(profileCard(popup, "About")).toContainText(
      "Second identity, second life."
    );
    await expect(
      popup.getByText(summaryNpub(second.npub!), { exact: true })
    ).toBeVisible();
    await expect(
      popup.getByText(summaryNpub(first.npub!), { exact: true })
    ).toHaveCount(0);
  });
});
