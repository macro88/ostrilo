import { z } from "zod";

/**
 * Runtime validation schemas for RPC request payloads
 * Provides type safety and validation for patch objects and other dynamic data
 */

// Theme validation
const ThemeSchema = z.enum(["dark", "light", "system"]);

// Authorisation validation
export const AuthorisationSchema = z.enum(["allow", "deny", "ask"]);

// Trust level validation
const TrustLevelSchema = z.enum(["low", "medium", "high"]);

// Event kind authorisation (mapping from kind number to authorisation)
const NostrEventKindAuthorisationSchema = z.record(
  z.string().regex(/^\d+$/).transform(Number), // Keys should be numeric strings
  AuthorisationSchema
);

// Origin policy patch schema - allows partial updates
export const OriginPolicyPatchSchema = z
  .strictObject({
    name: z.string().optional(),
    trustLevel: TrustLevelSchema.optional(),
    rules: NostrEventKindAuthorisationSchema.optional(),
    sessionGrantAll: z.boolean().optional(),
    updatedAt: z.number().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for patch",
  });

// App settings patch schema - allows partial updates
export const AppSettingsPatchSchema = z
  .strictObject({
    theme: ThemeSchema.optional(),
    sidePanel: z.boolean().optional(),
    autoLockMinutes: z.number().min(0).max(1440).optional(), // 0 to 24 hours
    maxActivityEntries: z.number().int().min(10).max(500).optional(),
    relays: z.array(z.url()).optional(),
    selectedKeyId: z.uuid().optional(),
    mediumAllowKinds: z.array(z.number().min(0).max(65535)).optional(), // Valid Nostr kind range
    sessionTTLMinutes: z.number().min(0).max(1440).optional(), // 0 to 24 hours
    onboardingCompleted: z.boolean().optional(),
    onboardingCompletedAt: z.number().optional(),
    // Note: origins array updates should go through policy.setOrigin, not settings.update
  })
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

export const KeyIdSchema = z.uuid("Invalid key ID format");

export const EventKindSchema = z
  .number()
  .min(0)
  .max(65535, "Invalid event kind");

export const ModeSchema = z.string().min(1, "Mode cannot be empty");

// ============================================
// NIP-01 Event Validation Schemas
// ============================================

/** 32-byte lowercase hex string (64 chars) */
const HexString32Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Must be 64-character lowercase hex string");

/** Tag array - array of strings */
const TagSchema = z.array(z.string());

/** Tags array - array of tag arrays */
const TagsSchema = z.array(TagSchema);

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

// Infer types from schemas
export type UnsignedEventInput = z.infer<typeof UnsignedEventSchema>;
	
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
// ============================================
// Approval Queue Validation Schemas
// ============================================

/**
 * Approval queue request validation schemas
 * For runtime validation of approval.* RPC requests
 */

const ApprovalActionSchema = z.enum([
  "allow",
  "allow_once",
  "deny",
  "deny_remember",
]);

export const ApprovalResolveRequestSchema = z.object({
  requestId: z.uuid("Invalid request ID format"),
  action: ApprovalActionSchema,
});

// Infer types from schemas
export type ApprovalAction = z.infer<typeof ApprovalActionSchema>;
export type ApprovalResolveRequest = z.infer<
  typeof ApprovalResolveRequestSchema
>;

// Export validation functions
