/**
 * Named bounds for everything a Nostr relay controls.
 *
 * A relay is an untrusted remote party. Every quantity it can influence -
 * frame size, event count, field length, reconnection lifetime - gets an
 * explicit numeric ceiling here rather than a literal scattered through the
 * adapter, so the whole budget can be read and audited in one place.
 */
export const RELAY_BOUNDS = {
  /** Largest raw WebSocket frame accepted, checked before `JSON.parse`. */
  MAX_FRAME_BYTES: 131072,

  /** Events accepted from a single subscription before it is closed. */
  MAX_EVENTS_PER_SUBSCRIPTION: 20,

  /** Largest `content` string on a relay-supplied event. */
  MAX_EVENT_CONTENT_BYTES: 8192,

  /** Largest number of tag arrays on a relay-supplied event. */
  MAX_EVENT_TAGS: 50,

  /** Largest number of elements within a single tag array. */
  MAX_TAG_ELEMENTS: 10,

  /** Largest single tag element. */
  MAX_TAG_ELEMENT_BYTES: 1024,

  /** How far into the future a relay may claim an event was created. */
  MAX_CREATED_AT_SKEW_SECONDS: 900,

  /** Largest NIP-01 event kind. */
  MAX_EVENT_KIND: 65535,

  /** Relay `NOTICE` text retained for diagnostics. */
  MAX_NOTICE_CHARS: 200,

  /** Largest URL the extension will retain from remote-supplied metadata. */
  MAX_REMOTE_URL_CHARS: 512,

  /** Largest validated profile metadata record, serialised. */
  MAX_METADATA_BYTES: 4096,

  /** Entries retained in the profile cache. */
  MAX_CACHE_ENTRIES: 50,

  /** Serialised size of the whole profile cache. */
  MAX_CACHE_BYTES: 262144,

  /** Relay URLs the extension will connect to at once. */
  MAX_CONFIGURED_RELAYS: 10,

  /** Deadline for a single profile fetch, in milliseconds. */
  FETCH_DEADLINE_MS: 5000,

  /** Consecutive failed reconnect attempts before the adapter gives up. */
  MAX_RECONNECT_ATTEMPTS: 5,

  /** Base reconnect backoff, in milliseconds. */
  RECONNECT_BASE_DELAY_MS: 1000,

  /** Ceiling on reconnect backoff before jitter, in milliseconds. */
  RECONNECT_MAX_DELAY_MS: 30000,

  /** Fraction of the backoff delay added as randomised jitter. */
  RECONNECT_JITTER_RATIO: 0.2,
} as const;

/**
 * Relay-to-client message types defined by NIP-01. Anything else is discarded.
 */
export const RELAY_MESSAGE_TYPES = [
  "EVENT",
  "EOSE",
  "OK",
  "NOTICE",
  "CLOSED",
  "AUTH",
] as const;

export type RelayMessageType = (typeof RELAY_MESSAGE_TYPES)[number];

/** Subscription IDs the extension will accept from a relay. */
export const SUBSCRIPTION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
