import type { Worker } from "@playwright/test";

/** Wait for first-install settings initialization before overriding its discovery relays. */
export async function isolateDiscoveryRelays(worker: Worker, url: string) {
  await worker.evaluate(async (relay) => {
    const { chrome } = globalThis as typeof globalThis & {
      chrome: {
        storage: {
          local: {
            get(
              key: string,
            ): Promise<{ appSettings?: Record<string, unknown> }>;
            set(data: unknown): Promise<void>;
          };
        };
      };
    };
    const storage = chrome.storage.local;
    const deadline = Date.now() + 10000;
    do {
      const { appSettings } = await storage.get("appSettings");
      if (
        appSettings?.__version === "settings.v1" &&
        appSettings.__consentMigrations
      ) {
        await storage.set({ appSettings: { ...appSettings, relays: [relay] } });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    throw new Error(
      "Discovery relay isolation requires initialized fixture settings",
    );
  }, url);
}

export const LOCAL_NETWORK_RULES =
  "MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1";
