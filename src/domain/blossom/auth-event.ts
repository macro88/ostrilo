import type { SignedEvent } from "../types";
import {
  AUTH_BACKDATE_SECONDS,
  AUTH_TTL_SECONDS,
  UPLOAD_AUTH_CONTENT,
  UPLOAD_AUTH_KIND,
} from "./constants";

/**
 * The BUD-11 authorisation event for an upload, and the header that carries it.
 *
 * The background is the only caller that signs one. It supplies a public key,
 * a blob hash and a server it looked up itself; nothing else about the event
 * comes from the page, so this cannot be used to get any other event signed.
 */

const HEX_64 = /^[0-9a-f]{64}$/;
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

export interface UploadAuthInput {
  pubkey: string;
  /** Lowercase hex SHA-256 of the exact bytes that will be uploaded. */
  sha256: string;
  /** The listed server's lowercase host, with no scheme or path. */
  serverHost: string;
  /** One reading of the clock, in whole seconds. */
  now: number;
}

export interface UnsignedUploadAuth {
  pubkey: string;
  created_at: number;
  kind: typeof UPLOAD_AUTH_KIND;
  tags: string[][];
  content: string;
}

export function buildUploadAuthEvent(input: UploadAuthInput): UnsignedUploadAuth {
  if (!HEX_64.test(input.pubkey)) {
    throw new Error("pubkey must be 64 lowercase hex characters");
  }
  if (!HEX_64.test(input.sha256)) {
    throw new Error("sha256 must be 64 lowercase hex characters");
  }
  if (!HOSTNAME.test(input.serverHost)) {
    throw new Error("serverHost must be a lowercase host name");
  }
  if (!Number.isSafeInteger(input.now)) {
    throw new Error("now must be a whole number of seconds");
  }

  return {
    pubkey: input.pubkey,
    created_at: input.now - AUTH_BACKDATE_SECONDS,
    kind: UPLOAD_AUTH_KIND,
    tags: [
      ["t", "upload"],
      ["x", input.sha256],
      ["server", input.serverHost],
      ["expiration", String(input.now + AUTH_TTL_SECONDS)],
    ],
    content: UPLOAD_AUTH_CONTENT,
  };
}

/** Base64url without padding, as BUD-11 requires for the token. */
export function encodeBase64UrlJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new Error("value is not JSON-serialisable");
  }

  let binary = "";
  for (const byte of new TextEncoder().encode(json)) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function encodeAuthorizationHeader(event: SignedEvent): string {
  return `Nostr ${encodeBase64UrlJson(event)}`;
}
