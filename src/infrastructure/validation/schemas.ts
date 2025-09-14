import { z } from "zod";

/**
 * Runtime validation schemas for RPC request payloads
 * Provides type safety and validation for patch objects and other dynamic data
 */

// Theme validation
export const ThemeSchema = z.enum(["dark", "light", "system"]);

// Authorisation validation
export const AuthorisationSchema = z.enum(["allow", "deny", "ask"]);

// Trust level validation
export const TrustLevelSchema = z.enum(["low", "medium", "high"]);

// Event kind authorisation (mapping from kind number to authorisation)
export const NostrEventKindAuthorisationSchema = z.record(
  z.string().regex(/^\d+$/).transform(Number), // Keys should be numeric strings
  AuthorisationSchema
);

// Origin policy patch schema - allows partial updates
export const OriginPolicyPatchSchema = z
  .object({
    name: z.string().optional(),
    trustLevel: TrustLevelSchema.optional(),
    rules: NostrEventKindAuthorisationSchema.optional(),
    sessionGrantAll: z.boolean().optional(),
    updatedAt: z.number().optional(),
  })
  .strict() // Reject unknown properties
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for patch",
  });

// App settings patch schema - allows partial updates
export const AppSettingsPatchSchema = z
  .object({
    theme: ThemeSchema.optional(),
    sidePanel: z.boolean().optional(),
    autoLockMinutes: z.number().min(0).max(1440).optional(), // 0 to 24 hours
    relays: z.array(z.string().url()).optional(),
    selectedKeyId: z.string().uuid().optional(),
    mediumAllowKinds: z.array(z.number().min(0).max(65535)).optional(), // Valid Nostr kind range
    sessionTTLMinutes: z.number().min(0).max(1440).optional(), // 0 to 24 hours
    onboardingCompleted: z.boolean().optional(),
    onboardingCompletedAt: z.number().optional(),
    // Note: origins array updates should go through policy.setOrigin, not settings.update
  })
  .strict() // Reject unknown properties
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for patch",
  });

// Infer TypeScript types from schemas
export type AppSettingsPatch = z.infer<typeof AppSettingsPatchSchema>;
export type OriginPolicyPatch = z.infer<typeof OriginPolicyPatchSchema>;

// Export validation functions for convenience
export const validateAppSettingsPatch = (data: unknown) =>
  AppSettingsPatchSchema.safeParse(data);

export const validateOriginPolicyPatch = (data: unknown) =>
  OriginPolicyPatchSchema.safeParse(data);

// Crypto validation schemas
export const PasswordSchema = z
  .string()
  .min(1, "Password cannot be empty")
  .max(1000, "Password too long"); // Reasonable limit

export const KeyInputSchema = z
  .string()
  .min(1, "Key input cannot be empty")
  .refine(
    (val) => {
      // Accept hex (64 chars) or nsec/npub bech32 format
      return (
        /^[0-9a-fA-F]{64}$/.test(val) || // 64-char hex
        /^nsec1[0-9a-z]{50,}$/.test(val) || // nsec bech32
        /^npub1[0-9a-z]{50,}$/.test(val) // npub bech32 (for validation)
      );
    },
    {
      message:
        "Invalid key format. Expected 64-char hex or bech32 nsec/npub format",
    }
  );

export const HashHexSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "Hash must be 64-character hex string");

export const OriginSchema = z
  .string()
  .url("Invalid origin URL")
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" || parsed.protocol === "http:";
      } catch {
        return false;
      }
    },
    {
      message: "Origin must be a valid HTTP/HTTPS URL",
    }
  );

export const LabelSchema = z.string().max(100, "Label too long").optional();

export const KeyIdSchema = z.string().uuid("Invalid key ID format");

export const EventKindSchema = z
  .number()
  .min(0)
  .max(65535, "Invalid event kind");

export const ModeSchema = z.string().min(1, "Mode cannot be empty");
