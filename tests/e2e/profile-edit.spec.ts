import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import {
  seedUnlockedVault,
  sendExtensionRpc,
  TEST_PASSWORD,
} from "./fixtures/agent";
import { ensureDevCertificate } from "./fixtures/make-dev-cert";
import { PROFILE_FIELD_BOUNDS } from "@/domain/profile/types";

/**
 * Editing and publishing a Nostr profile.
 *
 * This file was a `describe.skip` of numbered comments, deferred on the grounds
 * that publishing a kind:0 event needs a relay and mocking one is "complex
 * infrastructure". It needs a relay, so the suite brings its own: `FixtureRelay`
 * below is a NIP-01 relay speaking `wss:` in the test process, over the same
 * throwaway localhost certificate the dApp fixture uses. Every test here points
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

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const REJECT_REASON = "blocked: fixture relay refused this event";

interface SignedEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

interface RelayFilter {
  authors?: string[];
  kinds?: number[];
}

/** One client frame, or null while the buffer still holds a partial frame. */
function readFrame(
  buffer: Buffer
): { opcode: number; payload: Buffer; rest: Buffer } | null {
  if (buffer.length < 2) return null;

  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }

  let mask: Buffer | null = null;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + length) return null;

  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] ^= mask[i % 4];
    }
  }

  return { opcode, payload, rest: buffer.subarray(offset + length) };
}

/** A server-to-client text frame. Server frames are never masked. */
function sendText(socket: Duplex, text: string): void {
  const payload = Buffer.from(text, "utf8");
  let header: Buffer;

  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  socket.write(Buffer.concat([header, payload]));
}

/**
 * A NIP-01 relay, in this process, over `wss:`.
 *
 * It exists so a publish can be asserted end to end without a live relay. It
 * speaks only what the extension speaks - EVENT/OK, REQ/EVENT/EOSE - and it
 * stores the last kind:0 per author so a forced refetch gets back exactly what
 * was published. `accepts: false` answers `OK false`, which is a relay refusing
 * an event rather than a network that is down.
 *
 * `wss:` is not optional here: the manifest CSP allows `wss:` and the relay URL
 * validator refuses anything else, so a plaintext `ws://` fixture would be
 * rejected by the code under test before a byte moved.
 */
class FixtureRelay {
  /** Every event the extension published, accepted or not. */
  readonly received: SignedEvent[] = [];
  /** Every REQ filter the extension subscribed with. */
  readonly requested: RelayFilter[] = [];

  private readonly accepts: boolean;
  private readonly sockets = new Set<Duplex>();
  private readonly stored = new Map<string, SignedEvent>();
  private server: Server | null = null;
  private port = 0;

  constructor(options: { accepts: boolean }) {
    this.accepts = options.accepts;
  }

  get url(): string {
    if (!this.port) throw new Error("FixtureRelay is not listening");
    return `wss://localhost:${this.port}`;
  }

  async start(): Promise<void> {
    const { cert, key } = ensureDevCertificate();
    const server = createServer({
      cert: readFileSync(cert),
      key: readFileSync(key),
    });

    server.on("upgrade", (request, socket) => {
      this.accept(request.headers["sec-websocket-key"], socket);
    });

    // Port 0, and no host: an ephemeral port cannot collide with a concurrent
    // spec, and binding every interface keeps `localhost` working whether the
    // browser resolves it to ::1 or 127.0.0.1.
    await new Promise<void>((resolve) => server.listen(0, resolve));
    this.port = (server.address() as AddressInfo).port;
    this.server = server;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();

    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private accept(key: string | undefined, socket: Duplex): void {
    if (!key) {
      socket.destroy();
      return;
    }

    const accept = createHash("sha1")
      .update(`${key}${WS_GUID}`)
      .digest("base64");

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => {
      // The browser tears connections down abruptly; that is not a failure.
    });

    let pending: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);

      for (;;) {
        const frame = readFrame(pending);
        if (!frame) return;
        pending = frame.rest;

        if (frame.opcode === 0x8) {
          socket.end();
          return;
        }
        if (frame.opcode === 0x9) {
          socket.write(Buffer.concat([Buffer.from([0x8a, 0]), Buffer.alloc(0)]));
          continue;
        }
        if (frame.opcode === 0x1) {
          this.handle(socket, frame.payload.toString("utf8"));
        }
      }
    });
  }

  private handle(socket: Duplex, text: string): void {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!Array.isArray(message)) return;

    if (message[0] === "EVENT") {
      const event = message[1] as SignedEvent;
      this.received.push(event);
      if (this.accepts) this.stored.set(event.pubkey, event);

      sendText(
        socket,
        JSON.stringify([
          "OK",
          event.id,
          this.accepts,
          this.accepts ? "" : REJECT_REASON,
        ])
      );
      return;
    }

    if (message[0] === "REQ") {
      const subId = message[1] as string;
      const filter = (message[2] ?? {}) as RelayFilter;
      this.requested.push(filter);

      for (const author of filter.authors ?? []) {
        const event = this.stored.get(author);
        if (event && (filter.kinds ?? [event.kind]).includes(event.kind)) {
          sendText(socket, JSON.stringify(["EVENT", subId, event]));
        }
      }

      sendText(socket, JSON.stringify(["EOSE", subId]));
    }
  }
}

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
    await chromeApi.storage.sync.set({ appSettings: { relays: [url] } });
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
    await expect(popup.getByLabel("Display Name")).toHaveValue(
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
    await popup.getByLabel("Display Name").fill("Wren Halloway II");
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
    const name = popup.getByLabel("Display Name");
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
    await popup.getByLabel("Display Name").fill("Discarded Name");
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
    await expect(popup.getByLabel("Display Name")).toHaveValue(
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
    expect(summary).toContain(key.npub!.slice(0, 10));
  });

  test("a relay that refuses the event leaves the edits on screen", async ({
    openPopup,
  }) => {
    const relay = await startRelay({ accepts: false });
    const popup = await openPopup();
    const key = await arriveAtProfile(popup, relay);

    await openEditForm(popup);
    await popup.getByLabel("Display Name").fill("Unpublished Name");
    await popup.getByRole("button", { name: "Save Changes" }).click();

    // The failure is reported. The message it reports is the raw RPC code
    // `rpc:profile.update:unknown_method` - the handler maps every thrown error
    // onto UNKNOWN_METHOD, so a refused publish is announced to the user as a
    // method that does not exist, and the relay's own reason is dropped. The
    // pattern below matches that string and a message that actually names the
    // relay, so fixing the code does not fail this test.
    await expect(
      popup.getByText(/rpc:profile\.update|publish|relay/i)
    ).toBeVisible({ timeout: 20_000 });

    // Still editing, with the user's text intact: a failed publish must not
    // throw away what they typed.
    await expect(
      popup.getByRole("heading", { name: "Edit Profile" })
    ).toBeVisible();
    await expect(popup.getByLabel("Display Name")).toHaveValue(
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
