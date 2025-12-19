/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveEffectiveTheme,
  getSystemPrefersDark,
  applyThemeToDOM,
} from "@/ui/lib/theme";

describe("Theme Utilities", () => {
  describe("resolveEffectiveTheme", () => {
    it("should return 'light' when theme is explicitly set to 'light'", () => {
      expect(resolveEffectiveTheme("light", false)).toBe("light");
      expect(resolveEffectiveTheme("light", true)).toBe("light");
    });

    it("should return 'dark' when theme is explicitly set to 'dark'", () => {
      expect(resolveEffectiveTheme("dark", false)).toBe("dark");
      expect(resolveEffectiveTheme("dark", true)).toBe("dark");
    });

    it("should return 'dark' when theme is 'system' and system prefers dark", () => {
      expect(resolveEffectiveTheme("system", true)).toBe("dark");
    });

    it("should return 'light' when theme is 'system' and system prefers light", () => {
      expect(resolveEffectiveTheme("system", false)).toBe("light");
    });
  });

  describe("getSystemPrefersDark", () => {
    let matchMediaSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      matchMediaSpy = vi.fn();
      window.matchMedia = matchMediaSpy as any;
    });

    it("should return true when system prefers dark mode", () => {
      matchMediaSpy.mockReturnValue({ matches: true });
      expect(getSystemPrefersDark()).toBe(true);
      expect(matchMediaSpy).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
    });

    it("should return false when system prefers light mode", () => {
      matchMediaSpy.mockReturnValue({ matches: false });
      expect(getSystemPrefersDark()).toBe(false);
      expect(matchMediaSpy).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
    });
  });

  describe("applyThemeToDOM", () => {
    beforeEach(() => {
      // Clean up any existing classes
      document.documentElement.classList.remove("dark");
    });

    afterEach(() => {
      // Clean up after each test
      document.documentElement.classList.remove("dark");
    });

    it("should add 'dark' class when effective theme is 'dark'", () => {
      applyThemeToDOM("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    it("should remove 'dark' class when effective theme is 'light'", () => {
      // First add the dark class
      document.documentElement.classList.add("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);

      // Then apply light theme
      applyThemeToDOM("light");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    it("should be idempotent - calling multiple times with same theme is safe", () => {
      // Apply dark theme multiple times
      applyThemeToDOM("dark");
      applyThemeToDOM("dark");
      applyThemeToDOM("dark");

      // Should only have one 'dark' class
      const darkClasses = Array.from(document.documentElement.classList).filter(
        (c) => c === "dark"
      );
      expect(darkClasses.length).toBe(1);
      expect(document.documentElement.classList.contains("dark")).toBe(true);

      // Apply light theme multiple times
      applyThemeToDOM("light");
      applyThemeToDOM("light");
      applyThemeToDOM("light");

      // Should not have 'dark' class
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    it("should handle switching between themes correctly", () => {
      // Start with light
      applyThemeToDOM("light");
      expect(document.documentElement.classList.contains("dark")).toBe(false);

      // Switch to dark
      applyThemeToDOM("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);

      // Switch back to light
      applyThemeToDOM("light");
      expect(document.documentElement.classList.contains("dark")).toBe(false);

      // Switch to dark again
      applyThemeToDOM("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
  });
});
