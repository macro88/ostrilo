import { z } from "zod";

/**
 * Profile metadata per NIP-01 kind:0 event content.
 * All fields are optional per the specification.
 */
export interface ProfileMetadata {
  name?: string; // Display name
  display_name?: string; // Alternative to 'name'
  about?: string; // Bio/description
  picture?: string; // Avatar URL
  banner?: string; // Header image URL
  website?: string; // Personal website
  nip05?: string; // NIP-05 identifier (user@domain.com)
  lud16?: string; // Lightning address (user@domain.com)
  lud06?: string; // LNURL (deprecated, for backward compatibility)
}

/**
 * Cache entry for storing profile metadata with expiration metadata.
 */
export interface ProfileCacheEntry {
  pubkey: string; // Hex public key
  metadata: ProfileMetadata; // Parsed profile content
  fetchedAt: number; // Epoch seconds when cached
  ttl: number; // Seconds until expiration
  eventId?: string; // Most recent kind:0 event ID
  createdAt?: number; // Event created_at timestamp
}

/**
 * URL validation helper that returns true if the string is a valid URL.
 */
const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

/**
 * Email-like format validation for nip05 and lud16.
 */
const isEmailLike = (value: string): boolean => {
  return /^[^@]+@[^@]+\.[^@]+$/.test(value);
};

/**
 * Zod validation schema for ProfileMetadata with constraints:
 * - name: max 50 characters
 * - about: max 500 characters
 * - URLs: validated with URL constructor
 * - nip05 and lud16: email-like format
 */
export const ProfileMetadataSchema = z
  .looseObject({
    name: z.string().max(50).optional(),
    display_name: z.string().max(50).optional(),
    about: z.string().max(500).optional(),
    picture: z
      .string()
      .refine((url) => isValidUrl(url), {
        message: "Invalid picture URL",
      })
      .optional(),
    banner: z
      .string()
      .refine((url) => isValidUrl(url), {
        message: "Invalid banner URL",
      })
      .optional(),
    website: z
      .string()
      .refine((url) => isValidUrl(url), {
        message: "Invalid website URL",
      })
      .optional(),
    nip05: z
      .string()
      .refine((value) => isEmailLike(value), {
        message: "NIP-05 must be in format user@domain.com",
      })
      .optional(),
    lud16: z
      .string()
      .refine((value) => isEmailLike(value), {
        message: "Lightning address must be in format user@domain.com",
      })
      .optional(),
    lud06: z.string().optional(),
  }); // Allow additional fields from relays

/**
 * Validate profile metadata and return sanitized result.
 * Invalid fields are omitted rather than rejecting the entire profile.
 */
export function validateProfileMetadata(data: unknown): ProfileMetadata | null {
  try {
    const result = ProfileMetadataSchema.safeParse(data);
    if (result.success) {
      return result.data as ProfileMetadata;
    }

    // Partial validation: keep valid fields, omit invalid ones
    if (typeof data === "object" && data !== null) {
      const partial: ProfileMetadata = {};
      const obj = data as Record<string, unknown>;

      // Validate each field individually
      if (typeof obj.name === "string" && obj.name.length <= 50) {
        partial.name = obj.name;
      }
      if (
        typeof obj.display_name === "string" &&
        obj.display_name.length <= 50
      ) {
        partial.display_name = obj.display_name;
      }
      if (typeof obj.about === "string" && obj.about.length <= 500) {
        partial.about = obj.about;
      }
      if (typeof obj.picture === "string" && isValidUrl(obj.picture)) {
        partial.picture = obj.picture;
      }
      if (typeof obj.banner === "string" && isValidUrl(obj.banner)) {
        partial.banner = obj.banner;
      }
      if (typeof obj.website === "string" && isValidUrl(obj.website)) {
        partial.website = obj.website;
      }
      if (typeof obj.nip05 === "string" && isEmailLike(obj.nip05)) {
        partial.nip05 = obj.nip05;
      }
      if (typeof obj.lud16 === "string" && isEmailLike(obj.lud16)) {
        partial.lud16 = obj.lud16;
      }
      if (typeof obj.lud06 === "string") {
        partial.lud06 = obj.lud06;
      }

      return partial;
    }

    return null;
  } catch (error) {
    console.warn("Profile metadata validation failed:", error);
    return null;
  }
}

