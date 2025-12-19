import type { Theme } from "@/domain/types";

/**
 * Resolves the effective theme (light or dark) from settings and system preference
 * @param settingsTheme - Theme setting from user preferences
 * @param systemPrefersDark - Whether system prefers dark mode
 * @returns The effective theme to apply
 */
export function resolveEffectiveTheme(
  settingsTheme: Theme,
  systemPrefersDark: boolean
): "light" | "dark" {
  if (settingsTheme === "light" || settingsTheme === "dark") {
    return settingsTheme;
  }

  // settingsTheme === "system"
  return systemPrefersDark ? "dark" : "light";
}

/**
 * Gets the current system dark mode preference
 * @returns true if system prefers dark mode, false otherwise
 */
export function getSystemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Applies the effective theme to the document by toggling the 'dark' class
 * This function is idempotent - calling it multiple times with the same theme is safe
 * @param effectiveTheme - The theme to apply ('light' or 'dark')
 */
export function applyThemeToDOM(effectiveTheme: "light" | "dark"): void {
  const isDark = effectiveTheme === "dark";
  const classList = document.documentElement.classList;

  if (isDark) {
    if (!classList.contains("dark")) {
      classList.add("dark");
    }
  } else {
    classList.remove("dark");
  }
}
