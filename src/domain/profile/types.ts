import { z } from "zod";
import { RELAY_BOUNDS } from "@/domain/relay/constants";

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

/** Field length bounds for profile metadata. */
export const PROFILE_FIELD_BOUNDS = {
  NAME: 50,
  DISPLAY_NAME: 50,
  ABOUT: 500,
  URL: RELAY_BOUNDS.MAX_REMOTE_URL_CHARS,
  NIP05: 254,
  LUD16: 254,
  LUD06: 512,
} as const;

/**
 * URL fields ordered by how readily they are dropped when metadata exceeds the
 * serialised ceiling. Largest and least load-bearing first.
 */
const SHEDDABLE_FIELDS: (keyof ProfileMetadata)[] = [
  "banner",
  "lud06",
  "about",
  "picture",
  "website",
  "nip05",
  "lud16",
  "display_name",
];

/**
 * Accept a URL supplied by a remote party only when it is `https:`.
 *
 * A bare `new URL()` parse constrains nothing about the scheme, which is how
 * `http:`, `data:` and `javascript:` values previously survived validation and
 * reached an extension page. The scheme is the whole check here; the length
 * bound keeps a relay from parking kilobytes in a URL field.
 */
export function isAllowedRemoteUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length > PROFILE_FIELD_BOUNDS.URL) {
    return false;
  }

  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Email-like format validation for nip05 and lud16.
 */
const isEmailLike = (value: string): boolean => {
  return /^[^@]+@[^@]+\.[^@]+$/.test(value);
};

const RemoteUrlSchema = z
  .string()
  .max(PROFILE_FIELD_BOUNDS.URL)
  .refine(isAllowedRemoteUrl, {
    message: "URL must use the https: scheme",
  });

/**
 * Zod validation schema for ProfileMetadata.
 *
 * Strict rather than loose: kind:0 content is chosen by a relay, and an unknown
 * key is an attacker-chosen key in a record the UI iterates over and the cache
 * persists. Adding a field when a NIP warrants it is a one-line change; keeping
 * arbitrary keys is a standing liability.
 */
export const ProfileMetadataSchema = z.strictObject({
  name: z.string().max(PROFILE_FIELD_BOUNDS.NAME).optional(),
  display_name: z.string().max(PROFILE_FIELD_BOUNDS.DISPLAY_NAME).optional(),
  about: z.string().max(PROFILE_FIELD_BOUNDS.ABOUT).optional(),
  picture: RemoteUrlSchema.optional(),
  banner: RemoteUrlSchema.optional(),
  website: RemoteUrlSchema.optional(),
  nip05: z
    .string()
    .max(PROFILE_FIELD_BOUNDS.NIP05)
    .refine((value) => isEmailLike(value), {
      message: "NIP-05 must be in format user@domain.com",
    })
    .optional(),
  lud16: z
    .string()
    .max(PROFILE_FIELD_BOUNDS.LUD16)
    .refine((value) => isEmailLike(value), {
      message: "Lightning address must be in format user@domain.com",
    })
    .optional(),
  lud06: z.string().max(PROFILE_FIELD_BOUNDS.LUD06).optional(),
});

/**
 * Outcome of validating profile metadata, including what was thrown away.
 *
 * A dropped field is reported rather than swallowed so the profile editor can
 * tell the user which value did not survive - a user whose avatar is on a plain
 * `http:` host should see why it disappeared, not just that it did.
 */
export interface ProfileValidationResult {
  metadata: ProfileMetadata | null;
  rejectedFields: string[];
}

/**
 * Validate profile metadata, reporting the fields that were dropped.
 * Invalid fields are omitted rather than rejecting the entire profile.
 */
export function validateProfileMetadataDetailed(
  data: unknown
): ProfileValidationResult {
  try {
    const result = ProfileMetadataSchema.safeParse(data);
    if (result.success) {
      return { metadata: result.data as ProfileMetadata, rejectedFields: [] };
    }

    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return { metadata: null, rejectedFields: [] };
    }

    // Partial validation: keep valid fields, omit invalid ones.
    const partial: ProfileMetadata = {};
    const rejected = new Set<string>();
    const obj = data as Record<string, unknown>;

    const keepString = (
      key: "name" | "display_name" | "about" | "lud06",
      max: number
    ) => {
      if (obj[key] === undefined) return;
      if (typeof obj[key] === "string" && (obj[key] as string).length <= max) {
        partial[key] = obj[key] as string;
      } else {
        rejected.add(key);
      }
    };

    const keepUrl = (key: "picture" | "banner" | "website") => {
      if (obj[key] === undefined) return;
      if (isAllowedRemoteUrl(obj[key])) {
        partial[key] = obj[key] as string;
      } else {
        rejected.add(key);
      }
    };

    const keepEmailLike = (key: "nip05" | "lud16", max: number) => {
      if (obj[key] === undefined) return;
      if (
        typeof obj[key] === "string" &&
        (obj[key] as string).length <= max &&
        isEmailLike(obj[key] as string)
      ) {
        partial[key] = obj[key] as string;
      } else {
        rejected.add(key);
      }
    };

    keepString("name", PROFILE_FIELD_BOUNDS.NAME);
    keepString("display_name", PROFILE_FIELD_BOUNDS.DISPLAY_NAME);
    keepString("about", PROFILE_FIELD_BOUNDS.ABOUT);
    keepUrl("picture");
    keepUrl("banner");
    keepUrl("website");
    keepEmailLike("nip05", PROFILE_FIELD_BOUNDS.NIP05);
    keepEmailLike("lud16", PROFILE_FIELD_BOUNDS.LUD16);
    keepString("lud06", PROFILE_FIELD_BOUNDS.LUD06);

    // Anything the schema does not define is a relay-chosen key. Record it as
    // rejected so the drop is visible, but never carry the value forward.
    for (const key of Object.keys(obj)) {
      if (!(key in ProfileMetadataSchema.shape)) {
        rejected.add(key);
      }
    }

    return { metadata: partial, rejectedFields: Array.from(rejected) };
  } catch (error) {
    console.warn(
      "Profile metadata validation failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { metadata: null, rejectedFields: [] };
  }
}

/**
 * Validate profile metadata and return sanitized result.
 * Invalid fields are omitted rather than rejecting the entire profile.
 */
export function validateProfileMetadata(data: unknown): ProfileMetadata | null {
  return validateProfileMetadataDetailed(data).metadata;
}

/**
 * Serialised byte size of a metadata record.
 */
export function profileMetadataByteSize(metadata: ProfileMetadata): number {
  return new TextEncoder().encode(JSON.stringify(metadata)).length;
}

/**
 * Reduce metadata to the serialised ceiling by shedding optional fields.
 *
 * The alternative - caching whatever the relay sent - puts a relay in control
 * of how much of the extension's storage budget it consumes. Fields are shed in
 * a fixed order, largest and least identity-bearing first, so `name` survives
 * to the last: the point of a cached profile is telling identities apart.
 */
export function boundProfileMetadata(metadata: ProfileMetadata): {
  metadata: ProfileMetadata;
  droppedFields: string[];
} {
  const bounded: ProfileMetadata = { ...metadata };
  const dropped: string[] = [];

  for (const field of SHEDDABLE_FIELDS) {
    if (profileMetadataByteSize(bounded) <= RELAY_BOUNDS.MAX_METADATA_BYTES) {
      break;
    }
    if (bounded[field] !== undefined) {
      delete bounded[field];
      dropped.push(field);
    }
  }

  // `name` is shed last and only if it alone still breaks the ceiling.
  if (
    profileMetadataByteSize(bounded) > RELAY_BOUNDS.MAX_METADATA_BYTES &&
    bounded.name !== undefined
  ) {
    delete bounded.name;
    dropped.push("name");
  }

  return { metadata: bounded, droppedFields: dropped };
}
