import { StorageSuite } from "@/src/application/ports/storage";
import type { AppSettingsV1 } from "@/src/domain/types";

const SETTINGS_KEY = "appSettings";
export const SETTINGS_CHANGED_EVENT = "ostrilo.settings.changed";

export class SettingsService {
  constructor(private storage: StorageSuite) {}

  async get(): Promise<AppSettingsV1 | undefined> {
    return this.storage.sync.get<AppSettingsV1>(SETTINGS_KEY);
  }

  async update(patch: Partial<AppSettingsV1>): Promise<AppSettingsV1> {
    const current = (await this.get()) ?? ({} as AppSettingsV1);
    const next = { ...current, ...patch } as AppSettingsV1;
    await this.storage.sync.set<AppSettingsV1>(SETTINGS_KEY, next);
    // Emit a runtime event for UI stores to pick up
    try {
      const { browser } = await import("wxt/browser");
      browser.runtime.sendMessage({ __event: SETTINGS_CHANGED_EVENT });
    } catch {}
    return next;
  }
}
