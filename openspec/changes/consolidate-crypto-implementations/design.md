## Context

Ostrilo already has the structure this change needs. `src/application/ports/crypto.ts` declares `CryptoAead`, `CryptoKdf` and `Schnorr`; `src/infrastructure/crypto/adapters.ts` implements them as `WebCryptoAesGcm`, `NoblePbkdf2` and `NobleSchnorr`; `src/extension/background.ts:209-214` injects those three into `KeyVaultService`. That is a correct hexagon, and `docs/development-standards.md` states the rule it embodies: domain holds pure rules, application holds services and ports, infrastructure holds adapters, and cross-layer dependencies point inward through ports.

The problem is that a second, older set of crypto lives beside it and nothing prevents either set from being used. `src/domain/utils/crypto.ts` is a 489-line module that predates the ports. It carries its own key generation, its own PBKDF2, its own AES-GCM, its own bech32, its own Schnorr signing and its own hex codec, and it imports `@noble/curves`, `@noble/hashes` and `@scure/base` directly from inside the domain layer. `src/domain/utils/encoding.ts` carries a third overlapping set. `src/domain/crypto/interfaces.ts` declares a fourth, incompatible set of `CryptoAead`, `CryptoKdf`, `Schnorr` and `CryptoService` interfaces that nothing in the repository implements; only its `CRYPTO_CONSTANTS` export is consumed, by `src/domain/utils/encoding.ts:7` and `src/domain/utils/validation.ts:6`.

The measured extent of the duplication:

- **Private-key parsing: three implementations.** `src/domain/utils/crypto.ts:160`, `src/domain/utils/encoding.ts:43`, and the private `KeyVaultService.parsePrivateKey` at `src/application/services/key-vault.service.ts:53`.
- **Hex decoding: nine call sites across three files.** `key-vault.service.ts:61` and `:396`; `domain/utils/crypto.ts:151`, `:427`, `:456`, `:461`, `:466`, `:481`; `domain/utils/encoding.ts:74`. Four of the live ones apply no character validation at all.
- **Hex encoding: six call sites across three files.** `key-vault.service.ts:49` and `:402`; `domain/utils/crypto.ts:94`, `:409`, `:435`; `domain/utils/encoding.ts:84`.
- **bech32: three files import `@scure/base` directly** — `domain/utils/crypto.ts:15`, `domain/utils/encoding.ts:6`, `application/services/key-vault.service.ts:9` — and the two npub encoders disagree on the length limit, `bech32.encode(prefix, words)` at `encoding.ts:14` against `bech32.encode(prefix, words, 5000)` at `crypto.ts:484`.
- **KDF and AEAD: two implementations each.** `deriveKeyFromPassword` (`crypto.ts:178`), `encryptPrivateKey` (`:198`) and `decryptPrivateKey` (`:256`) against `NoblePbkdf2` and `WebCryptoAesGcm`.
- **Key generation: two implementations that already differ.** `generatePrivateKey` at `crypto.ts:50` uses Noble's `randomBytes(32)`; `KeyVaultService.generateKey` at `key-vault.service.ts:135` uses `crypto.getRandomValues(new Uint8Array(32))`. Both are sound CSPRNGs. This is drift, not a vulnerability, and should not be written up as one.
- **Schnorr signing: two call sites inside one service, one of which bypasses the port.** `KeyVaultService.sign` (`:400`) signs through the injected `this.schnorr.sign`. `KeyVaultService.signEvent` (`:445`) signs through `signEventHash`, which reaches `schnorr.sign` from `@noble/curves` directly inside `domain/utils/crypto.ts:431`. The same class signs two different ways, and only one of them is substitutable in a test.

Two constraints shape the design. First, `harden-vault-key-derivation` is rewriting the live KDF, the AES-GCM call and the vault record format in `src/infrastructure/crypto/adapters.ts` and `src/application/services/key-vault.service.ts` — the same two files this change touches most. Second, `restore-security-test-assurance` is vendoring the official BIP-340 and NIP-01 known-answer vectors. Without those vectors, a refactor of signing code is plausible but not provable, and "plausible" is not an acceptable standard for the part of the product that makes signatures.

## Goals / Non-Goals

**Goals:**

- Exactly one implementation of each cryptographic primitive, reached only through the ports in `src/application/ports/crypto.ts`.
- Delete every duplicate, with a stated proof that each deleted symbol has no caller in `src/`.
- Confine `@noble/*` and `@scure/*` to the adapter layer, consistent with `docs/development-standards.md`.
- One hex codec that rejects malformed input by throwing, replacing the silent-zero decoder and the four unguarded decoders.
- Make unpaired surrogates unreachable from event id computation by rejecting them at the validation boundary.
- Make the duplication non-recurring through a lint boundary and a single-implementation test, not through a convention nobody can enforce.
- Preserve every value the extension produces, proven by known-answer vectors rather than asserted.

**Non-Goals:**

- No algorithm change. Argon2id, iteration counts, native WebCrypto PBKDF2, AAD binding, the KEK/DEK envelope and the versioned vault record belong to `harden-vault-key-derivation`.
- No change to what `crypto.parsePrivateKey` returns. Replacing the raw secret-key byte array with a validation-only result belongs to `remove-key-exfiltration-surface`.
- No new test vectors authored here. This change consumes the vectors `restore-security-test-assurance` vendors.
- No storage migration, no new RPC method, no approval-flow change, no policy change, no UI redesign.
- No move of crypto into a Web Worker and no WebAuthn work.

## Decisions

### Decision 1: The ports are the single source of truth, and they gain two members

Every primitive is reached through `src/application/ports/crypto.ts`. That file grows from three interfaces to five, and one existing interface gains a method:

- `CryptoAead` — unchanged in this change.
- `CryptoKdf` — unchanged in this change. `harden-vault-key-derivation` reshapes it; see Decision 7.
- `Schnorr` — gains `verify(signature, hash32, publicKey): Promise<boolean> | boolean`. It is the one operation the live port lacks, the dead `src/domain/crypto/interfaces.ts:44` already declares it, and the interop vector tests need it to check Ostrilo's own signatures without importing `@noble/curves` into a test that is supposed to be testing production code.
- `CryptoHash` (new) — `sha256(data: Uint8Array): Uint8Array`. Required so event id computation stops importing `@noble/hashes` from the domain layer.
- `Bech32Codec` (new) — `encode(prefix, bytes): string` and `decode(encoded): { prefix, bytes }`. Required so nsec/npub handling stops importing `@scure/base` from the domain and application layers, and so the two disagreeing length limits collapse to one.

`src/infrastructure/crypto/adapters.ts` gains `NobleSha256` and `ScureBech32` beside the existing three, and `NobleSchnorr` gains `verify`. `background.ts` injects the two new adapters into `KeyVaultService`.

**Rationale:** The ports already exist and already work. Adding two members is a smaller and more reviewable step than inventing a new abstraction, and it makes the lint rule in Decision 6 satisfiable — a layer cannot be forbidden from importing a crypto library unless there is a port that gives it the same capability.

**Alternative considered:** Keep a single fat `CryptoService` port, as `src/domain/crypto/interfaces.ts:51` sketches. Rejected: that interface mixes key generation, derivation, encryption, signing and zeroization into one dependency, so every consumer takes a dependency on operations it does not use, and a test double for one method must stub eight. The existing narrow ports are the better pattern and are already wired.

### Decision 2: The deletion list, with the proof for each entry

The deletion criterion is: **a cryptographic export is deleted if it has no caller in `src/`.** Test references do not save a symbol; see Decision 8.

From `src/domain/utils/crypto.ts`:

| Symbol | Line | Proof there is no live caller |
| --- | --- | --- |
| `generatePrivateKey` | 50 | No module in `src/` imports it. The only other occurrence of the name is the declaration at `src/domain/crypto/interfaces.ts:53`, in an interface nothing implements. Live generation is `key-vault.service.ts:135`. |
| `getPublicKey` | 57 | No module in `src/` imports it. Live derivation is `NobleSchnorr.getPublicKey` (`adapters.ts:62`), called at `key-vault.service.ts:137` and `:187`. |
| `generateKeyPair` | 64 | No module in `src/` imports it. Only other occurrence is `interfaces.ts:54`. |
| `privateKeyToBech32` | 74 | No module in `src/` imports it. `exportKey` and `revealKey` build nsec inline at `key-vault.service.ts:461-462` and `:506-507`. |
| `publicKeyToBech32` | 81 | No module in `src/` imports it. `KeyManagerContext.tsx:25` imports the `encoding.ts` version, not this one. |
| `publicKeyToHex` | 90 | Imported at `nostr-rpc.ts:17` and never referenced in the file body — the import specifier is the only occurrence of the identifier in that module. |
| `parsePrivateKeyFromBech32` | 101 | No module in `src/` imports it. Sole caller is line 164 of the same file. |
| `parsePrivateKeyFromHex` | 133 | No module in `src/` imports it. Sole caller is line 166 of the same file. |
| `deriveKeyFromPassword` | 178 | No module in `src/` imports it. Sole callers are lines 207 and 266 of the same file. Live KDF is `NoblePbkdf2`, injected at `background.ts:212`. |
| `encryptPrivateKey` | 198 | No module in `src/` imports it. Other occurrences of the name are `KeyVaultService`'s own private method (`key-vault.service.ts:75`) and `interfaces.ts:58`. |
| `decryptPrivateKey` | 256 | No module in `src/` imports it. Only other occurrence is `interfaces.ts:59`. |
| `signHash` | 303 | No module in `src/` imports it. The `signHash` at `client.ts:169` is an unrelated RPC wrapper for `vault.sign`. |
| `createHash` | 322 | No occurrence of the identifier anywhere outside the file. |
| `verifySignature` | 329 | No occurrence of the identifier anywhere outside the file. |
| `isWebAuthnAvailable` | 346 | No occurrence outside the file except its own caller at line 358. No WebAuthn feature exists. |
| `isPlatformAuthenticatorAvailable` | 357 | No occurrence of the identifier anywhere outside the file. |
| `verifyEventSignature` | 447 | No occurrence in `src/`. Replaced by `Schnorr.verify` on the port (Decision 1). |
| `EncryptedKey`, `KeyPair` types | 25, 31 | No module in `src/` imports either from this file. The same two names are re-declared at `interfaces.ts:7` and `:13`. |

From `src/domain/utils/encoding.ts`: `parsePrivateKey` (line 43), `bytesToBech32` (12), `bech32ToBytes` (20), `privateKeyToBech32` (36), `isValidBech32` (101) — none is imported by any module in `src/`; `bytesToBech32` and `bech32ToBytes` are called only from inside the same file. `hexToBytes` (67), `bytesToHex` (82), `isValidHex` (91) and `publicKeyToBech32` (29) survive in relocated form, per Decisions 3 and 4.

From `src/domain/crypto/interfaces.ts`: the `CryptoAead`, `CryptoKdf`, `Schnorr` and `CryptoService` interfaces and the `EncryptedKey` and `KeyPair` types are all unimplemented and unimported; only `CRYPTO_CONSTANTS` survives, so the file is reduced to a constants module.

Also removed: the unused `signEventHash` and `publicKeyToHex` imports at `nostr-rpc.ts:16-17`, and the deprecated `String.prototype.substr` calls at `crypto.ts:151`, `:427`, `:456`, `:461`, `:466` and `encoding.ts:74`, which disappear with the code that contains them.

Three symbols in `src/domain/utils/crypto.ts` **are** live and must survive relocation rather than deletion: `zeroize` (18 call sites in `key-vault.service.ts`), `computeEventId` (`key-vault.service.ts:436`, `nostr-rpc.ts:207` and `:275`), `signEventHash` (`key-vault.service.ts:445`), plus `hexToNpub` (`ProfileView.tsx:37`). Decision 3 says where each goes.

**Rationale:** Enumerating the proof, rather than trusting a global search, is the point. Each row is a claim a reviewer can check with one grep, and the rows are what make the deletion safe to approve.

**Alternative considered:** Deprecate rather than delete — mark the duplicates `@deprecated` and remove them later. Rejected: a deprecated export is still an importable second implementation, and the JSDoc tag is invisible to the next author who autocompletes `encryptPrivateKey`. The whole premise of this change is that reachable duplicate crypto is the defect.

### Decision 3: What stays pure, and where each survivor lands

The split follows the rule already documented in `docs/development-standards.md`: domain is pure, infrastructure owns technology.

**Domain — no `@noble/*`, no `@scure/*`, no browser API:**

- `src/domain/utils/hex.ts` (new) — `bytesToHex`, `hexToBytes`, `isValidHex`, and an `assertHexBytes(input, byteLength)` guard. Pure string and byte arithmetic. This is the single hex codec of Decision 4.
- `src/domain/nostr/event-serialization.ts` (new) — `serializeEventForId(pubkey, created_at, kind, tags, content): string`. Returns the NIP-01 pre-image and does nothing else. No hashing, no hex, no library.
- `src/domain/utils/memory.ts` (new) — `zeroize`, moved unchanged from `crypto.ts:40`. Already pure; it only needs a home that is not a crypto grab-bag.
- `src/domain/crypto/constants.ts` — `CRYPTO_CONSTANTS`, all that remains of `interfaces.ts`.
- `src/domain/utils/validation.ts` — unchanged.

**Application — ports and orchestration, no crypto library:**

- `src/application/ports/crypto.ts` — the five ports of Decision 1.
- `src/application/crypto/event-id.ts` (new) — `computeEventId(hash: CryptoHash, event): string`, composing `serializeEventForId`, `hash.sha256` and `bytesToHex`. The hash port arrives as the first argument rather than through a class, because both `KeyVaultService` and `NostrRpcHandler` need it and neither should own it.
- `src/application/crypto/private-key.ts` (new) — `parsePrivateKey(bech32: Bech32Codec, input: string): Uint8Array`. The one surviving parser, built from `KeyVaultService.parsePrivateKey` (`key-vault.service.ts:53`), which is the version already on the live import path and already applies `^[0-9a-fA-F]{64}$` before decoding. `KeyVaultService.importKey` and the `crypto-rpc.ts` handler both call it.
- `KeyVaultService` — loses its private `parsePrivateKey`, its private `toHex` (line 47), the inline hex decode in `sign` (`:395-397`), and the inline bech32 in `exportKey` and `revealKey`. `signEvent` (`:415`) calls `this.sign(eventId)` instead of `signEventHash`, which collapses the two Schnorr call sites in the class to one and puts event signing behind the injected port where a test can substitute it.

**Infrastructure — the only place `@noble/*` and `@scure/*` appear:**

- `src/infrastructure/crypto/adapters.ts` — `WebCryptoAesGcm`, `NoblePbkdf2`, `NobleSchnorr` (with `verify`), `NobleSha256` (new), `ScureBech32` (new).

**UI — no crypto import at all.** This is the one place the strict boundary costs something. `KeyManagerContext.tsx:112` and `:136` currently call `publicKeyToBech32(hexToBytes(key.pubkey))`, and `ProfileView.tsx:37` calls `hexToNpub(selectedPubkey)`. Both are display formatting of a public value, but both reach `@scure/base` from a React module. The resolution is that the background supplies the encoded value: the key-list response projection gains an additive `npub` field derived through `ScureBech32`, and the selected-key state carries the same. The UI renders a string.

That has a second benefit, which is why it is the recommended option rather than a reluctant one: the two `hexToBytes(key.pubkey)` calls in `KeyManagerContext` are exactly the silent-zero call sites of Decision 4. Moving the encoding into the background removes the hazard and the boundary violation with one edit, and takes cryptographic work out of a React context where an exception is awkward to handle.

`hexToNpub` also needs its error handling corrected on the way. Today it decodes hex with `hex.match(/.{1,2}/g)!` and a non-null assertion, catches everything, logs with `console.error`, and returns the input hex as a "fallback" (`crypto.ts:478-489`). Silently returning a hex string where an npub was requested is the same class of defect as the silent-zero decoder: the caller cannot tell success from failure. The surviving path validates first and propagates the error.

**Alternative considered:** allow `@scure/base` in one allowlisted domain module and let the UI keep encoding. Cheaper — no response field, no state change — and defensible on the grounds that bech32 is a pure encoding with no secret-dependent behaviour. Rejected because an allowlist with one entry becomes an allowlist with four, and because it leaves the `hexToBytes(key.pubkey)` hazard in place. The stricter rule is the one that holds.

### Decision 4: One hex codec that fails loudly, plus a full caller audit

`hexToBytes` at `src/domain/utils/encoding.ts:67-77` checks only `hex.length % 2 !== 0`. It never validates characters, so `parseInt("zz", 16)` returns `NaN`, and assigning `NaN` into a `Uint8Array` stores `0`. Verified: `hexToBytes("zz".repeat(32))` returns 32 zero bytes and throws nothing; `hexToBytes("gg")` returns `[0]`.

The replacement in `src/domain/utils/hex.ts` validates before decoding, in the same shape the correct paths in this repo already use — `parsePrivateKeyFromHex` (`crypto.ts:145`), `KeyVaultService.parsePrivateKey` (`:56`), `HexString32Schema` (`schemas.ts:128`) and `isValidPublicKeyHex` (`validation.ts:97`) all test `^[0-9a-fA-F]{64}$` or equivalent first. It rejects odd length, rejects any non-hex character, and never returns a partial result.

Audit of every hex decode site and what happens to it:

| Site | Status today | Disposition |
| --- | --- | --- |
| `encoding.ts:74` (`hexToBytes`) | Live via `KeyManagerContext.tsx:112`, `:136`. Length-only guard; silently substitutes zeros. | Replaced by the hardened codec. Both call sites are removed by Decision 3, so no caller is left depending on silent zeros. |
| `crypto.ts:151` (`parsePrivateKeyFromHex`) | Live via `crypto-rpc.ts:62`. Correctly guarded, but uses `substr`. | Deleted; behaviour preserved in the surviving `parsePrivateKey`. |
| `crypto.ts:427` (`signEventHash`) | Live via `key-vault.service.ts:445`. No character validation, `substr`. | Deleted. `signEvent` routes through `KeyVaultService.sign`, which decodes with the hardened codec and keeps its existing 32-byte length check. |
| `crypto.ts:481` (`hexToNpub`) | Live via `ProfileView.tsx:37`. No validation, non-null assertion, swallows errors, returns hex on failure. | Deleted; replaced by the background-side `ScureBech32` path, which validates and propagates. |
| `crypto.ts:456`, `:461`, `:466` (`verifyEventSignature`) | Dead. No validation, `substr`, three separate loops. | Deleted with the function. |
| `key-vault.service.ts:61` (`parsePrivateKey`) | Live via `importKey`. Correctly guarded by `^[0-9a-fA-F]{64}$`. | Behaviour preserved; the loop is replaced by a call to the shared codec. |
| `key-vault.service.ts:396` (`sign`) | Live via `nostr.signEvent`. No character validation; a malformed pair becomes `0`, but the following `bytes.length !== 32` check catches truncation only, not corruption. | Hardened. `hashHex` is validated as 64-character hex before decoding. `HashHexSchema` (`schemas.ts:90`) already expresses this constraint at the RPC boundary; the service now enforces it too. |

Hex encoding collapses the same way: `bytesToHex` in `src/domain/utils/hex.ts` replaces the six sites at `crypto.ts:94`, `:409`, `:435`, `encoding.ts:84`, `key-vault.service.ts:49` and `:402`, all of which are byte-for-byte the same `toString(16).padStart(2, "0")` expression.

One existing test needs calling out, because it looks like coverage and is not: `expect(() => hexToBytes("invalid")).toThrow()` at `tests/unit/domain/utils.test.ts:124` (and its twin at `domain-utils.test.ts:124`) passes only because `"invalid"` has seven characters and trips the odd-length branch. No existing test passes even-length non-hex input. The new suite must, and the vector in the spec is the 64-character all-`z` string that today returns 32 zero bytes.

**Rationale:** A decoder that turns bad input into plausible-looking output is worse than one that crashes, because the corruption travels. In a signer, a pubkey silently decoding to 32 zero bytes produces a real, well-formed npub for a key nobody holds.

**Alternative considered:** Return `null` or a result object instead of throwing. Rejected: every current caller is written for the throwing style, `parsePrivateKey` already throws, and a nullable return would let a caller ignore the failure with `?? new Uint8Array(32)` — reintroducing the zero-substitution defect at the call site instead of inside the codec.

### Decision 5: Keep `JSON.stringify`, and reject unpaired surrogates at the validation boundary

`computeEventId` (`crypto.ts:385-411`) builds the pre-image with `JSON.stringify`. NIP-01 requires escaping only line break, double quote, backslash, carriage return, tab, backspace and form feed, and states that no other character should be escaped. Measured in this toolchain (Node 24, the runtime the Vitest suites use), `JSON.stringify` behaves as follows:

| Input | `JSON.stringify` output | Against NIP-01 |
| --- | --- | --- |
| `U+2028`, `U+2029` | emitted raw | matches the spec |
| `U+007F` | emitted raw | matches the spec |
| The seven mandated characters | `\n`, `\"`, `\\`, `\r`, `\t`, `\b`, `\f` | matches the spec |
| `U+0001`–`U+001F` | escaped as `\u00XX` | diverges from the letter of the spec, but matches what most other Nostr implementations do, because they also delegate to their language's JSON serializer |
| Lone surrogate, e.g. `U+D800` | escaped as `\ud800` | the one genuine interoperability divergence |

The security-critical property holds today and must keep holding: the extension hashes the pre-image it built, signs that id, returns that same id, and the approval dialog renders the same `content` that gets signed. The user is not signing something other than what was shown. The exposure is interoperability — a strict verifier recomputing the id from the returned event gets a different value and rejects it.

**Recommendation: do not hand-roll NIP-01 escaping. Reject unpaired surrogates at the validation boundary instead.**

`UnsignedEventSchema` (`src/infrastructure/validation/schemas.ts:140-146`) is already the gate that every `nostr.signEvent` request passes through at `nostr-rpc.ts:95`. It gains a well-formed-string refinement on `content` and on every `tags` entry, using `String.prototype.isWellFormed()`, and returns the existing `RPC_ERROR_CODES.INVALID_EVENT` on failure. That is a few lines in one file, at the layer whose stated job is rejecting untrusted input before it reaches a service, and it closes the only genuine divergence completely — an unpaired surrogate can no longer reach `computeEventId` at all, from any call site.

The cost of the alternative is why it loses. A hand-rolled serializer would be roughly forty lines of escaping logic in the highest-consequence function in the product, and it would need exhaustive tests over the whole escape space to be trustworthy — a serializer that is 99% right is a signer that produces wrong ids for 1% of events. It would also make Ostrilo *worse* on interoperability, not better: implementing the spec's letter means emitting `U+0001`–`U+001F` raw, which would disagree with the majority of the ecosystem that escapes them. So the trade is a rare divergence (lone surrogates, which the boundary check eliminates anyway) against a common one (control characters, which nothing else in the ecosystem produces raw). Keeping `JSON.stringify` keeps Ostrilo bit-compatible with the implementations its events actually have to verify against.

Two things follow. First, the domain serializer of Decision 3 must be a thin, testable wrapper so the choice is visible and swappable if the ecosystem ever converges on the spec's letter. Second, the NIP-01 vectors from `restore-security-test-assurance` must include the control-character, `U+2028`/`U+2029` and `U+007F` cases, so the four rows in the table above are assertions rather than notes in a design document.

**Alternative considered:** normalize instead of reject — replace unpaired surrogates with `U+FFFD` before serializing. Rejected: silently altering the content a user is about to sign is precisely the property this design is protecting. If the extension changes the payload, the approval dialog is no longer showing what gets signed.

### Decision 6: Enforcement, so the duplication cannot come back

Two mechanisms, because they catch different failures.

**A lint boundary.** ESLint is not currently installed or configured in this repository, so this change introduces it with a deliberately small configuration: a flat config, TypeScript parsing, and a `no-restricted-imports` rule with `@noble/*` and `@scure/*` in `patterns`, applied to `src/**` with an override lifting the restriction for `src/infrastructure/crypto/**`. The rule message names the ports file so the error tells the author what to do instead. This catches the reachability failure — a new module importing a primitive directly rather than through a port.

**A single-implementation test.** A Vitest case that walks `src/`, and for each covered primitive asserts exactly one implementing module. Detection is by import edge, not by string matching on function names: for each primitive, the set of `src/` modules importing the corresponding library symbol must have exactly one member, and that member must be the expected adapter. The assertion message lists the primitive and every file implementing it, so a failure is self-diagnosing. This catches the duplication failure — a second implementation added inside the adapter layer, where the lint rule permits the import.

**Rationale:** The lint rule alone would allow two adapters for the same primitive. The test alone would allow a domain module to import `@noble/hashes` and inline a hash. Both failures have already happened in this codebase, so both need a gate.

**Alternative considered:** rely on code review and the standards document. That is what exists today, and `docs/development-standards.md` already says cross-layer dependencies must point inward through ports. The rule was documented and the violations landed anyway. An unenforced rule is a preference.

Note for sequencing: `restore-security-test-assurance` is adding a CI workflow that runs typecheck, the test suites and both builds. The lint step and this test belong in that workflow. Until it exists, both are local commands, which means this change should not be the thing that first proves them.

### Decision 7: Sequencing — the KDF change lands first

Three changes touch these files. The order is:

1. **`restore-security-test-assurance`** — vendors the official BIP-340 and NIP-01 known-answer vectors, and pins React Doctor so the verification tooling works at all. This is a prerequisite for the refactor being *provable*. Its own proposal states the dependency in the same direction: `consolidate-crypto-implementations` should not proceed until the interop vectors exist.
2. **`harden-vault-key-derivation`** — rewrites `CryptoKdf`, the AES-GCM call and the vault record format.
3. **`consolidate-crypto-implementations`** — this change.

**The KDF change must land before this one, and this change must not delay it.** The reasons are asymmetric, which is what settles the order:

- It is urgent and it blocks key creation. No real user key exists yet, so adding the version discriminator and the recorded KDF parameters costs nothing today and becomes an irreversible migration problem the moment a user stores a key they cannot afford to lose. Every day this cleanup delays it is a day that window can close.
- It reshapes the interfaces this change consolidates around. `CryptoKdf.deriveKey(password, salt)` becomes a parameterised call, `CryptoAead.encrypt`/`decrypt` gain additional authenticated data, and `KeyVaultService.encryptPrivateKey`, `validatePasswordAgainstExistingKeys`, `generateKey`, `importKey`, `unlock` and `revealKey` all move to a KEK/DEK envelope. Consolidating first would mean consolidating around port signatures that are about to change, and then reworking the consolidation.
- The conflict is cheap in this direction and expensive in the other. If the KDF change goes first, this change deletes `deriveKeyFromPassword`, `encryptPrivateKey` and `decryptPrivateKey` from `domain/utils/crypto.ts` — which are dead either way, so the deletion is unaffected by whatever the live KDF became. If this change went first, the KDF change would have to rebase its rewrite onto a freshly reorganised module layout while under time pressure.

`harden-vault-key-derivation` has already accounted for the overlap: its Impact section notes that `deriveKeyFromPassword`, `encryptPrivateKey` and `decryptPrivateKey` hard-code PBKDF2 at 100,000 iterations in a second place, that it must not leave the two implementations disagreeing, and that deeper consolidation belongs here. The practical consequence for that change is that it should not spend effort updating the dead copy — it should leave it exactly as it is, so this change can delete it without a merge conflict over lines nobody executes.

`remove-key-exfiltration-surface` also touches `crypto.parsePrivateKey`, replacing the raw secret-key byte array with a validation-only result. It can land in either order relative to this change. If it lands first, the surviving parser has one fewer caller shape to preserve, which is marginally simpler; if it lands second, it changes one call site instead of two.

**Deliberate omission:** this change does not modify the `key-vault` capability spec. `harden-vault-key-derivation` is already rewriting `Zero-Retention Password Handling` and `Memory Zeroization`, and `restore-security-test-assurance` is restating `Memory Zeroization` again to separate the buffer guarantee from the string guarantee. A third in-flight delta on the same two requirements would collide at archive time for no gain, since this change is behaviour-preserving and `zeroize` survives with identical semantics.

### Decision 8: Tests follow the survivor; they do not keep a duplicate alive

Several tests import symbols this change deletes: `tests/unit/domain/nostr-events.test.ts:2-9` imports `computeEventId`, `signEventHash`, `verifyEventSignature`, `generatePrivateKey`, `getPublicKey` and `publicKeyToHex`; `tests/unit/domain/utils.test.ts:20-25` and its twin import `zeroize`, `generatePrivateKey`, `getPublicKey` and `generateKeyPair`; `tests/test-crypto.ts:6-13` imports `generateKeyPair`, `encryptPrivateKey`, `decryptPrivateKey`, `parsePrivateKey`, `privateKeyToBech32` and `publicKeyToBech32`.

Those references do not justify keeping the duplicates. A test that asserts properties of an implementation the product never executes proves nothing about the product — it is the same defect `restore-security-test-assurance` is fixing in `tests/security/memory-zeroization.test.ts`, where the unit under test is a mock. Every such test is re-pointed at the surviving implementation: key generation is exercised through `KeyVaultService.generateKey`, public-key derivation and signature verification through the `Schnorr` adapter, event ids through the application-layer `computeEventId`.

Two further cleanups fall out. `tests/unit/domain/utils.test.ts` and `tests/unit/domain/domain-utils.test.ts` are 255-line near-duplicates covering the same modules and differing in five assertions — duplicated tests for duplicated code, and a fix to one is invisible in the other. They collapse into one file. And `tests/test-crypto.ts` is a console-logging script Vitest never collects, because its filename has no `.test.`/`.spec.` infix and nothing imports it; `restore-security-test-assurance` owns resolving it, and if it has not yet, this change deletes it rather than migrating imports in a file that never runs.

## Risks / Trade-offs

- [Risk] Touching cryptographic code carries regression risk in the highest-consequence part of the product. A mistake here does not produce a visible bug; it produces a signature over the wrong bytes, or a vault that will not open. → Mitigation: the change is behaviour-preserving by construction — no algorithm, parameter, format or contract moves, and every surviving implementation is one that is already on the live path rather than a newly written one. It lands with the official BIP-340 and NIP-01 known-answer vectors from `restore-security-test-assurance` as the gate, so "the ids and signatures are unchanged" is a passing assertion rather than a claim. Sequencing behind that change is what makes the refactor provable; proceeding without the vectors is the main way this goes wrong.
- [Risk] The full test suite must run, not a focused subset. This is a cross-cutting refactor touching domain, application, infrastructure and UI, and the tests most likely to break are the ones nobody would think to run. → Mitigation: `pnpm run test` in full is a verification requirement, and both browser builds are checked because module layout changes affect bundling.
- [Risk] Hardening the hex codec converts a silent success into a thrown error, and a caller that never expected an exception can crash a React render. → Mitigation: the audit in Decision 4 enumerates every decode site and its disposition, and the two silent-zero call sites in `KeyManagerContext` are removed rather than merely re-pointed. The key list must degrade to a readable error state, not an unhandled exception.
- [Risk] Rejecting unpaired surrogates could reject an event some client legitimately wants signed. → Mitigation: an unpaired surrogate is not valid text in any encoding a Nostr relay accepts, and today's behaviour already corrupts it — `TextEncoder` maps it to `U+FFFD`, so the extension is signing an id over bytes the sender did not send. Rejecting is the honest outcome, and it returns the existing `invalid_event` code rather than a new one.
- [Risk] Merge conflict with `harden-vault-key-derivation`, which rewrites the same two files. → Mitigation: the explicit ordering in Decision 7, plus the request that the KDF change leave the dead `domain/utils/crypto.ts` copy untouched so this change deletes it cleanly.
- [Trade-off] Introducing ESLint adds tooling and devDependencies to a repository that has none today, on a project whose companion change is specifically tightening supply-chain policy. → Accepted, with the configuration kept to the flat config, the TypeScript parser and the single `no-restricted-imports` rule. It is not a style-lint rollout. If the team prefers zero new dependencies, the fallback is a grep-based check in the same test that asserts single implementations — weaker, because it runs only in CI and gives no editor feedback, but it satisfies the requirement.
- [Trade-off] The strict `@scure/base` boundary costs an additive response field and a change to how the UI obtains npub values, which is more movement than a pure deletion. → Accepted, because the alternative leaves the silent-zero call sites in place and starts an allowlist that will grow.
- [Trade-off] `knip.json` exists but `knip` is not a devDependency, so proving the dead exports are gone needs either that dependency or a grep pass. → Either satisfies the requirement; the grep pass is per-symbol against the Decision 2 table and is what a reviewer would do anyway.

## Migration Plan

1. No data migration. No stored format changes and no persisted value is re-encoded, so a vault written before this change reads identically after it.
2. Land `restore-security-test-assurance` (vectors, pinned tooling, CI) and `harden-vault-key-derivation` (KDF, envelope, record format) first, per Decision 7.
3. Introduce the additive pieces before removing anything: the two new ports and adapters, the new domain modules, and the additive `npub` field on the key-list projection. At this point both implementations exist and the extension still runs on the old one.
4. Re-point every live caller onto the survivors, one primitive at a time, running `pnpm run compile` and the vector tests between primitives so a regression is attributable to a single step.
5. Delete the duplicates from the Decision 2 table, then run the dead-export proof.
6. Add the lint boundary and the single-implementation test last, once the tree already satisfies them, so a failure at that point means a genuine miss and not work in progress.
7. Rollback is per-step and cheap. Nothing is persisted and no contract is broken, so reverting the commit restores the previous behaviour exactly. The riskiest step to revert is step 4; keeping each primitive in its own commit is what makes a partial rollback possible.

## Open Questions

- Should the `Schnorr` port expose `verify` for production use or only for verification in tests? Nothing in `src/` verifies a signature today. Adding it to the port is what lets the vector tests avoid importing `@noble/curves`, but a port member with no production caller is itself the pattern this change is removing.
- Should `crypto.parsePrivateKey` survive at all once `remove-key-exfiltration-surface` reduces it to a validation-only result? `isValidPrivateKeyFormat` (`src/domain/utils/validation.ts:82`) and `KeyInputSchema` (`schemas.ts:72`) already perform format validation without touching a crypto library, so the RPC round trip may be redundant. That is that change's call, not this one's, but the answer determines whether the surviving parser has one caller or two.
- Does the additive `npub` field belong on the key-list response projection or on a separate view model? The former is smaller; the latter avoids growing a response shape that `remove-key-exfiltration-surface` is separately trimming.
- Should `CRYPTO_CONSTANTS` remain a single frozen object, or split so that `KEY_LENGTH` and the bech32 prefixes live beside the code that uses them? `harden-vault-key-derivation` is removing the meaning of `SALT_LENGTH` and `IV_LENGTH` as global constants, so at least part of the object is about to become stale.
