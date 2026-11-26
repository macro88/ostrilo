/**
 * The numbers the Blossom upload path is built on, defined once so the spec,
 * the tests and the code cannot drift apart.
 */

/** Largest image accepted, for the chosen file and again for the prepared bytes. */
export const BLOSSOM_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Longest edge of a re-encoded still image. */
export const BLOSSOM_MAX_EDGE_PX = 2048;

/** BUD-11 authorisation events are kind 24242. */
export const UPLOAD_AUTH_KIND = 24242;

export const UPLOAD_AUTH_CONTENT = "Upload profile image";

/** How long a token stays valid, counted from the clock reading it was built at. */
export const AUTH_TTL_SECONDS = 300;

/**
 * How far `created_at` sits in the past. BUD-11 requires it earlier than the
 * server's clock. At least one host also refuses a token about a minute old,
 * so the margin is small: it covers a user clock a few seconds fast without
 * approaching a freshness window.
 */
export const AUTH_BACKDATE_SECONDS = 10;

export const UPLOAD_TIMEOUT_MS = 60_000;

/** The most of a server's reply the page will read. */
export const MAX_REPLY_BYTES = 16 * 1024;

/** The most of a file the header inspection may read before the user consents. */
export const INSPECT_MAX_BYTES = 4 * 1024;

/** Chunk headers walked in a PNG while looking for animation, before it is refused. */
export const PNG_CHUNK_WALK_MAX = 256;
