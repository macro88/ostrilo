import type { Bech32Codec } from "@/application/ports/crypto";
import { CRYPTO_CONSTANTS } from "@/domain/crypto/constants";
import { hexToBytes } from "@/domain/utils/hex";

const HEX_KEY = /^[0-9a-fA-F]{64}$/;
const PREFIXED_HEX_KEY = /^0x[0-9a-fA-F]{64}$/;

/**
 * The one private-key parser in `src/`.
 *
 * There were three. `KeyVaultService.parsePrivateKey` parsed the key on
 * `vault.importKey`; `domain/utils/crypto.parsePrivateKey` parsed the same
 * string a moment earlier for the `crypto.parsePrivateKey` pre-validation the
 * import forms call; and `domain/utils/encoding.parsePrivateKey` sat in the
 * tree with no caller at all. One key-import gesture ran the user's secret
 * through two independently written parsers.
 *
 * This is the vault's version - the one already on the live import path - with
 * its hand-rolled hex loop replaced by the shared codec and `@scure/base`
 * replaced by the `Bech32Codec` port. Its error messages are preserved
 * verbatim, because `vault-rpc` and `crypto-rpc` map them.
 *
 * The returned array holds the user's secret. Callers MUST zeroize it.
 */
export function parsePrivateKey(
  bech32: Bech32Codec,
  input: string
): Uint8Array {
  const trimmed = input.trim();

  if (HEX_KEY.test(trimmed) || PREFIXED_HEX_KEY.test(trimmed)) {
    return hexToBytes(trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed);
  }

  if (trimmed.startsWith(CRYPTO_CONSTANTS.NOSTR_PRIVATE_KEY_PREFIX)) {
    const decoded = bech32.decode(trimmed);
    if (decoded.prefix !== CRYPTO_CONSTANTS.NOSTR_PRIVATE_KEY_PREFIX) {
      throw new Error("invalid_nsec_prefix");
    }
    if (decoded.bytes.length !== CRYPTO_CONSTANTS.KEY_LENGTH) {
      throw new Error("invalid_nsec_length");
    }
    return decoded.bytes;
  }

  throw new Error("invalid_private_key_format");
}
