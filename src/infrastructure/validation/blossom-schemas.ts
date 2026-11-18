import { z } from "zod";
import { BLOSSOM_SERVER_IDS } from "@/domain/blossom/servers";
import { HexString32Schema } from "./schemas";

/**
 * What `blossom.authorizeUpload` accepts, and nothing else. Strict, so a request
 * that also carries a kind, tags, content or an expiry is refused instead of
 * having those fields quietly ignored: the background builds the event itself.
 */
export const BlossomAuthorizeUploadParamsSchema = z.strictObject({
  pubkey: HexString32Schema,
  sha256: HexString32Schema,
  serverId: z.enum(BLOSSOM_SERVER_IDS),
});

/**
 * What `blossom.authorizeUpload` returns, checked where the UI receives it:
 * the Nostr scheme and a url-safe, unpadded token, nothing else.
 */
export const BlossomAuthorizeUploadResponseSchema = z.strictObject({
  authorization: z
    .string()
    .max(4096)
    .regex(/^Nostr [A-Za-z0-9_-]+$/, "Not a Nostr authorization header"),
});
