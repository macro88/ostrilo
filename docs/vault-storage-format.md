# Vault storage format

How Ostrilo encrypts private keys at rest, what is stored where, and the rules
that must not be broken when changing it.

Established by the OpenSpec change `harden-vault-key-derivation`.

## The shape

Two keys in `browser.storage.local`.

### `vaultEnvelope`

One per vault.

```jsonc
{
  "v": 1,
  "kdf": {
    "alg": "argon2id",   // or "pbkdf2-sha256"
    "m": 19456,          // KiB   (argon2id)
    "t": 2,              // passes
    "p": 1,              // parallelism
    "salt": [/* 16 bytes */]
  },
  "verifier": { "ct": [/* … */], "iv": [/* 12 bytes */] },
  "createdAt": 1757000000000,
  "updatedAt": 1757000000000
}
```

### `encryptedKeys[]`

One entry per key.

```jsonc
{
  "v": 1,
  "id": "uuid",
  "label": "My Nostr Key",
  "pubkey": "hex x-only pubkey",
  "ct": [/* private key, sealed under the DEK */],
  "iv": [/* 12 bytes */],
  "wrappedDek": { "ct": [/* DEK sealed under the KEK */], "iv": [/* 12 bytes */] },
  "createdAt": 1757000000000,
  "isSelected": true
}
```

A record with **no `v`** is legacy: PBKDF2-HMAC-SHA256 at 100,000 iterations,
a per-record `salt`, no `wrappedDek`, and no AAD.

## Why an envelope

One password-derived **key-encryption key (KEK)** per vault wraps a per-key
**data-encryption key (DEK)**.

Unlock therefore costs exactly **one** KDF run no matter how many keys the
vault holds. The previous design derived once per record, which is precisely
why a memory-hard KDF was unaffordable: a five-key vault would have paid five
times the cost. Measured, Argon2id at the shipping parameters is 611 ms in an
MV3 service worker — fine once, not fine five times.

A second benefit: the `verifier` is a known plaintext sealed under the KEK.
Decrypting it proves the password **before** any per-record work. That is what
lets "wrong password" be distinguished from "damaged record", which the previous
implementation conflated — a corrupt record told the user their password was
wrong.

## Recorded parameters, and the floor

The KDF parameters live in the record, never in code.

This is the whole point of the version field. With parameters implied by a code
constant, raising the work factor means guessing how each existing record was
encrypted, and a wrong guess makes a key unreadable. With them recorded, the
cost can be raised per record, lazily, with no migration risk.

On read, parameters are checked against `KDF_FLOORS` in `src/domain/types.ts`
and **refused** if below it. Without that check, an attacker able to write
extension storage could rewrite the stored cost to something trivially cheap.

## AAD: what binds a ciphertext to its record

AES-GCM is used with additional authenticated data on every operation. Encoder:
`src/domain/crypto/aad.ts`.

Three domain-separated shapes, so a blob sealed for one purpose can never be
accepted for another:

| Domain | Covers |
|---|---|
| `ostrilo/vault-verifier` | version, kdf alg, **every cost field**, salt |
| `ostrilo/vault-dek` | the above, plus key id and pubkey |
| `ostrilo/vault-sk` | version, key id, pubkey |

Rules the encoder must keep, each enforced by a test in
`tests/unit/domain/aad.test.ts`:

1. **Fixed field order, explicit length prefixes.** Not JSON — key order and
   whitespace are not guaranteed stable, and an AAD that changes shape makes
   every existing record undecryptable.
2. **Every KDF cost field is included.** Omitting `m`, `t`, `p` or `c` would let
   an attacker rewrite the work factor with the tag still verifying.
3. **Only immutable, security-relevant fields.** `label`, `isSelected`,
   `createdAt` and `lastUsedAt` are excluded, so renaming a key or selecting a
   different one never requires re-encryption.

## Unlock, in order

The order is the substance, not an implementation detail:

1. Load the envelope. Reject an unknown `v`; reject below-floor parameters.
2. Derive the KEK **once** and decrypt the `verifier`. Only here can
   `incorrect_password` be raised.
3. For each record, in its **own** try/catch: unwrap the DEK, decrypt the key,
   and verify the recovered key actually derives the record's stored `pubkey`.
4. A record that fails any step is reported in `damagedKeyIds`. The others still
   unlock. `unlock` previously used `Promise.all`, so one corrupt record
   rejected the whole vault.
5. Write `isLocked: false` only after step 2 succeeds.

An unlock against a vault with no envelope and no records throws
`vault_not_created`. It previously resolved and marked the session unlocked,
because `Promise.all` over zero records resolves immediately — so an empty vault
opened with any password.

## Legacy migration

Lazy, on unlock, per record, **write-verify-then-delete**:

1. Seal the key into the new format alongside the existing legacy `salt`.
2. Read the new material back and check it derives the stored `pubkey`.
3. Only then drop the legacy `salt`.

If any step fails the record is left exactly as it was. The key stays usable for
the session and migrates on a later unlock. **A migration must never be able to
lose a key.**

The `v: 1` read path is retained permanently. Removing it would strand any vault
that has not been opened since.

## Rules for changing this

- Never write with `deriveLegacyKeyReadOnly`. It exists to read pre-`v:1`
  material and is deliberately not exported as a `CryptoKdf`.
- Never infer parameters from code when reading. Read them from the record.
- Never add a mutable field to the AAD.
- Bump `v` and add to `SUPPORTED_VAULT_VERSIONS` for any format change; never
  silently reinterpret an existing version.
- Static imports only in anything reachable from the background worker.
  `import()` is disallowed on `ServiceWorkerGlobalScope` by the HTML
  specification, so a lazily imported KDF throws at runtime.
