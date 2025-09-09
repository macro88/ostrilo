import { storage } from "wxt/storage";
import { browser } from "wxt/browser";

export default defineBackground(() => {
  async function apply() {
    const docked = await storage.getItem<boolean>("sync:isDocked", false);
    const sp: any = (browser as any).sidePanel;
    if (!sp || typeof sp.setPanelBehavior !== "function") return;
    try {
      await sp.setPanelBehavior({ openPanelOnActionClick: docked });
      if (!docked) {
        // Best-effort hide
        if (typeof sp.setOptions === "function") {
          await sp.setOptions({ enabled: false });
        }
      }
    } catch (e) {
      console.warn("Ostrilo: behavior apply failed", e);
    }
  }
  apply();
  storage.watch("sync:isDocked", apply);
});
