import { z } from "zod";
import { isAllowedRemoteUrl } from "../profile/types";

/**
 * A server's reply to an upload, checked against what was sent.
 *
 * The reply is a remote party's claim. These checks show it is consistent with
 * the bytes the page uploaded: the same hash, the same size, and an address
 * built on that hash. They do not show that the server stored the blob or will
 * keep serving it.
 */

/** Loose on purpose: servers add fields such as `magnet`, `ipfs` and `nip94`. */
const BlobDescriptorSchema = z.looseObject({
  url: z.string(),
  sha256: z.string(),
  size: z.number().int().nonnegative(),
});

export type DescriptorCheck = { ok: true; url: string } | { ok: false };

export interface ExpectedBlob {
  /** Lowercase hex SHA-256 of the prepared bytes. */
  sha256: string;
  /** Byte length of the prepared bytes. */
  size: number;
}

function pathContainsHash(url: string, sha256: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().includes(sha256);
  } catch {
    return false;
  }
}

export function checkBlobDescriptor(
  body: unknown,
  expected: ExpectedBlob
): DescriptorCheck {
  const parsed = BlobDescriptorSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false };
  }

  const { url, sha256, size } = parsed.data;
  if (
    sha256.toLowerCase() !== expected.sha256 ||
    size !== expected.size ||
    !isAllowedRemoteUrl(url) ||
    !pathContainsHash(url, expected.sha256)
  ) {
    return { ok: false };
  }

  return { ok: true, url };
}
