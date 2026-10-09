# Vault storage format

How Ostrilo encrypts private keys at rest, what is stored where, and the rules
that must not be broken when changing it.

Established by the OpenSpec change `harden-vault-key-derivation`.

## The shape

Two keys in `browser.storage.local`, plus a third, `vaultRotation`, that exists
only while a password change is being committed (see
[Password change](#password-change)). A fourth, `keyBackupStatus`, sits beside
the vault and is not part of it (see [below](#keybackupstatus-not-part-of-the-vault)).

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

### `keyBackupStatus`: not part of the vault

A separate item, owned by `KeyBackupStatusService`, that records whether each key
has a verified backup. It is deliberately outside the envelope and the key
records: it holds no secret, it changes without the vault password, and writing
it never rewrites a key.

```jsonc
{
  "__version": "keyBackup.v1",
  "keys": { "<key id>": { "state": "pending" | "verified", "at": 1757000000000 } }
}
```

The vault writes `pending` when it generates a key, before the key record is
stored, and drops the entry when it deletes the key. The only write the UI has is
`verified`, through `backup.markVerified`. An imported key and a key that
predates the record have no entry, and read as unknown. The reader drops any
entry that is malformed or whose key is not a key id, so a damaged record reads
as "unknown" and never as an error.

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

On read, parameters are checked against `KDF_FLOORS` and `KDF_CEILINGS` in
`src/domain/types.ts` and **refused**, before any derivation, if outside them.
Without the floor, an attacker able to write extension storage could rewrite the
stored cost to something trivially cheap; without the ceiling, to something that
stalls or crashes the worker on every unlock (`kdf_above_ceiling`).

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

## Password change

`vault.changePassword` rotates the KEK, not the keys:

1. Open the envelope with the current password (through the shared unlock
   throttle), giving the old KEK.
2. Refuse, with nothing written, if any record is legacy
   (`vault_migration_pending`) or does not open and match its pubkey under the
   old KEK (`vault_records_damaged`, naming the ids).
3. Derive a new KEK under a fresh salt and the current `KDF_DEFAULTS`, which
   also upgrades a vault on an older work factor, and seal a new verifier.
4. Re-wrap every record's DEK under the new KEK with a fresh IV and
   `ostrilo/vault-dek` AAD bound to the new parameters, then open each candidate
   and check its pubkey before anything is written. `ct` and `iv` are carried
   over byte for byte: `ostrilo/vault-sk` does not bind the KDF.
5. Commit through the journal, then zeroize both KEKs.

### `vaultRotation`: the commit journal

The envelope and the records are separate items, and neither browser documents
a multi-key write as atomic. So the commit is:

1. Write `vaultRotation = { from: { envelope, records }, to: { envelope, records } }`
   as **one** item - single-item writes are atomic.
2. Write `vaultEnvelope = to.envelope`.
3. Write `encryptedKeys = to.records`.
4. Remove `vaultRotation`. Success is reported only after this.

Every contents field is ciphertext under a password-derived KEK, exactly as in
the live items. The journal lives only between steps 1 and 4.

**Recovery.** `unlock`, `verifyPassword`, `changePassword` and adding a key all
check for a journal first. If the typed password opens `to.envelope`, the whole
`to` state is written and the journal removed (roll forward: the new password is
a credential the user chose, and the rotation was otherwise complete). If it opens
`from.envelope`, the whole `from` state is written (roll back: the user was never
told the change succeeded). Otherwise nothing happens and unlock reports
`incorrect_password`. Writing whole states makes recovery correct whichever live
write was interrupted, and idempotent if recovery itself is interrupted. A
journal that does not parse is ignored. `tests/security/password-rotation-durability.test.ts`
injects a fault at every commit and recovery write.

All vault writes - generate, import, rename, select, delete, unlock (which can
migrate and recover) and password change - run one at a time behind an in-memory
lock in `KeyVaultService`, so no record is sealed under a KEK a concurrent
rotation is replacing. The background worker is the only writer.

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
