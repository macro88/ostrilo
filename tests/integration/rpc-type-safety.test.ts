import { describe, it, expect } from "vitest";
import {
  validateAppSettingsPatch,
  validateOriginPolicyPatch,
} from "@/infrastructure/validation/schemas";
import type { RpcRequest } from "@/infrastructure/messaging/rpc";

/**
 * Integration tests for the RPC validation system
 * Tests type safety and validation consistency
 */

describe("RPC Validation Integration", () => {
  describe("Type Safety Integration", () => {
    it("should create valid RPC requests with proper patch typing", () => {
      // Test that RPC request types work with patch types
      const settingsPatch = { theme: "light" as const, sidePanel: false };
      const policyPatch = { trustLevel: "medium" as const, name: "Example" };

      // These should be valid RPC requests at compile time
      const settingsRequest: RpcRequest = {
        type: "settings.update",
        patch: settingsPatch,
      };

      const policyRequest: RpcRequest = {
        type: "policy.setOrigin",
        origin: "https://example.com",
        patch: policyPatch,
      };

      // Verify the structure is correct
      expect(settingsRequest.type).toBe("settings.update");
      expect(settingsRequest.patch).toEqual(settingsPatch);
      expect(policyRequest.type).toBe("policy.setOrigin");
      expect(policyRequest.patch).toEqual(policyPatch);
    });

    it("should validate compatible patch types", () => {
      // Test that patches used in RPC requests pass validation
      const settingsPatch = { theme: "dark" as const, autoLockMinutes: 60 };
      const policyPatch = {
        trustLevel: "high" as const,
        sessionGrantAll: true,
      };

      // These patches should validate successfully
      expect(validateAppSettingsPatch(settingsPatch).success).toBe(true);
      expect(validateOriginPolicyPatch(policyPatch).success).toBe(true);

      // And should be usable in RPC requests
      const settingsRequest: RpcRequest = {
        type: "settings.update",
        patch: settingsPatch,
      };

      const policyRequest: RpcRequest = {
        type: "policy.setOrigin",
        origin: "https://trusted-site.com",
        patch: policyPatch,
      };

      expect(settingsRequest.patch).toEqual(settingsPatch);
      expect(policyRequest.patch).toEqual(policyPatch);
    });
  });

  describe("Validation Consistency", () => {
    it("should have consistent validation between schemas and TypeScript types", () => {
      // Test comprehensive patch objects
      const complexSettingsPatch = {
        theme: "system" as const,
        sidePanel: true,
        // 60 is the ceiling now, not 1440. See AUTO_LOCK_BOUNDS.
        autoLockMinutes: 60,
        relays: ["wss://relay1.com", "wss://relay2.com"],
        mediumAllowKinds: [0, 1, 6, 1984],
      };

      const complexPolicyPatch = {
        name: "Complex Application",
        trustLevel: "medium" as const,
        sessionGrantAll: false,
        rules: {
          "0": "ask" as const,
          "1": "allow" as const,
          "4": "deny" as const,
          "1984": "allow" as const,
        },
      };

      // Both should validate successfully
      const settingsResult = validateAppSettingsPatch(complexSettingsPatch);
      const policyResult = validateOriginPolicyPatch(complexPolicyPatch);

      expect(settingsResult.success).toBe(true);
      expect(policyResult.success).toBe(true);

      // And should work in RPC requests
      const settingsRequest: RpcRequest = {
        type: "settings.update",
        patch: complexSettingsPatch,
      };

      const policyRequest: RpcRequest = {
        type: "policy.setOrigin",
        origin: "https://complex-app.com",
        patch: complexPolicyPatch,
      };

      expect(settingsRequest.patch).toEqual(complexSettingsPatch);
      expect(policyRequest.patch).toEqual(complexPolicyPatch);
    });

    it("should reject invalid patches consistently", () => {
      // Test that validation correctly rejects invalid data
      const invalidSettingsPatches = [
        {}, // Empty patch
        { theme: "invalid" }, // Invalid theme
        { autoLockMinutes: -1 }, // Invalid range
        { relays: ["not-a-url"] }, // Invalid URL
      ];

      const invalidPolicyPatches = [
        {}, // Empty patch
        { trustLevel: "invalid" }, // Invalid trust level
        { rules: { "1": "invalid" } }, // Invalid rule
      ];

      // All invalid patches should fail validation
      invalidSettingsPatches.forEach((patch) => {
        expect(validateAppSettingsPatch(patch).success).toBe(false);
      });

      invalidPolicyPatches.forEach((patch) => {
        expect(validateOriginPolicyPatch(patch).success).toBe(false);
      });
    });
  });

  describe("Patch Object Integrity", () => {
    it("should preserve patch structure through validation", () => {
      const originalSettingsPatch = {
        theme: "dark" as const,
        sidePanel: true,
        autoLockMinutes: 30,
      };

      const originalPolicyPatch = {
        name: "Test Application",
        trustLevel: "high" as const,
        sessionGrantAll: true,
      };

      // Validate the patches
      const settingsResult = validateAppSettingsPatch(originalSettingsPatch);
      const policyResult = validateOriginPolicyPatch(originalPolicyPatch);

      // Should succeed and preserve exact structure
      expect(settingsResult.success).toBe(true);
      expect(policyResult.success).toBe(true);

      if (settingsResult.success) {
        expect(settingsResult.data).toEqual(originalSettingsPatch);
      }
      if (policyResult.success) {
        expect(policyResult.data).toEqual(originalPolicyPatch);
      }
    });

    it("should handle minimal valid patches", () => {
      // Test the smallest possible valid patches
      const minimalSettingsPatch = { theme: "light" as const };
      const minimalPolicyPatch = { trustLevel: "low" as const };

      expect(validateAppSettingsPatch(minimalSettingsPatch).success).toBe(true);
      expect(validateOriginPolicyPatch(minimalPolicyPatch).success).toBe(true);

      // Should work in RPC requests
      const settingsRequest: RpcRequest = {
        type: "settings.update",
        patch: minimalSettingsPatch,
      };

      const policyRequest: RpcRequest = {
        type: "policy.setOrigin",
        origin: "https://minimal.com",
        patch: minimalPolicyPatch,
      };

      expect(settingsRequest.patch).toEqual(minimalSettingsPatch);
      expect(policyRequest.patch).toEqual(minimalPolicyPatch);
    });
  });
});
