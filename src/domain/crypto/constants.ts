/**
 * Domain constants for Nostr key material.
 *
 * All that survives of `domain/crypto/interfaces.ts`, which also declared a
 * second, incompatible set of `CryptoAead`, `CryptoKdf`, `Schnorr` and
 * `CryptoService` interfaces. Nothing in the repository implemented any of
 * them and nothing imported them - they existed only to be found by a future
 * author and mistaken for the live ports, which are in
 * `src/application/ports/crypto.ts`.
 */
export const CRYPTO_CONSTANTS = {
  NOSTR_PRIVATE_KEY_PREFIX: "nsec",
  NOSTR_PUBLIC_KEY_PREFIX: "npub",
  KEY_LENGTH: 32, // 32 bytes for secp256k1 private keys
  SALT_LENGTH: 16, // 16 bytes for KDF salt
  IV_LENGTH: 12, // 12 bytes for AES-GCM IV
} as const;
