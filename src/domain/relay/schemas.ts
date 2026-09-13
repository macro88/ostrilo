import { z } from "zod";
import {
  RELAY_BOUNDS,
  RELAY_MESSAGE_TYPES,
  SUBSCRIPTION_ID_PATTERN,
} from "./constants";

/**
 * Schemas for relay-to-client input.
 *
 * These describe what the extension is willing to read, not what NIP-01 permits
 * a relay to send. Anything outside these shapes is discarded at the transport
 * edge before it can reach the application layer.
 */

const byteLength = (value: string): number =>
  new TextEncoder().encode(value).length;

const SubscriptionIdSchema = z.string().regex(SUBSCRIPTION_ID_PATTERN, {
  message: "Invalid subscription id",
});

const HexSchema = (length: number) =>
  z.string().regex(new RegExp(`^[0-9a-f]{${length}}$`), {
    message: `Expected ${length} lowercase hex characters`,
  });

const TagSchema = z
  .array(
    z.string().refine((v) => byteLength(v) <= RELAY_BOUNDS.MAX_TAG_ELEMENT_BYTES, {
      message: "Tag element too large",
    })
  )
  .max(RELAY_BOUNDS.MAX_TAG_ELEMENTS);

/**
 * A NIP-01 event as supplied by a relay, with every relay-controlled field
 * bounded. `created_at` is checked against the clock at parse time so a relay
 * cannot pin an event far into the future to win a "most recent" comparison.
 */
export const RelayEventSchema = z.strictObject({
  id: HexSchema(64),
  pubkey: HexSchema(64),
  created_at: z
    .number()
    .int()
    .positive()
    .refine(
      (value) =>
        value <=
        Math.floor(Date.now() / 1000) + RELAY_BOUNDS.MAX_CREATED_AT_SKEW_SECONDS,
      { message: "created_at is too far in the future" }
    ),
  kind: z.number().int().min(0).max(RELAY_BOUNDS.MAX_EVENT_KIND),
  tags: z.array(TagSchema).max(RELAY_BOUNDS.MAX_EVENT_TAGS),
  content: z
    .string()
    .refine((v) => byteLength(v) <= RELAY_BOUNDS.MAX_EVENT_CONTENT_BYTES, {
      message: "Event content too large",
    }),
  sig: HexSchema(128),
});

export type RelayEvent = z.infer<typeof RelayEventSchema>;

/**
 * The NIP-01 relay-to-client envelope. Tuple schemas are used so an unexpected
 * arity is a validation failure rather than a silently ignored trailing value.
 */
export const RelayMessageSchema = z.union([
  z.tuple([z.literal("EVENT"), SubscriptionIdSchema, RelayEventSchema]),
  z.tuple([z.literal("EOSE"), SubscriptionIdSchema]),
  z.tuple([
    z.literal("OK"),
    HexSchema(64),
    z.boolean(),
    z.string().max(RELAY_BOUNDS.MAX_NOTICE_CHARS).optional(),
  ]),
  z.tuple([z.literal("NOTICE"), z.string()]),
  z.tuple([
    z.literal("CLOSED"),
    SubscriptionIdSchema,
    z.string().max(RELAY_BOUNDS.MAX_NOTICE_CHARS).optional(),
  ]),
  z.tuple([z.literal("AUTH"), z.string().max(RELAY_BOUNDS.MAX_NOTICE_CHARS)]),
]);

export type RelayMessage = z.infer<typeof RelayMessageSchema>;

/**
 * True when `type` is a NIP-01 relay-to-client message type.
 */
export function isRelayMessageType(type: unknown): boolean {
  return (
    typeof type === "string" &&
    (RELAY_MESSAGE_TYPES as readonly string[]).includes(type)
  );
}

/**
 * Truncate relay-supplied diagnostic text before it reaches a log.
 */
export function boundNoticeText(text: unknown): string {
  if (typeof text !== "string") {
    return "";
  }
  return text.slice(0, RELAY_BOUNDS.MAX_NOTICE_CHARS);
}
