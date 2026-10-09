import { z } from "zod";
import { RelayUrlListSchema } from "@/domain/relay/url";
import {
  PASSWORD_POLICY,
  checkPassword,
  describeViolation,
} from "@/domain/utils/password-policy";

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

/**
 * A Nostr event kind.
 *
 * `.int()` is load-bearing, not tidiness. Kind policy is decided by set
 * membership and object-key lookup, both of which are equality tests: without
 * it, `1.0000001` is not `1`, so a fractional kind walks straight past the
 * always-ask gate for kind 1. It also rejects NaN and Infinity in the same
 * predicate.
 *
 * Declared here, above its first use, because `AppSettingsPatchSchema` is
 * evaluated at module load.
 */
export const EventKindSchema = z
  .number()
  .int("Event kind must be an integer")
  .min(0)
  .max(65535, "Invalid event kind");

/**
 * The fields `policy.setOrigin` may write, and nothing else.
 *
 * Per-kind rules and session grants are NOT here. Each has its own method -
 * `policy.setKindRule` and `policy.setSession` - which asks for the password
 * where the value grants authority. When this patch also accepted `rules`, one
 * message could write `{ "0": "allow" }` with no password at all, walking
 * around the gate `setKindRule` enforces. `updatedAt` is the service's to set.
 *
 * Strict, so a removed field is `invalid_params` rather than silently dropped.
 */
export const OriginPolicyPatchSchema = z
  .strictObject({
    name: z.string().optional(),
    trustLevel: TrustLevelSchema.optional(),
    identityDisclosure: AuthorisationSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for patch",
  });

// App settings patch schema - allows partial updates
export const AppSettingsPatchSchema = z
  .strictObject({
    theme: ThemeSchema.optional(),
    sidePanel: z.boolean().optional(),
    // 1 to 60. There is no "never": a stored 0 normalizes to the shipped
    // default on read. See AUTO_LOCK_BOUNDS in @/domain/types.
    autoLockMinutes: z.number().int().min(1).max(60).optional(),
    maxActivityEntries: z.number().int().min(10).max(500).optional(),
    // `z.url()` accepted `http:`, `ws:`, credentials in the authority, and
    // an unbounded list. Those were dropped at USE time by isValidRelayUrl,
    // so nothing connected to them - but they persisted, and settings
    // displayed them back to the user as if they were configured.
    relays: RelayUrlListSchema.optional(),
    selectedKeyId: z.uuid().optional(),
    mediumAllowKinds: z.array(EventKindSchema).optional(), // Valid Nostr kind range
    // Minimum 1: a zero TTL used to mean "until lock", which with auto-lock
    // disabled is an unbounded grant of the broadest authority the product
    // offers. No settings write may reintroduce one.
    sessionTTLMinutes: z.number().int().min(1).max(60).optional(), // 1 to 60 min
    // https: only, and an empty string clears it. Anything else - http:,
    // data:, javascript: - is refused here as well as at use time.
    uploadEndpoint: z
      .union([
        z.literal(""),
        z
          .string()
          .max(512)
          .refine((value) => {
            try {
              return new URL(value).protocol === "https:";
            } catch {
              return false;
            }
          }, { message: "Upload endpoint must be an https:// URL" }),
      ])
      .optional(),
    onboardingCompleted: z.boolean().optional(),
    onboardingCompletedAt: z.number().int().nonnegative().optional(),
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
/**
 * TRANSPORT HYGIENE ONLY. Non-empty, bounded length.
 *
 * This guards VERIFICATION paths - vault.unlock, vault.reveal,
 * crypto.evaluatePassword - where the password being checked already exists and
 * applying a new-password policy to it would lock out any user whose existing
 * password predates the policy.
 *
 * It is NOT a password policy. Creation paths use NewPasswordSchema.
 */
export const PasswordSchema = z
  .string()
  .min(1, "Password cannot be empty")
  .max(PASSWORD_POLICY.maxLength, "Password too long");

/**
 * The policy gate for a NEW vault password.
 *
 * Split from PasswordSchema deliberately. Applying a new-password policy to
 * every path would tell an existing user, at unlock, that their own correct
 * password is invalid. So the policy applies to the passwords a user is
 * choosing - vault creation and `vault.changePassword`'s new password - and
 * never to one being verified.
 *
 * The blocklist lives in the background and is passed in, because the module is
 * large and must not reach a UI bundle. A verdict built without it is never
 * `acceptable`, so this cannot accidentally pass a password it did not fully
 * check.
 */
export function makeNewPasswordSchema(
  blocklist: ReadonlySet<string>,
  extraTerms: readonly string[] = []
) {
  return z.string().superRefine((value, ctx) => {
    const verdict = checkPassword(value, { blocklist, extraTerms });
    if (verdict.acceptable) return;
    const first = verdict.violations[0];
    ctx.addIssue({
      code: "custom",
      // Safe text only: never echoes the password.
      message: first
        ? describeViolation(first)
        : "Password does not meet the policy.",
    });
  });
}

/**
 * Transport shape of `vault.changePassword`. Both fields are checked only for
 * hygiene here: the current password is verified against the vault, and the
 * new one against the creation policy with its blocklist, in the background.
 */
export const ChangePasswordRequestSchema = z.object({
  currentPassword: PasswordSchema,
  newPassword: PasswordSchema,
});

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

export const ModeSchema = z.string().min(1, "Mode cannot be empty");

// ============================================
// NIP-01 Event Validation Schemas
// ============================================

/** 32-byte lowercase hex string (64 chars) */
const HexString32Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Must be 64-character lowercase hex string");

/**
 * Size bounds on an event a web page asks to have signed.
 *
 * `content` and `tags` had NO bound at all. A page could hand the service
 * worker a hundred-megabyte string, which `computeEventId` would then
 * serialize and SHA-256 inside the worker, and which the approval dialog
 * would render into a clipped panel with no indication of how much was
 * being hidden. The user approves what they can see.
 *
 * Measured in UTF-8 BYTES, not string length: `"𝄞".length` is 2 but it
 * occupies 4 bytes, so a length bound is off by up to 4x on the content
 * that is most likely to be adversarial.
 *
 * The numbers are generous against real Nostr usage - a long-form article
 * is a few kilobytes, a large contact list a few thousand tags - and the
 * schema tests pin typical note, reaction, profile, relay-list and contact-
 * list events as still valid.
 */
export const MAX_EVENT_CONTENT_BYTES = 65_536;
export const MAX_EVENT_TAGS = 5_000;
export const MAX_TAG_ELEMENTS = 100;
export const MAX_TAG_ELEMENT_BYTES = 1_024;
export const MAX_EVENT_SERIALIZED_BYTES = 1_048_576;

/** UTF-8 byte length, which is what the wire and the hash actually see. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Tag array - array of strings, bounded per element and in count. */
const TagSchema = z
  .array(
    z.string().refine((v) => utf8ByteLength(v) <= MAX_TAG_ELEMENT_BYTES, {
      message: `Tag element exceeds ${MAX_TAG_ELEMENT_BYTES} bytes`,
    })
  )
  .max(MAX_TAG_ELEMENTS, {
    message: `Tag has more than ${MAX_TAG_ELEMENTS} elements`,
  });

/** Tags array - array of tag arrays */
const TagsSchema = z.array(TagSchema).max(MAX_EVENT_TAGS, {
  message: `Event has more than ${MAX_EVENT_TAGS} tags`,
});

/**
 * True when every code unit in `value` is part of a valid UTF-16 pair.
 *
 * An unpaired surrogate - `\uD800` with no low surrogate after it - is not
 * representable in UTF-8. Two things go wrong if one reaches the signer.
 * `JSON.stringify` escapes it as `\ud800` in the NIP-01 pre-image, where the
 * spec asks for it raw, so a strict verifier recomputes a different event id
 * and rejects the event. And `TextEncoder` maps it to `U+FFFD`, so the bytes
 * that get hashed are not the bytes the page sent.
 *
 * Rejected rather than normalized. Replacing it with `U+FFFD` here would mean
 * the extension silently altering the content the user is about to sign,
 * which is precisely the property the approval prompt exists to guarantee.
 */
function isWellFormedText(value: string): boolean {
  return value.isWellFormed();
}

/**
 * NIP-01 Unsigned Event Schema
 * Validates events received from dapps before signing
 */
export const UnsignedEventSchema = z
  .object({
    kind: EventKindSchema,
    content: z
      .string()
      .refine((v) => utf8ByteLength(v) <= MAX_EVENT_CONTENT_BYTES, {
        message: `Content exceeds ${MAX_EVENT_CONTENT_BYTES} bytes`,
      }),
    tags: TagsSchema,
    created_at: z.number().int().positive(),
    pubkey: HexString32Schema.optional(),
  })
  // Per-field bounds alone are not enough: 5,000 tags of 100 elements of
  // 1,024 bytes each is half a gigabyte and every individual bound holds.
  .refine(
    (event) => utf8ByteLength(JSON.stringify(event)) <= MAX_EVENT_SERIALIZED_BYTES,
    { message: `Event exceeds ${MAX_EVENT_SERIALIZED_BYTES} serialized bytes` }
  )
  // Checked here, at the boundary, rather than inside the serializer: this is
  // the gate every nostr.signEvent request already passes through, so an
  // unpaired surrogate cannot reach event id computation from any call site.
  // A correctly paired surrogate - every emoji above the BMP - is unaffected.
  .refine(
    (event) =>
      isWellFormedText(event.content) &&
      event.tags.every((tag) => tag.every(isWellFormedText)),
    {
      message:
        "Event content or tags contain an unpaired surrogate code unit",
    }
  );

// Infer types from schemas
export type UnsignedEventInput = z.infer<typeof UnsignedEventSchema>;

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

/**
 * What `activity.origins` answers. Every origin is the site-filterable kind
 * (http or https): an internal origin such as `extension://profile` appears in
 * the log but could not be sent back as a filter, so listing it would offer a
 * choice that fails. Bounded by the log's own 500-entry ceiling.
 */
export const ActivityOriginsResponseSchema = z.object({
  origins: z.array(OriginSchema).max(500),
});

// Infer types from schemas
export type ActivityGetRecentRequest = z.infer<
  typeof ActivityGetRecentRequestSchema
>;
export type ActivityFilterByRequest = z.infer<
  typeof ActivityFilterByRequestSchema
>;

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
