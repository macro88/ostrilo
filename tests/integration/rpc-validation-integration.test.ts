import { describe, it, expect } from "vitest";
import {
  validateAppSettingsPatch,
  validateOriginPolicyPatch,
} from "@/infrastructure/validation/schemas";
import type { RpcRequest } from "@/infrastructure/messaging/rpc";

/**
 * Integration tests for the RPC validation system
 * Tests type safety and validation consistency without runtime dependencies
 */

describe("RPC Validation Integration", () => {
  describe("Client Type Safety", () => {
    it("should enforce AppSettingsPatch types at compile time", () => {
      // These should be valid TypeScript - no runtime test needed
      const validPatch1 = { theme: "dark" as const };
      const validPatch2 = { sidePanel: true, autoLockMinutes: 30 };

      // Validate the patches work with the validation function
      expect(validateAppSettingsPatch(validPatch1).success).toBe(true);
      expect(validateAppSettingsPatch(validPatch2).success).toBe(true);
    });

    it("should enforce OriginPolicyPatch types at compile time", () => {
      // These should be valid TypeScript - no runtime test needed
      const validPatch1 = { trustLevel: "high" as const };
      const validPatch2 = { name: "Test Site", sessionGrantAll: true };

      // Validate the patches work with the validation function
      expect(validateOriginPolicyPatch(validPatch1).success).toBe(true);
      expect(validateOriginPolicyPatch(validPatch2).success).toBe(true);
    });

    it("should create valid RPC requests with proper typing", () => {
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
  });

  describe("Validation Coverage", () => {
    it("should validate patch objects correctly", () => {
      // Test validation of various patch combinations
      const validSettingsPatches = [
        { theme: "dark" },
        { sidePanel: true },
        { autoLockMinutes: 15 },
        { theme: "light", sidePanel: false, autoLockMinutes: 60 },
        { relays: ["wss://relay1.com", "wss://relay2.com"] },
      ];

      const validPolicyPatches = [
        { trustLevel: "low" },
        { name: "My Site" },
        { sessionGrantAll: true },
        { rules: { "1": "allow", "6": "deny" } },
        { trustLevel: "high", name: "Trusted Site", sessionGrantAll: true },
      ];

      // All valid patches should pass validation
      validSettingsPatches.forEach((patch) => {
        expect(validateAppSettingsPatch(patch).success).toBe(true);
      });

      validPolicyPatches.forEach((patch) => {
        expect(validateOriginPolicyPatch(patch).success).toBe(true);
      });
    });

    it("should reject invalid patch objects", () => {
      // Test validation rejection for invalid patches
      const invalidSettingsPatches = [
        {}, // Empty patch
        { theme: "invalid" }, // Invalid theme
        { autoLockMinutes: -1 }, // Invalid range
        { unknownField: "value" }, // Unknown property
        { relays: ["not-a-url"] }, // Invalid URL
      ];

      const invalidPolicyPatches = [
        {}, // Empty patch
        { trustLevel: "invalid" }, // Invalid trust level
        { rules: { "1": "invalid" } }, // Invalid rule
        { unknownField: "value" }, // Unknown property
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

  describe("Schema Consistency", () => {
    it("should have consistent validation between schemas and TypeScript types", () => {
      // This test ensures our Zod schemas match our TypeScript interfaces
      // by testing known valid values work with both systems

      const testSettingsPatch = {
        theme: "system" as const,
        sidePanel: true,
        // 60 is the ceiling now, not 1440. See AUTO_LOCK_BOUNDS.
        autoLockMinutes: 60,
        relays: ["wss://example.com"],
      };

      const testPolicyPatch = {
        name: "Test Application",
        trustLevel: "medium" as const,
        sessionGrantAll: false,
        rules: {
          "0": "ask" as const,
          "1": "allow" as const,
          "4": "deny" as const,
        },
      };

      // Both should validate successfully
      const settingsResult = validateAppSettingsPatch(testSettingsPatch);
      const policyResult = validateOriginPolicyPatch(testPolicyPatch);

      expect(settingsResult.success).toBe(true);
      expect(policyResult.success).toBe(true);

      // And the returned data should match our input
      if (settingsResult.success) {
        expect(settingsResult.data).toEqual(testSettingsPatch);
      }
      if (policyResult.success) {
        expect(policyResult.data).toEqual(testPolicyPatch);
      }
    });
  });
});
