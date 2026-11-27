import { test, expect } from "./fixtures/extension";
import { sendExtensionRpc, TEST_PASSWORD } from "./fixtures/agent";
import { FixtureRelay } from "./fixtures/fixture-relay";
import { preconfigureRelay } from "./fixtures/profile-editor";

test("generated keys publish once by default and edits detect a remote change", async ({
  openPopup,
  openOptions,
}) => {
  const relay = new FixtureRelay({ accepts: true });
  await relay.start();
  try {
    const page = await openPopup();
    await preconfigureRelay(page, relay);
    const generate = {
      type: "vault.generate",
      password: TEST_PASSWORD,
      label: "Public",
    };
    const key = await sendExtensionRpc<{ id: string; pubkey: string }>(
      page,
      generate,
    );
    await sendExtensionRpc(page, {
      ...generate,
      label: "Private",
      publishStarter: false,
    });
    await sendExtensionRpc(page, {
      type: "vault.import",
      password: TEST_PASSWORD,
      keyInput: "0".repeat(63) + "1",
      label: "Imported",
    });
    await sendExtensionRpc(page, {
      type: "vault.unlock",
      password: TEST_PASSWORD,
    });
    await sendExtensionRpc(page, {
      type: "settings.update",
      patch: { onboardingCompleted: true },
    });
    await expect.poll(() => relay.received.length).toBe(1);
    const starter = relay.received[0];
    expect(starter).toMatchObject({
      pubkey: key.pubkey,
      kind: 10002,
      tags: [["r", relay.url]],
    });

    const options = await openOptions();
    await options.getByRole("tab", { name: "Relays" }).click();
    const marker = options.getByRole("combobox", {
      name: `Access for ${relay.url}`,
    });
    await marker.focus();
    await marker.press("w");
    await expect(marker).toHaveValue("write");
    await options.getByRole("button", { name: "Publish relay list" }).click();
    await expect(
      options.getByText("Published to 1 of 1 relays."),
    ).toBeVisible();
    expect(relay.received[1].tags).toEqual([["r", relay.url, "write"]]);
    await marker.selectOption("both");
    await sendExtensionRpc(page, {
      type: "relayList.publish",
      params: {
        keyId: key.id,
        baseEventId: relay.received[1].id,
        entries: [{ url: relay.url, read: true, write: true }],
      },
    });
    await options.getByRole("button", { name: "Publish relay list" }).click();
    await expect(
      options.getByText(/Another app changed this list/),
    ).toBeVisible();
    expect(relay.received).toHaveLength(3);
  } finally {
    await relay.stop();
  }
});
