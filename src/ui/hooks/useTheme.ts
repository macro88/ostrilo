import { useEffect } from "react";
import { useAppSettings } from "./useAppSettings";
import {
  resolveEffectiveTheme,
  getSystemPrefersDark,
  applyThemeToDOM,
} from "@/ui/lib/theme";

/**
 * Hook that applies the theme to the document based on settings and system preference.
 * Automatically updates when settings change or system preference changes (in system mode).
 * 
 * Should be mounted once per extension UI surface (popup, sidepanel, options, approval).
 */
export function useTheme(): void {
  const { settings, isLoading } = useAppSettings();

  useEffect(() => {
    // Don't apply theme until settings are loaded
    if (isLoading) return;

    const theme = settings.theme;
    const systemPrefersDark = getSystemPrefersDark();
    const effectiveTheme = resolveEffectiveTheme(theme, systemPrefersDark);

    // Apply the theme immediately
    applyThemeToDOM(effectiveTheme);

    // If theme is 'system', listen for system preference changes
    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

      const handleChange = (e: MediaQueryListEvent) => {
        const newEffectiveTheme = resolveEffectiveTheme(theme, e.matches);
        applyThemeToDOM(newEffectiveTheme);
      };

      mediaQuery.addEventListener("change", handleChange);

      // Cleanup listener when effect re-runs or component unmounts
      return () => {
        mediaQuery.removeEventListener("change", handleChange);
      };
    }
  }, [settings.theme, isLoading]);
}
