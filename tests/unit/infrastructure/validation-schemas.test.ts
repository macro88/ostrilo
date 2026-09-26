import { describe, it, expect } from "vitest";
import {
  AppSettingsPatchSchema,
  OriginPolicyPatchSchema,
  PasswordSchema,
  KeyInputSchema,
  LabelSchema,
  KeyIdSchema,
  EventKindSchema,
  HashHexSchema,
  OriginSchema,
  ModeSchema,
  validateAppSettingsPatch,
  validateOriginPolicyPatch,
} from "@/infrastructure/validation/schemas";

describe("Validation Schemas", () => {
  describe("PasswordSchema", () => {
    it("should accept valid passwords", () => {
      expect(PasswordSchema.safeParse("password123").success).toBe(true);
      expect(PasswordSchema.safeParse("a").success).toBe(true);
      expect(
        PasswordSchema.safeParse("very-long-password-with-special-chars!@#$%")
          .success
      ).toBe(true);
    });

    it("should reject empty passwords", () => {
      expect(PasswordSchema.safeParse("").success).toBe(false);
      // Note: Spaces are valid in passwords (user might intentionally use spaces)
      expect(PasswordSchema.safeParse("   ").success).toBe(true);
    });

    it("should reject non-string values", () => {
      expect(PasswordSchema.safeParse(123).success).toBe(false);
      expect(PasswordSchema.safeParse(null).success).toBe(false);
      expect(PasswordSchema.safeParse(undefined).success).toBe(false);
    });
  });

  describe("KeyInputSchema", () => {
    it("should accept valid hex keys", () => {
      const validHex =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      expect(KeyInputSchema.safeParse(validHex).success).toBe(true);
      expect(KeyInputSchema.safeParse(validHex.toUpperCase()).success).toBe(
        true
      );
    });

    it("should accept valid nsec bech32 keys", () => {
      const validNsec =
        "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
      expect(KeyInputSchema.safeParse(validNsec).success).toBe(true);
    });

    it("should accept valid npub bech32 keys", () => {
      const validNpub =
        "npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
      expect(KeyInputSchema.safeParse(validNpub).success).toBe(true);
    });

    it("should reject invalid hex keys", () => {
      expect(KeyInputSchema.safeParse("123").success).toBe(false); // Too short
      expect(
        KeyInputSchema.safeParse(
          "gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg"
        ).success
      ).toBe(false); // Invalid hex chars
      expect(
        KeyInputSchema.safeParse(
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde"
        ).success
      ).toBe(false); // Wrong length
    });

    it("should reject invalid bech32 keys", () => {
      expect(KeyInputSchema.safeParse("nsec1").success).toBe(false); // Too short
      expect(KeyInputSchema.safeParse("nsec").success).toBe(false); // Missing number
      expect(
        KeyInputSchema.safeParse(
          "notnsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
        ).success
      ).toBe(false); // Wrong prefix
    });

    it("should reject empty or non-string values", () => {
      expect(KeyInputSchema.safeParse("").success).toBe(false);
      expect(KeyInputSchema.safeParse(123).success).toBe(false);
      expect(KeyInputSchema.safeParse(null).success).toBe(false);
    });
  });

  describe("LabelSchema", () => {
    it("should accept valid labels", () => {
      expect(LabelSchema.safeParse("My Key").success).toBe(true);
      expect(LabelSchema.safeParse("A").success).toBe(true);
      expect(LabelSchema.safeParse("").success).toBe(true); // Empty is valid (optional field)
    });

    it("should reject labels that are too long", () => {
      const longLabel = "a".repeat(101);
      expect(LabelSchema.safeParse(longLabel).success).toBe(false);
    });

    it("should accept labels up to 100 characters", () => {
      const maxLabel = "a".repeat(100);
      expect(LabelSchema.safeParse(maxLabel).success).toBe(true);
    });
  });

  describe("KeyIdSchema", () => {
    it("should accept valid UUIDs", () => {
      expect(
        KeyIdSchema.safeParse("123e4567-e89b-12d3-a456-426614174000").success
      ).toBe(true);
      expect(
        KeyIdSchema.safeParse("550e8400-e29b-41d4-a716-446655440000").success
      ).toBe(true);
    });

    it("should reject invalid UUID formats", () => {
      expect(KeyIdSchema.safeParse("not-a-uuid").success).toBe(false);
      expect(KeyIdSchema.safeParse("123456789").success).toBe(false);
      expect(
        KeyIdSchema.safeParse("123e4567-e89b-12d3-a456-42661417400").success
      ).toBe(false); // Too short
    });

    it("should reject non-string values", () => {
      expect(KeyIdSchema.safeParse(123).success).toBe(false);
      expect(KeyIdSchema.safeParse(null).success).toBe(false);
    });
  });

  describe("EventKindSchema", () => {
    it("should accept valid event kinds", () => {
      expect(EventKindSchema.safeParse(0).success).toBe(true);
      expect(EventKindSchema.safeParse(1).success).toBe(true);
      expect(EventKindSchema.safeParse(1984).success).toBe(true);
      expect(EventKindSchema.safeParse(65535).success).toBe(true);
    });

    it("should reject invalid event kinds", () => {
      expect(EventKindSchema.safeParse(-1).success).toBe(false);
      expect(EventKindSchema.safeParse(65536).success).toBe(false);
      expect(EventKindSchema.safeParse(100000).success).toBe(false);
    });

    it("should reject non-number values", () => {
      expect(EventKindSchema.safeParse("1").success).toBe(false);
      expect(EventKindSchema.safeParse(null).success).toBe(false);
    });

    it("rejects a fractional kind that would evade the protected-kind gate", () => {
      // isProtectedKind is a Set membership test and rules are keyed by kind,
      // so 1.0000001 would slip past every control keyed on kind 1.
      expect(EventKindSchema.safeParse(1.0000001).success).toBe(false);
      expect(EventKindSchema.safeParse(1.5).success).toBe(false);
      expect(EventKindSchema.safeParse(9734.5).success).toBe(false);
    });

    it("rejects non-finite kinds", () => {
      expect(EventKindSchema.safeParse(Number.NaN).success).toBe(false);
      expect(EventKindSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(
        false
      );
      expect(EventKindSchema.safeParse(Number.NEGATIVE_INFINITY).success).toBe(
        false
      );
    });

    it("still accepts ordinary integer kinds", () => {
      expect(EventKindSchema.safeParse(0).success).toBe(true);
      expect(EventKindSchema.safeParse(1).success).toBe(true);
      expect(EventKindSchema.safeParse(30078).success).toBe(true);
    });
  });

  describe("HashHexSchema", () => {
    it("should accept valid 64-character hex strings", () => {
      const validHash =
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
      expect(HashHexSchema.safeParse(validHash).success).toBe(true);
      expect(HashHexSchema.safeParse(validHash.toUpperCase()).success).toBe(
        true
      );
    });

    it("should reject invalid hex strings", () => {
      expect(HashHexSchema.safeParse("123").success).toBe(false); // Too short
      expect(
        HashHexSchema.safeParse(
          "gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg"
        ).success
      ).toBe(false); // Invalid chars
      expect(
        HashHexSchema.safeParse(
          "abcdef0123456789abcdef0123456789abcdef0123456789abcdef012345678"
        ).success
      ).toBe(false); // Wrong length
    });

    it("should reject non-string values", () => {
      expect(HashHexSchema.safeParse(123).success).toBe(false);
      expect(HashHexSchema.safeParse(null).success).toBe(false);
    });
  });

  describe("OriginSchema", () => {
    it("should accept valid HTTP/HTTPS URLs", () => {
      expect(OriginSchema.safeParse("https://example.com").success).toBe(true);
      expect(OriginSchema.safeParse("http://localhost:3000").success).toBe(
        true
      );
      expect(
        OriginSchema.safeParse("https://subdomain.example.com").success
      ).toBe(true);
      expect(OriginSchema.safeParse("https://example.com:8080").success).toBe(
        true
      );
    });

    it("should reject non-HTTP/HTTPS URLs", () => {
      expect(OriginSchema.safeParse("ftp://example.com").success).toBe(false);
      expect(OriginSchema.safeParse("ws://example.com").success).toBe(false);
      expect(OriginSchema.safeParse("file:///path").success).toBe(false);
    });

    it("should reject invalid URLs", () => {
      expect(OriginSchema.safeParse("not-a-url").success).toBe(false);
      expect(OriginSchema.safeParse("example.com").success).toBe(false); // Missing protocol
      expect(OriginSchema.safeParse("://example.com").success).toBe(false);
    });

    it("should reject non-string values", () => {
      expect(OriginSchema.safeParse(123).success).toBe(false);
      expect(OriginSchema.safeParse(null).success).toBe(false);
    });
  });

  describe("ModeSchema", () => {
    it("should accept non-empty strings", () => {
      expect(ModeSchema.safeParse("allow").success).toBe(true);
      expect(ModeSchema.safeParse("deny").success).toBe(true);
      expect(ModeSchema.safeParse("ask").success).toBe(true);
      expect(ModeSchema.safeParse("a").success).toBe(true);
    });

    it("should reject empty strings", () => {
      expect(ModeSchema.safeParse("").success).toBe(false);
      // Note: Spaces are valid for mode strings (might be intentional)
      expect(ModeSchema.safeParse("   ").success).toBe(true);
    });

    it("should reject non-string values", () => {
      expect(ModeSchema.safeParse(123).success).toBe(false);
      expect(ModeSchema.safeParse(null).success).toBe(false);
    });
  });

  describe("AppSettingsPatchSchema", () => {
    it("should accept valid partial settings", () => {
      const result = AppSettingsPatchSchema.safeParse({ theme: "dark" });
      expect(result.success).toBe(true);

      const result2 = AppSettingsPatchSchema.safeParse({
        theme: "light",
        sidePanel: true,
        autoLockMinutes: 30,
      });
      expect(result2.success).toBe(true);
    });

    it("should reject empty patches", () => {
      const result = AppSettingsPatchSchema.safeParse({});
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain(
        "At least one field must be provided"
      );
    });

    it("should reject invalid theme values", () => {
      const result = AppSettingsPatchSchema.safeParse({ theme: "invalid" });
      expect(result.success).toBe(false);
    });

    it("refuses any relay the extension will not connect to", () => {
      // `z.array(z.url())` accepted every one of these. They were dropped at
      // connect time, so nothing was dialled - but they persisted in
      // settings and were displayed back as configured relays.
      for (const relay of [
        "ws://relay.example",
        "http://relay.example",
        "https://relay.example",
        "wss://user:pass@relay.example",
        "javascript:alert(1)",
        "not-a-url",
        "wss://",
      ]) {
        expect(
          AppSettingsPatchSchema.safeParse({ relays: [relay] }).success,
          `SECURITY REGRESSION: ${relay} was accepted into stored settings`
        ).toBe(false);
      }

      expect(
        AppSettingsPatchSchema.safeParse({
          relays: ["wss://relay.example", "wss://relay.other"],
        }).success
      ).toBe(true);
    });

    it("bounds the relay list, so no write can fan an identity out further", () => {
      const many = Array.from(
        { length: 11 },
        (_, i) => `wss://relay-${i}.example`
      );
      expect(
        AppSettingsPatchSchema.safeParse({ relays: many }).success,
        "SECURITY REGRESSION: an unbounded relay list was accepted"
      ).toBe(false);
      expect(
        AppSettingsPatchSchema.safeParse({ relays: many.slice(0, 10) }).success
      ).toBe(true);
    });

    it("refuses an upload endpoint that is not https:", () => {
      for (const endpoint of [
        "http://uploads.example",
        "javascript:alert(1)",
        "data:text/plain,x",
        "not-a-url",
      ]) {
        expect(
          AppSettingsPatchSchema.safeParse({ uploadEndpoint: endpoint })
            .success,
          `SECURITY REGRESSION: ${endpoint} was accepted as an upload target`
        ).toBe(false);
      }
      expect(
        AppSettingsPatchSchema.safeParse({
          uploadEndpoint: "https://uploads.example/api",
        }).success
      ).toBe(true);
      // Empty clears it, which is the shipped default: no destination,
      // no outbound request.
      expect(
        AppSettingsPatchSchema.safeParse({ uploadEndpoint: "" }).success
      ).toBe(true);
    });

    it("bounds autoLockMinutes to 1..60", () => {
      // There is no "never" and no multi-hour timeout. 0 used to be
      // accepted and read as "do not auto-lock"; 1440 allowed a timeout
      // longer than the browser session it was meant to bound.
      for (const rejected of [0, -1, 61, 1441, 1.5, Number.NaN]) {
        expect(
          AppSettingsPatchSchema.safeParse({ autoLockMinutes: rejected })
            .success,
          `SECURITY REGRESSION: autoLockMinutes ${rejected} was accepted`
        ).toBe(false);
      }
      for (const accepted of [1, 5, 30, 60]) {
        expect(
          AppSettingsPatchSchema.safeParse({ autoLockMinutes: accepted })
            .success
        ).toBe(true);
      }
    });

    it("bounds sessionTTLMinutes to 1..60", () => {
      for (const rejected of [0, -1, 61, 1440]) {
        expect(
          AppSettingsPatchSchema.safeParse({ sessionTTLMinutes: rejected })
            .success,
          `SECURITY REGRESSION: sessionTTLMinutes ${rejected} was accepted`
        ).toBe(false);
      }
      expect(
        AppSettingsPatchSchema.safeParse({ sessionTTLMinutes: 15 }).success
      ).toBe(true);
    });

    it("should reject invalid autoLockMinutes values", () => {
      expect(
        AppSettingsPatchSchema.safeParse({ autoLockMinutes: -1 }).success
      ).toBe(false);
      expect(
        AppSettingsPatchSchema.safeParse({ autoLockMinutes: 1441 }).success
      ).toBe(false);
    });

    it("should reject unknown properties", () => {
      const result = AppSettingsPatchSchema.safeParse({
        unknownField: "value",
      });
      expect(result.success).toBe(false);
    });

    it("should accept valid relay arrays", () => {
      const result = AppSettingsPatchSchema.safeParse({
        relays: ["wss://relay.damus.io", "wss://relay.primal.net"],
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid relay URLs", () => {
      const result = AppSettingsPatchSchema.safeParse({
        relays: ["not-a-url", "wss://valid.com"],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("OriginPolicyPatchSchema", () => {
    it("should accept valid partial origin policies", () => {
      const result = OriginPolicyPatchSchema.safeParse({
        trustLevel: "medium",
      });
      expect(result.success).toBe(true);

      const result2 = OriginPolicyPatchSchema.safeParse({
        name: "Example Site",
        trustLevel: "high",
        identityDisclosure: "allow",
      });
      expect(result2.success).toBe(true);
    });

    it("should reject empty patches", () => {
      const result = OriginPolicyPatchSchema.safeParse({});
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain(
        "At least one field must be provided"
      );
    });

    it("should reject invalid trust levels", () => {
      const result = OriginPolicyPatchSchema.safeParse({
        trustLevel: "invalid",
      });
      expect(result.success).toBe(false);
    });

    it.each([
      ["per-kind rules", { rules: { "1": "allow" } }],
      ["the session display flag", { sessionGrantAll: true }],
      ["updatedAt", { updatedAt: 1 }],
    ])("refuses %s, which have their own paths", (_name, patch) => {
      expect(OriginPolicyPatchSchema.safeParse(patch).success).toBe(false);
    });

    it("should reject invalid disclosure decisions", () => {
      const result = OriginPolicyPatchSchema.safeParse({
        identityDisclosure: "maybe",
      });
      expect(result.success).toBe(false);
    });

    it("should reject unknown properties", () => {
      const result = OriginPolicyPatchSchema.safeParse({
        unknownField: "value",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Validation Functions", () => {
    describe("validateAppSettingsPatch", () => {
      it("should return success for valid patches", () => {
        const result = validateAppSettingsPatch({ theme: "dark" });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.theme).toBe("dark");
        }
      });

      it("should return error for invalid patches", () => {
        const result = validateAppSettingsPatch({});
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues).toBeDefined();
        }
      });
    });

    describe("validateOriginPolicyPatch", () => {
      it("should return success for valid patches", () => {
        const result = validateOriginPolicyPatch({ trustLevel: "medium" });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.trustLevel).toBe("medium");
        }
      });

      it("should return error for invalid patches", () => {
        const result = validateOriginPolicyPatch({});
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues).toBeDefined();
        }
      });
    });
  });
});
