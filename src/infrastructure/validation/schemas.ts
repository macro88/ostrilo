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

// ============================================
// NIP-01 Event Validation Schemas
// ============================================

/** 32-byte lowercase hex string (64 chars) */
export const HexString32Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Must be 64-character lowercase hex string");

/** 64-byte lowercase hex string (128 chars) for signatures */
export const HexString64Schema = z
  .string()
  .regex(/^[0-9a-f]{128}$/, "Must be 128-character lowercase hex string");

/** Tag array - array of strings */
export const TagSchema = z.array(z.string());

/** Tags array - array of tag arrays */
export const TagsSchema = z.array(TagSchema);

/**
 * NIP-01 Unsigned Event Schema
 * Validates events received from dapps before signing
 */
export const UnsignedEventSchema = z.object({
  kind: EventKindSchema,
  content: z.string(),
  tags: TagsSchema,
  created_at: z.number().int().positive(),
  pubkey: HexString32Schema.optional(),
});

/**
 * NIP-01 Signed Event Schema
 * Validates complete signed events
 */
export const SignedEventSchema = z.object({
  id: HexString32Schema,
  pubkey: HexString32Schema,
  created_at: z.number().int().positive(),
  kind: EventKindSchema,
  tags: TagsSchema,
  content: z.string(),
  sig: HexString64Schema,
});

// Infer types from schemas
export type UnsignedEventInput = z.infer<typeof UnsignedEventSchema>;
export type SignedEventInput = z.infer<typeof SignedEventSchema>;

// Export validation functions
export const validateUnsignedEvent = (data: unknown) =>
  UnsignedEventSchema.safeParse(data);

export const validateSignedEvent = (data: unknown) =>
  SignedEventSchema.safeParse(data);

// ============================================
// Activity Log Validation Schemas
// ============================================

/**
 * Activity log request validation schemas
 * For runtime validation of activity.* RPC requests
 */

export const ActivityGetRecentRequestSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

export const ActivityFilterByRequestSchema = z.object({
  origin: OriginSchema.optional(),
  kind: EventKindSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

// Infer types from schemas
export type ActivityGetRecentRequest = z.infer<
  typeof ActivityGetRecentRequestSchema
>;
export type ActivityFilterByRequest = z.infer<
  typeof ActivityFilterByRequestSchema
>;

// Export validation functions
export const validateActivityGetRecentRequest = (data: unknown) =>
  ActivityGetRecentRequestSchema.safeParse(data);

export const validateActivityFilterByRequest = (data: unknown) =>
  ActivityFilterByRequestSchema.safeParse(data);
