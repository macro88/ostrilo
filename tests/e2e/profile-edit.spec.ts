import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import {
  seedUnlockedVault,
  sendExtensionRpc,
  TEST_PASSWORD,
} from "./fixtures/agent";
import { FixtureRelay } from "./fixtures/fixture-relay";
import { PROFILE_FIELD_BOUNDS } from "@/domain/profile/types";

/**
 * Editing and publishing a Nostr profile.
 *
 * This file was a `describe.skip` of numbered comments, deferred on the grounds
 * that publishing a kind:0 event needs a relay and mocking one is "complex
 * infrastructure". It needs a relay, so the suite brings its own: `FixtureRelay`
 * (in `fixtures/fixture-relay.ts`) is a NIP-01 relay speaking `wss:` in the
 * test process, over the same throwaway localhost certificate the dApp fixture
 * uses. Every test here points
 * the extension at it, so nothing in this file reaches the network and no test
 * depends on a stranger's relay being up or generous.
 *
 * What these tests hold onto:
 *
 *  - The edit form is seeded from the profile on display. A form that opens
 *    blank looks like a working form, and saving it wipes the user's published
 *    metadata for every field they did not retype.
 *  - The field bounds in `PROFILE_FIELD_BOUNDS` are enforced at the RPC
 *    boundary, not only by a `maxLength` attribute that any caller reaching the
 *    background directly can ignore.
 *  - Cancel discards. The draft must not survive into the next edit, and must
 *    not reach the cache or a relay.
 *  - A kind:0 event carries exactly the profile fields and nothing else, and no
 *    surface of the editor renders key material.
 *
 * The bounds are imported from the domain rather than retyped, so moving a
 * limit moves the test with it.
 */

const SEEDED_PROFILE = {
  name: "Wren Halloway",
  about: "Cartographer of disused railway lines.",
  picture: "https://cdn.example.com/wren.png",
  website: "https://wren.example.com",
  nip05: "wren@example.com",
  lud16: "wren@getalby.com",
} as const;

interface KeyEntry {
  id: string;
  pubkey: string;
  label: string;
  npub?: string;
}

const openRelays: FixtureRelay[] = [];

async function startRelay(options: {
  accepts: boolean;
}): Promise<FixtureRelay> {
  const relay = new FixtureRelay(options);
  await relay.start();
  openRelays.push(relay);
  return relay;
}

test.afterEach(async () => {
  await Promise.all(openRelays.splice(0).map((relay) => relay.stop()));
});

async function readSelectedKey(page: Page): Promise<KeyEntry> {
  const keys = await sendExtensionRpc<KeyEntry[]>(page, { type: "keys.list" });
  expect(keys.length).toBeGreaterThan(0);
  return keys[0];
}

/**
 * Points the background at the fixture relay BEFORE a vault exists.
 *
 * Written straight into storage rather than through `settings.update`, because
 * that RPC is refused while the vault is locked - and by the time it is
 * reachable, the key selector has already mounted and fired a profile fetch at
 * whatever relay was configured, which on a fresh profile is the public one the
 * extension ships with. This is the only point early enough to get in front of
 * that, and it is what keeps this spec off the network entirely.
 *
 * A partial record is deliberate: `SettingsService.get()` fills every other
 * field in from the defaults and keeps a relay list that survives sanitisation.
 * Note also what is NOT used here - an EMPTY relay list isolates nothing,
 * because that same function refuses to leave a user with no relays and puts
 * the public default back on the next read.
 */
async function preconfigureRelay(
  page: Page,
  relay: FixtureRelay
): Promise<void> {
  await page.evaluate(async (url) => {
    const chromeApi = (globalThis as any).chrome;
    await chromeApi.storage.local.set({ appSettings: { relays: [url] } });
  }, relay.url);
}

/**
 * The same list again, once the vault is open - this time through the product's
 * own settings path, so the stored record is a normal one and the background
 * has re-read it after every write the vault seeding did.
 */
async function useFixtureRelay(page: Page, relay: FixtureRelay): Promise<void> {
  await sendExtensionRpc(page, {
    type: "settings.update",
    patch: { relays: [relay.url] },
  });

  const settings = await sendExtensionRpc<{ relays: string[] }>(page, {
    type: "settings.get",
  });
  expect(settings.relays).toEqual([relay.url]);
}

/** Writes a fresh cache entry, which is what the profile surface reads first. */
async function seedProfileCache(
  page: Page,
  pubkey: string,
  metadata: Record<string, string>
): Promise<void> {
  await page.evaluate(
    async ({ pubkey: key, metadata: value }) => {
      const chromeApi = (globalThis as any).chrome;
      await chromeApi.storage.session.set({
        profileCache: {
          [key]: {
            pubkey: key,
            metadata: value,
            fetchedAt: Math.floor(Date.now() / 1000),
            ttl: 3600,
          },
        },
      });
    },
    { pubkey, metadata }
  );
}

async function readCachedProfile(
  page: Page,
  pubkey: string
): Promise<Record<string, string> | null> {
  return await page.evaluate(async (key) => {
    const chromeApi = (globalThis as any).chrome;
    const stored = await chromeApi.storage.session.get("profileCache");
    return stored?.profileCache?.[key]?.metadata ?? null;
  }, pubkey);
}

async function openProfileTab(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Profile Settings" })
  ).toBeVisible();
}

/**
 * One labelled card on the profile summary, located by its own heading.
 *
 * Scoped rather than a bare `getByText`, because the key selector in the header
 * renders the profile name too: an unscoped match for a name finds two elements
 * and fails on strict mode rather than on the thing under test.
 */
function profileCard(page: Page, label: string) {
  return page.locator(".ink-card").filter({
    has: page.getByRole("heading", { level: 3, name: label, exact: true }),
  });
}

async function openEditForm(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Edit Profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit Profile" })
  ).toBeVisible();
}

/** Seeds an unlocked vault pointed at `relay`, with `SEEDED_PROFILE` cached. */
async function arriveAtProfile(
  page: Page,
  relay: FixtureRelay
): Promise<KeyEntry> {
  // `settings.get` first, and only then the storage write. The background
  // INITIALISES its settings record inside that read, and that initialisation
  // is itself a write: doing it the other way round loses that race often
  // enough to be seen inside a single run of this file, and the relay list the
  // extension ships with is restored underneath the test. Ordering it this way
  // makes the fixture relay the last word. `settings.get` is one of the few
  // methods reachable while the vault is locked, which is what makes this
  // possible before a key exists.
  await sendExtensionRpc(page, { type: "settings.get" });
  await preconfigureRelay(page, relay);

  await seedUnlockedVault(page);
  const key = await readSelectedKey(page);
  await useFixtureRelay(page, relay);

  // Proof rather than assumption: a forced fetch has to show up at the fixture.
  // If the background were still holding the relay list it shipped with, this
  // REQ would go to a public relay and this poll would run out instead of
  // letting the rest of the test quietly measure the wrong thing.
  await expect
    .poll(
      async () => {
        await sendExtensionRpc(page, {
          type: "profile.get",
          params: { pubkey: key.pubkey, forceFetch: true },
        });
        return relay.requested.some((filter) =>
          filter.authors?.includes(key.pubkey)
        );
      },
      { timeout: 20_000 }
    )
    .toBe(true);

  await seedProfileCache(page, key.pubkey, { ...SEEDED_PROFILE });
  await openProfileTab(page);
  return key;
}

test.describe("profile edit", () => {
  test("the edit form opens pre-filled from the profile on display", async ({
    openPopup,
  }) => {
    const relay = await startRelay({ accepts: true });
    const popup = await openPopup();
    await arriveAtProfile(popup, relay);

    await expect(profileCard(popup, "Display Name")).toContainText(
      SEEDED_PROFILE.name
    );
    await expect(profileCard(popup, "About")).toContainText(
      SEEDED_PROFILE.about
    );

    await openEditForm(popup);

    // A blank form is indistinguishable from a working one until the user saves
    // it, at which point every field they did not retype is published as empty.
    await expect(popup.getByLabel("Username")).toHaveValue(
      SEEDED_PROFILE.name
    );
    await expect(popup.getByLabel("About")).toHaveValue(SEEDED_PROFILE.about);
    await expect(popup.getByLabel("Profile Picture URL")).toHaveValue(
      SEEDED_PROFILE.picture
    );
    await expect(popup.getByLabel("Website")).toHaveValue(
      SEEDED_PROFILE.website
    );
    await expect(popup.getByLabel("NIP-05 Identifier")).toHaveValue(
      SEEDED_PROFILE.nip05
    );
    await expect(popup.getByLabel("Lightning Address")).toHaveValue(
      SEEDED_PROFILE.lud16
    );
  });

  test("saving publishes a signed kind:0 event and shows what came back", async ({
    openPopup,
  }) => {
    const relay = await startRelay({ accepts: true });
    const popup = await openPopup();
    const key = await arriveAtProfile(popup, relay);
    const requestsBeforeSave = relay.requested.length;

    await openEditForm(popup);
    await popup.getByLabel("Username").fill("Wren Halloway II");
    await popup
      .getByLabel("About")
      .fill("Now mapping decommissioned canals instead.");
    await popup.getByLabel("Website").fill("https://canals.example.com");
    await popup.getByRole("button", { name: "Save Changes" }).click();

    // The editor closes only once the update resolves, and the update resolves
    // only after the forced refetch, so what is on screen here is the relay's
    // copy of the event - not the optimistic one.
    await expect(
      popup.getByRole("heading", { name: "Profile Settings" })
    ).toBeVisible({ timeout: 20_000 });
    await expect(profileCard(popup, "Display Name")).toContainText(
      "Wren Halloway II"
    );
    await expect(profileCard(popup, "About")).toContainText(
      "Now mapping decommissioned canals instead."
    );
    await expect(profileCard(popup, "Website")).toContainText(
      "https://canals.example.com"
    );

    // And getting there means the round trip survived verification: the relay
    // adapter recomputes the event ID and checks the Schnorr signature on the
    // way back in, so an unsigned or mis-signed event would have been discarded
    // and this surface would read "Not set".
    expect(relay.received).toHaveLength(1);
    const published = relay.received[0];
    expect(published.kind).toBe(0);
    expect(published.pubkey).toBe(key.pubkey);
    expect(published.id).toMatch(/^[0-9a-f]{64}$/);
    expect(published.sig).toMatch(/^[0-9a-f]{128}$/);
    // Saving re-reads from the relay rather than trusting its own optimistic
    // copy, which is the only reason the assertions above are about published
    // data and not about local state.
    expect(relay.requested.length).toBeGreaterThan(requestsBeforeSave);
    expect(
      relay.requested
        .slice(requestsBeforeSave)
        .some((filter) => filter.authors?.includes(key.pubkey))
    ).toBe(true);

    const content = JSON.parse(published.content) as Record<string, string>;
    expect(content.name).toBe("Wren Halloway II");
    expect(content.about).toBe("Now mapping decommissioned canals instead.");
    expect(content.website).toBe("https://canals.example.com");
    // Fields the user did not touch ride along rather than being dropped.
    expect(content.nip05).toBe(SEEDED_PROFILE.nip05);
    expect(content.picture).toBe(SEEDED_PROFILE.picture);
    // A kind:0 is world-readable and permanent. It carries the profile fields
    // and nothing else: no key ID, no npub, no internal state.
    expect(Object.keys(content).sort()).toEqual([
      "about",
      "lud16",
      "name",
      "nip05",
      "picture",
      "website",
    ]);

    const activity = await sendExtensionRpc<{
      entries: Array<{ origin: string; kind: number; decision: string }>;
    }>(popup, { type: "activity.getRecent", limit: 10 });
    expect(
      activity.entries.some(
        (entry) =>
          entry.kind === 0 &&
          entry.origin === "extension://profile" &&
          entry.decision === "allow"
      )
    ).toBe(true);
  });

  test("metadata bounds are enforced at the boundary, not just in the form", async ({
    openPopup,
  }) => {
    const relay = await startRelay({ accepts: true });
    const popup = await openPopup();
    await arriveAtProfile(popup, relay);
    await openEditForm(popup);

    // The form stops at the bound while typing...
    const name = popup.getByLabel("Username");
    await name.fill("");
    await name.pressSequentially("x".repeat(PROFILE_FIELD_BOUNDS.NAME + 10));
    await expect(name).toHaveValue("x".repeat(PROFILE_FIELD_BOUNDS.NAME));
    await expect(
      popup.getByText(
        `${PROFILE_FIELD_BOUNDS.NAME}/${PROFILE_FIELD_BOUNDS.NAME} characters`
      )
    ).toBeVisible();

    // ...but a `maxLength` attribute constrains a keyboard, not a caller. The
    // bound that matters is the one the background applies to whatever reaches
    // it, and it must sit exactly where the domain says it sits.
    const update = (metadata: Record<string, unknown>) =>
      sendExtensionRpc(popup, { type: "profile.update", params: { metadata } });

    await expect(
      update({ name: "x".repeat(PROFILE_FIELD_BOUNDS.NAME + 1) })
    ).rejects.toThrow(/name/);
    await expect(
      update({ about: "x".repeat(PROFILE_FIELD_BOUNDS.ABOUT + 1) })
    ).rejects.toThrow(/about/);
    await expect(
      update({ nip05: `${"u".repeat(PROFILE_FIELD_BOUNDS.NIP05)}@example.com` })
    ).rejects.toThrow(/nip05/);
    // Not a length bound, but the same gate: a profile field that is fetched by
    // a client is an outbound request the user did not make unless it is https.
    await expect(
      update({ picture: "http://insecure.example.com/a.png" })
    ).rejects.toThrow(/picture/);
    // The schema is strict, so a key nobody defined cannot be smuggled into a
    // record the UI iterates over and the cache persists.
    await expect(update({ name: "Wren", nip57: "x" })).rejects.toThrow(/nip57/);

    // Every rejection above happened before anything was signed.
    expect(relay.received).toHaveLength(0);

    // The control: exactly at the bound is accepted and published, so the
    // rejections above are the bound biting and not a broken fixture.
    await update({ name: "x".repeat(PROFILE_FIELD_BOUNDS.NAME) });
    expect(relay.received).toHaveLength(1);
    expect(JSON.parse(relay.received[0].content).name).toHaveLength(
      PROFILE_FIELD_BOUNDS.NAME
    );
  });

  test("cancel discards the draft and publishes nothing", async ({
    openPopup,
  }) => {
    const relay = await startRelay({ accepts: true });
    const popup = await openPopup();
    const key = await arriveAtProfile(popup, relay);

    await openEditForm(popup);
    await popup.getByLabel("Username").fill("Discarded Name");
    await popup.getByLabel("About").fill("Discarded bio.");
    await popup.getByRole("button", { name: "Cancel" }).click();

    await expect(
      popup.getByRole("heading", { name: "Profile Settings" })
    ).toBeVisible();
    await expect(profileCard(popup, "Display Name")).toContainText(
      SEEDED_PROFILE.name
    );
    await expect(popup.getByText("Discarded Name")).toHaveCount(0);
    await expect(popup.getByText("Discarded bio.")).toHaveCount(0);

    // Re-opening the form rebuilds it from the profile. If the abandoned draft
    // came back here, "cancel" would only mean "not yet".
    await openEditForm(popup);
    await expect(popup.getByLabel("Username")).toHaveValue(
      SEEDED_PROFILE.name
    );
    await expect(popup.getByLabel("About")).toHaveValue(SEEDED_PROFILE.about);

    expect(relay.received).toHaveLength(0);
    expect(await readCachedProfile(popup, key.pubkey)).toEqual({
      ...SEEDED_PROFILE,
    });
  });

  test("no surface of the editor renders key material", async ({
    openPopup,
  }) => {
    const relay = await startRelay({ accepts: true });
    const popup = await openPopup();
    const key = await arriveAtProfile(popup, relay);

    const revealed = await sendExtensionRpc<{ nsec: string; hex: string }>(
      popup,
      { type: "vault.reveal", password: TEST_PASSWORD }
    );
    expect(revealed.nsec).toMatch(/^nsec1[0-9a-z]+$/);
    expect(revealed.hex).toMatch(/^[0-9a-f]{64}$/);

    const surfaces: Array<{ where: string; text: string; html: string }> = [];
    const capture = async (where: string) => {
      surfaces.push({
        where,
        text: (await popup.textContent("body")) ?? "",
        html: await popup.content(),
      });
    };

    await capture("profile summary");
    await openEditForm(popup);
    await capture("edit form");

    for (const surface of surfaces) {
      expect(
        surface.text,
        `SECURITY REGRESSION: the ${surface.where} rendered the private key`
      ).not.toContain(revealed.nsec);
      expect(surface.text).not.toContain(revealed.hex);
      expect(surface.html).not.toContain(revealed.nsec);
      expect(surface.html).not.toContain(revealed.hex);
    }

    // React sets input values as properties, so they are absent from the markup
    // above and have to be read back off the elements.
    const values = await popup
      .locator("input, textarea")
      .evaluateAll((elements) =>
        elements.map(
          (element) => (element as HTMLInputElement | HTMLTextAreaElement).value
        )
      );
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).not.toContain(revealed.nsec);
      expect(value).not.toContain(revealed.hex);
    }

    // The counterweight: the PUBLIC identity is on the summary. Without this
    // the assertions above would also pass on a page that rendered nothing.
    expect(key.npub).toBeTruthy();
    const summary = surfaces[0].text;
    // The identity strip renders the shared `<Pubkey>`, which shows the first
    // eight characters of the npub before the ellipsis.
    expect(summary).toContain(key.npub!.slice(0, 8));
  });

  test("a relay that refuses the event leaves the edits on screen", async ({
    openPopup,
  }) => {
    const relay = await startRelay({ accepts: false });
    const popup = await openPopup();
    const key = await arriveAtProfile(popup, relay);

    await openEditForm(popup);
    await popup.getByLabel("Username").fill("Unpublished Name");
    await popup.getByRole("button", { name: "Save Changes" }).click();

    // The failure is reported, and it names the relay rather than a machine
    // code: a refused publish maps to network_error, which the form explains.
    // Scoped to the alert: the form's own description now reads "Published to
    // your relays for anyone to read.", which the pattern below also matches,
    // so an unscoped getByText resolves to two elements.
    await expect(
      popup
        .getByRole("alert")
        .filter({ hasText: "No relay accepted the update" })
    ).toBeVisible({ timeout: 20_000 });

    // Still editing, with the user's text intact: a failed publish must not
    // throw away what they typed.
    await expect(
      popup.getByRole("heading", { name: "Edit Profile" })
    ).toBeVisible();
    await expect(popup.getByLabel("Username")).toHaveValue(
      "Unpublished Name"
    );
    await expect(
      popup.getByRole("button", { name: "Save Changes" })
    ).toBeEnabled();

    // The attempt was real: a signed kind:0 reached the relay and the relay
    // refused it. This is the relay's answer, not a missing publish.
    expect(relay.received).toHaveLength(1);
    const attempted = relay.received[0];
    expect(attempted.kind).toBe(0);
    expect(attempted.pubkey).toBe(key.pubkey);
    expect(attempted.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(JSON.parse(attempted.content).name).toBe("Unpublished Name");
  });
});
