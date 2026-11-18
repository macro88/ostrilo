import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { seedUnlockedVault, sendExtensionRpc } from "./agent";
import type { FixtureRelay } from "./fixture-relay";

/**
 * Getting to the profile editor of a freshly seeded, unlocked vault whose relay
 * list points at a fixture relay, so nothing here reaches the network.
 */

export interface KeyEntry {
  id: string;
  pubkey: string;
  label: string;
  npub?: string;
}

export async function readSelectedKey(page: Page): Promise<KeyEntry> {
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
export async function preconfigureRelay(
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
export async function useFixtureRelay(page: Page, relay: FixtureRelay): Promise<void> {
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
export async function seedProfileCache(
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

export async function openProfileTab(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Profile Settings" })
  ).toBeVisible();
}

export async function openEditForm(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Edit Profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit Profile" })
  ).toBeVisible();
}

/** Seeds an unlocked vault pointed at `relay`, with `profile` cached. */
export async function arriveAtProfile(
  page: Page,
  relay: FixtureRelay,
  profile: Record<string, string>
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

  await seedProfileCache(page, key.pubkey, { ...profile });
  await openProfileTab(page);
  return key;
}

