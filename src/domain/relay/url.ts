import { z } from "zod";
import { isValidRelayUrl } from "../utils/validation";
import { RELAY_BOUNDS } from "./constants";

/**
 * A single relay URL. Refines through the shared domain validator so the
 * schema layer and the domain validator cannot drift apart: a value that
 * reaches stored settings is a value the relay adapter will accept.
 */
export const RelayUrlSchema = z
  .string()
  .max(RELAY_BOUNDS.MAX_REMOTE_URL_CHARS)
  .refine(isValidRelayUrl, {
    message: "Relay URL must be a wss:// address with no embedded credentials",
  });

/**
 * The configured relay list, bounded so a settings patch cannot open an
 * unbounded number of WebSocket connections in the background worker.
 */
export const RelayUrlListSchema = z
  .array(RelayUrlSchema)
  .max(RELAY_BOUNDS.MAX_CONFIGURED_RELAYS);

/**
 * Drop every relay URL the extension will not connect to, de-duplicate the
 * rest, and bound the result.
 *
 * This is the migration path for settings written before `wss://` was required
 * everywhere: a stored `ws://` entry is simply not returned.
 */
export function sanitizeRelayUrls(relays: unknown): string[] {
  if (!Array.isArray(relays)) {
    return [];
  }

  const accepted = new Set<string>();
  for (const relay of relays) {
    if (typeof relay !== "string") {
      continue;
    }

    const trimmed = relay.trim();
    if (
      trimmed.length <= RELAY_BOUNDS.MAX_REMOTE_URL_CHARS &&
      isValidRelayUrl(trimmed)
    ) {
      accepted.add(trimmed);
    }

    if (accepted.size >= RELAY_BOUNDS.MAX_CONFIGURED_RELAYS) {
      break;
    }
  }

  return Array.from(accepted);
}
