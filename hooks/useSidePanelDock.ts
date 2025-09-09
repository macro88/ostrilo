import { useCallback } from "react";
import { browser } from "wxt/browser";

/**
 * Side panel docking helper.
 * - enableDocking(): sets action click to open panel (if supported)
 * - disableDocking(): restores normal popup behavior
 * - open(): opens panel immediately (must be in user gesture)
 * - disablePanel(): best-effort hide (setOptions({ enabled:false }))
 *
 * Notes:
 * - No official close() API yet.
 * - Always call open() directly inside the user gesture (e.g. onClick).
 */
export function useSidePanelDock(panelPath?: string) {
  const sp: any =
    typeof browser !== "undefined" && (browser as any).sidePanel
      ? (browser as any).sidePanel
      : null;

  const supported =
    !!sp &&
    typeof sp.open === "function" &&
    typeof sp.setOptions === "function";

  const setBehavior = useCallback(
    async (openOnClick: boolean) => {
      if (!supported) return;
      if (typeof sp.setPanelBehavior === "function") {
        try {
          await sp.setPanelBehavior({ openPanelOnActionClick: openOnClick });
        } catch (e) {
          // Older Chrome versions may not have setPanelBehavior
          console.warn("Ostrilo: setPanelBehavior not available", e);
        }
      }
    },
    [supported, sp]
  );

  const ensurePathAndEnable = useCallback(async () => {
    if (!supported) return;
    const opts: Record<string, any> = { enabled: true };
    if (panelPath) opts.path = panelPath;
    await sp.setOptions(opts);
  }, [supported, sp, panelPath]);

  const open = useCallback(async () => {
    if (!supported) return false;
    try {
      await ensurePathAndEnable();
      const win = await browser.windows.getCurrent();
      if (win.id != null) {
        await sp.open({ windowId: win.id });
      }
      return true;
    } catch (e) {
      console.error("Ostrilo: failed to open side panel", e);
      return false;
    }
  }, [supported, ensurePathAndEnable, sp]);

  const disablePanel = useCallback(async () => {
    if (!supported) return;
    try {
      await sp.setOptions({ enabled: false });
    } catch (e) {
      console.warn("Ostrilo: failed to disable side panel", e);
    }
  }, [supported, sp]);

  const enableDocking = useCallback(
    async (immediateOpen = false) => {
      if (!supported) return;
      await setBehavior(true);
      if (immediateOpen) {
        await open(); // user gesture context recommended
        // Close popup to avoid duplicate surfaces (safe best-effort)
        window.close();
      }
    },
    [supported, setBehavior, open]
  );

  const disableDocking = useCallback(async () => {
    if (!supported) return;
    await setBehavior(false);
    await disablePanel();
  }, [supported, setBehavior, disablePanel]);

  return {
    supported,
    open,
    disablePanel,
    enableDocking,
    disableDocking,
  };
}
