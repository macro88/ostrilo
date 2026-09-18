## Context

The vault has exactly one way in. `unlock(password)` (`src/application/services/key-vault.service.ts:566-670`) loads the envelope, calls `openEnvelope` (`:183-207`) to derive the KEK with Argon2id and prove it against a known-plaintext verifier, then walks each record: unwrap the DEK under the KEK, decrypt the private key under the DEK, verify the recovered key derives the stored `pubkey`. `isLocked: false` is written only after the verifier succeeds, and the KEK is zeroized in a `finally` (`:668-670`). The shape is already right for a second credential: there is a single point where a candidate KEK is proven, and everything after it is credential-agnostic.

What does not exist: any WebAuthn code (`grep navigator.credentials src/` is empty; the capability helpers were deleted as dead code by `consolidate-crypto-implementations`), any HKDF (`grep -rn hkdf src/` is empty), any asymmetric verification other than Schnorr, any nonce or challenge issuance — every existing gate is a password re-derivation (`src/infrastructure/messaging/reauth.ts:31-58`) — and any extension document beyond popup, options, sidepanel, approval and the background worker.

Three platform facts, verified against primary sources, shape everything below.

**An extension may assert its own origin as a relying-party identifier, on Chromium, with no permission.** `ExtensionCanAssertRpId` short-circuits on `extension.id() == rp_id` (`chrome/browser/webauthn/chrome_web_authentication_delegate.cc:116-125`) and `MaybeGetRelyingPartyIdOverride` rewrites it to `caller_origin.Serialize()` (`:221-235`). This is a deliberate Chromium deviation from the WebAuthn specification, which otherwise requires a valid domain. It is compiled out on Android (`content/browser/webauth/webauth_request_security_checker_impl.cc:179-190`), which is moot — Chrome on Android runs no extensions.

**The ceremony needs a visible document.** `navigator.credentials` is `[Exposed=Window, SecureContext]`, so there is no service-worker path. Chrome additionally requires `GetVisibility() == VISIBLE` (`chrome_web_authentication_delegate.cc:251-254`), which rules out offscreen documents and hidden frames. The action popup is ruled out separately: Bitwarden hit exactly this and fixed it by moving the ceremony out of the popup (`bitwarden/clients#4695`, "Open WebAuthn Prompt in New Tab for all browser extensions", closing issue #4365), and Firefox bug 2026687 reports extension popups closing during a ceremony.

**PRF availability is the load-bearing unknown, and macOS is the likely failure.** Chrome's own macOS profile Touch ID authenticator declares no PRF at all (`device/fido/mac/authenticator.mm:132-141` sets only `is_platform_device`, `supports_resident_key`, `user_verification_availability`, `supports_user_presence`). The only PRF-capable macOS platform authenticator is iCloud Keychain, gated `if (@available(macOS 15.0, *)) { options.supports_prf = true; }` (`device/fido/mac/icloud_keychain.mm:79-81`) — and Chrome forwards the rewritten RP ID straight into Apple's domain-shaped `relyingPartyIdentifier` (`:280`, `:301`, `:319`). A string containing `://` is not a domain. Windows is more promising: `supports_hmac_secret = true` unconditionally, with `supports_hmac_secret_mc = api_version >= WEBAUTHN_API_VERSION_8` (`device/fido/win/authenticator.cc:67-68`). Linux has no platform authenticator at all — `IsUVPlatformAuthenticatorAvailable` is defined only under `IS_MAC`, `IS_WIN` and `IS_CHROMEOS`.

This is why task group 1 is a measurement spike with a written kill criterion, and why nothing else starts until it lands.

## Goals / Non-Goals

**Goals:**

- Remove the master password from the highest-frequency surface in the product without removing it from the product.
- Reuse the existing KEK. One KEK, one envelope, one verifier; the biometric path produces the same 32 bytes the password does and proves them the same way.
- Make every field the verifier consults unforgeable by a storage writer, by putting all of them inside the AEAD tag.
- Make a captured PRF output worthless on its own, via a background-verified, single-use, non-replayable assertion.
- Keep authority strictly bounded: a biometric session unlocks and signs under existing policy, and can do nothing else.
- Fail closed and fail visibly: every failure state is designed, the password is always named as the working alternative, and enrolment is disclosed on a surface the user sees.
- Be absent, not broken, where the platform cannot support it.

**Non-Goals:**

- No biometric re-authentication. The password-gated set stays exactly as it is: `vault.deleteKey` (`vault-rpc.ts:482`), the two `REAUTH_SETTINGS_FIELDS` timeouts (`settings-rpc.ts:61`), and the three policy cases that call `requireReauth` — raising an origin to high trust (`policy-rpc.ts:105`), an allow kind rule (`:149`) and enabling a session grant (`:196`). `vault.reveal` is also password-only, but by a different mechanism: `handleReveal` validates with `PasswordSchema` and calls `context.vault.revealKey(message.password, …)` directly (`vault-rpc.ts:356-383`), never `requireReauth`. A biometric session produces no password, so every one of these refuses it with **zero new enforcement code**, and `tests/security/reveal-requires-password.test.ts` keeps passing untouched.
- No biometric route to key add or import. `kekForWrite` (`key-vault.service.ts:306-335`) is password-only and stays so. The alternative — holding a live KEK on the service for the session — is the unbounded-authority mistake `reauth.ts:17-24` refuses by name.
- No cached "biometrically verified for N minutes" window. The challenge is single-use and consumed before verification.
- No Firefox. Firefox 150 grants extension RP IDs only for host-permission **domains** (bug 1956484, RESOLVED FIXED); `moz-extension://<id>` is bug 1693562, still UNCONFIRMED, and `dom/webauthn/tests/gtest/TestWebAuthnRpIdCommon.h` carries the explicit negative case. The cross-browser route needs `host_permissions`, which `tests/security/manifest-assertions.test.ts:359-363` fails as a stated SECURITY REGRESSION.
- No Safari, **and no claim that Safari is impossible**. The only evidence is Apple Developer Forums thread 774351 (NotAllowedError from an extension origin, unanswered as of March 2026), contradicted in passing by a Mozilla bug reporter. No primary WebKit source was found either way. There is no Safari build script in `package.json`, so this is documentation risk only.
- No onboarding enrolment step. `OnboardingStepDots count={3}` is hard-coded (`OnboardingCreateKey.tsx:313-317`) and the create flow deliberately drops the password from memory (`:115-163`) at exactly the moment enrolment would need it.
- No multiple enrolled factors in v1. One factor plus the password covers the daily journey; an array is a later format-compatible extension.
- No change to `VAULT_VERSION`, `SUPPORTED_VAULT_VERSIONS`, `KDF_DEFAULTS`, `KDF_FLOORS` or any existing AAD. No existing ciphertext is re-encrypted.
- No new manifest permission, no `host_permissions`, no new CSP source, no new npm package.
- No activity-log entry for enrolment. `ActivityLogEntry.operation` is a signing-shaped union whose `describeActivityEntry` helpers (`src/domain/types.ts:404-428`) would have to widen; the user-visible record is the lock-screen affordance appearing and the Security tab listing the factor.
- No `largeBlob`, no user-handle fallback, and no assertion-only gate that releases a stored key. Named as rejected so nobody retries them.

## Decisions

### Decision 1: One KEK, wrapped twice

There is exactly one KEK. The biometric path adds one more wrapping of the same 32 bytes.

```
UNCHANGED (key-vault.service.ts:78-86, :138-143, :214-250):

  password --Argon2id(m=19456, t=2, p=1, dkLen 32, 16B salt from envelope.kdf)--> KEK (32B)
    KEK --AES-GCM(iv12, aad=verifierAad(v, kdf))--> envelope.verifier          [proof of KEK]
    KEK --AES-GCM(iv12, aad=dekAad(v, kdf, keyId, pubkey))--> rec.wrappedDek   [per record]
      DEK --AES-GCM(iv12, aad=skAad(v, keyId, pubkey))--> rec.ct               [the nsec]

ADDED:

  authenticator --PRF(eval.first = factor.prfSalt, UV required)--> prf32 (32B IKM)
    prf32 --HKDF-SHA256(salt=empty, info="ostrilo/biometric-kek-wrap/v1" || 0x00 || credId, L=32)--> BWK
    BWK --AES-GCM(iv12, aad=bioWrapAad(...))--> factor.wrapped                 [the same KEK]

  Recovered KEK --must decrypt envelope.verifier to "ostrilo/vault-verifier/v1"--> accepted
  Then openVaultWithKek(kek) runs the identical per-record loop.
```

**Rationale:** the verifier already exists as the single point where a candidate KEK is proven. Reusing it means the biometric path cannot admit a KEK the password path would reject, and a tampered `factor.wrapped` fails at the same gate a wrong password does. No second KEK means no second thing to keep in sync, and no envelope bump means no re-encryption of anything.

**Alternative rejected — store a separate biometric-derived KEK and re-wrap every DEK under it.** Two KEKs that must stay consistent across every key add, and a password change would have to find and rewrite both.

**Alternative rejected — assertion-only gate that releases a stored plaintext key.** This is the CVE-2023-27706 pattern: Bitwarden stored the Windows biometric unlock key under DPAPI, retrievable by any process in the user session with no Hello ceremony. Here the ceremony must be load-bearing for *decryption*, not merely for *permission*.

**Alternative rejected — `largeBlob` instead of PRF.** `device/fido/large_blob.h:47` sets `kMinLargeBlobSize = 1024`, and Chrome's macOS and enclave authenticators use `LargeBlobSupportType::kBespoke`. It stores a blob rather than deriving a secret, so the wrapping key would have to be stored somewhere, which is the pattern above.

### Decision 2: HKDF, returning a key object rather than bytes

The 32-byte PRF output is input keying material, not a key. It is stretched with HKDF-SHA256 (empty salt, versioned purpose-bound info) into the wrapping key.

The port returns a **non-extractable `CryptoKey`** and never derived bytes:

```ts
deriveAeadKey(ikm: SecretBytes, info: SecretBytes, usages): Promise<CryptoKey>
```

**Rationale:** `src/domain/utils/memory.ts:10-21` can zeroize a `Uint8Array` and cannot zeroize a `CryptoKey`. Returning bytes would create a secret the codebase's own zeroization contract cannot honour. Returning a non-extractable key means the wrapping key never exists as a JS buffer at all — so there is nothing to fail to wipe.

The wrapping must **not** be modelled as a `KdfParams` variant: `assertKdfAcceptable` (`key-vault.service.ts:110-123`) rejects unknown algorithms with `kdf_unknown_algorithm`, and that check is a security control for password derivation specifically. Widening it to admit a non-password algorithm would weaken it.

### Decision 3: Two gates, because either alone is insufficient

**Gate A** proves possession of the PRF secret. **Gate B** proves a live ceremony happened now.

Gate B, in order, in the background:

1. `unlockThrottle.check()` — before anything is minted or consumed.
2. Consume the challenge from `storage.session`, **before verification and regardless of outcome**. A failed attempt cannot retry against the same nonce.
3. Refuse if the vault holds any unversioned record, or has no envelope.
4. Refuse if the password rehearsal is due, or this is the first unlock of the browser session.
5. Locate the factor by constant-time credential-id compare.
6. Parse `clientDataJSON`: `type`, challenge bytes, `origin`, `crossOrigin` not true.
7. Parse `authenticatorData`: rpIdHash bytes 0–31 against the **recorded** value, flags at byte 32 (UP `0x01`, UV `0x04`, BE `0x08`, BS `0x10`).
8. Verify the ECDSA P-256 signature over `authenticatorData || SHA-256(clientDataJSON)` against the recorded public key.
9. Derive the wrapping key, unwrap.
10. Prove the recovered KEK against the envelope verifier.

**Rationale:** without Gate B, a compromised document that captures one PRF output holds a permanent, silent, replayable key to the vault, and `userVerification: "required"` is a request the background cannot enforce — a boolean supplied by a document is not proof of anything. Gate B is roughly 40% of this change and it is the part that makes the feature honest.

**Alternative rejected — trust the document's report of the assertion.** The document is exactly the thing the gate exists to distrust.

### Decision 4: Record the relying-party identity as observed, never compute it

Enrolment reads the `rpIdHash` out of the registration `authenticatorData` and the `origin` out of `clientDataJSON`, stores both, and compares later assertions byte-for-byte.

**Rationale:** Chromium rewrites the RP ID internally (`MaybeGetRelyingPartyIdOverride` → `caller_origin.Serialize()`). Any expected hash this codebase computed from a constructed string would be a guess at Chromium's serialization, and would silently break if it changed. Recording the observed value cannot drift, and binding it into the AAD stops a storage writer re-pointing the factor at a credential it controls.

### Decision 5: The AAD binds every field the verifier consults

```
bioWrapAad = strField("ostrilo/vault-bio-wrap")
           | numField(envelope.v) | kdfFields(envelope.kdf)   // alg + costs + ENVELOPE SALT
           | numField(wrapperV)
           | field(credentialId) | field(rpIdHash) | strField(origin)
           | field(pubX) | field(pubY) | strField("ES256")
           | numField(backupEligible ? 1 : 0) | field(prfSalt) | numField(hkdfInfoVersion)
```

`AAD_DOMAIN` gains a fourth entry, because the module's own rule forbids reusing a domain across uses (`src/domain/crypto/aad.ts:14-25`) — without it a wrapped-KEK blob could be accepted where a wrapped DEK is expected.

The COSE algorithm is encoded as the string `"ES256"`, not as `-7`: `numField` throws on negative integers (`aad.ts:48-50`).

Binding the **envelope's** KDF fields and salt is what makes a rolled-back or swapped envelope break the wrapping by construction, rather than by a separate consistency check somebody could forget to call. Binding the public key and the BE bit is what stops the one record an attacker with storage write would otherwise rewrite to defeat Gate B. Mutable fields — `label`, `transports`, `createdAt`, `lastUnlockAt`, `lastPasswordUnlockAt` — stay outside, so touching them re-encrypts nothing.

### Decision 6: A dedicated, visible ceremony window

Both ceremonies run in `unlock.html`, opened with `browser.windows.create` on the `windows` permission already held. It renders the mascot, one line of context and one ghost Cancel; it holds no key list, loads no 3D, runs the ceremony on load, and closes itself when the RPC resolves.

**Rationale:** the popup is ruled out by Bitwarden's fix and Firefox 2026687; offscreen documents and hidden frames are ruled out by Chrome's visible-`WebContents` check. A dedicated document also keeps the PRF output out of the surfaces that hold key lists.

Its cost is honest and stated: it is a **fifth key-handling document**, and it must join `KEY_HANDLING_DOCUMENTS`. That constant must become target-aware first, because `tests/security/key-handling-bundle.test.ts:113` reads every listed document from every target's output with no guard, so a Chromium-only document crashes the suite with ENOENT rather than failing an assertion. The per-target expectation mirrors the existing `expectsSidePanelPermission` precedent in `manifest-assertions.test.ts:345-356`.

### Decision 7: Reduced authority, by construction rather than by enforcement

A biometric session records `authFactor: "biometric"` and can unlock and sign under existing policy. It cannot reveal, back up, generate, import, delete, change the two security timeouts, raise an origin to high trust, set an allow kind rule, enable a session grant, or enrol a factor — because every one of those already requires the password, by `requireReauth` or, in reveal's case, by an inline check.

Be precise about the boundary, because it is narrower than "cannot change an origin policy" would suggest. `policy-rpc.ts` gates exactly three cases (`:105`, `:149`, `:196`). Lowering a trust level, setting a deny or ask kind rule, disabling a session grant and `policy.removeOrigin` are **not** password-gated today, so a biometric session can do them — exactly as a password session can, without re-entering the password. This change does not widen that gate, and no surface or spec claims it does.

**Rationale:** this is the cheapest correct design. No new enforcement path means no new enforcement path to get wrong, and the existing security tests keep passing unchanged. `authFactor` exists so the reduced tier can be *asserted by a test* and *explained by `ReauthDialog`*, not so it can gate anything — with one deliberate exception recorded in the Migration Plan: an **unrecognised** factor value reads as locked, while an **absent** one reads as a password session, so a session opened by the previous build is not force-locked on upgrade.

### Decision 8: Rehearsal, and a password-only first unlock per browser session

Two background-enforced availability and coercion controls:

- **30-day rehearsal.** `vault.biometricCompleteUnlock` is refused when no password unlock has happened in `PASSWORD_REHEARSAL_DAYS`. `vault.biometricStatus` reports it so the lock screen *withdraws the affordance and explains why*, rather than offering a button that fails.
- **First unlock after a browser restart or extension update is password-only.** Cheap, and it blunts three things at once: the physical attacker at an unlocked machine with a security key left in the port, the coercion asymmetry (US courts are split on compelled biometrics while compelled password disclosure is generally protected — for a Nostr identity that is a genuine regression), and rehearsal decay.

**Rationale:** the dominant new risk is availability — a factor with no escrow that the user has stopped being able to replace. A warning read once at enrolment does not address it; a mechanism does.

### Decision 9: Absent on Firefox, not disabled

`IS_CHROMIUM_BUILD` from `import.meta.env.BROWSER`, plus a WXT per-entrypoint target filter so `unlock.html` is not built for Firefox. No RPC methods registered, no Security section, no lock-screen button, asserted by a build-output test.

**Rationale:** `SecuritySettingsTab.tsx:16-22` sets the precedent explicitly — a control that cannot do anything is a promise the surface cannot keep. This change exists partly because that lesson was learned the hard way here.

## Risks / Trade-offs

- **No PRF-capable authenticator answers an extension-origin RP ID on macOS** → The single most likely failure, and the reason for the spike and the written kill criterion in the proposal. Fallback is defined and silent: the Security section renders nothing, the lock screen shows no button, password unlock is unchanged, and no copy ever names Touch ID or Face ID.
- **Malware with code execution in the user's session** → Not defended against, and said plainly. It can open the ceremony window and prompt the user itself. Gate B bounds this to a live ceremony rather than a captured secret; the honest framing is "every unlock costs a visible authenticator prompt", not "the attacker must wait".
- **Silent enrolment by a document that has observed the password once** → No cryptographic fix exists. Mitigation is visibility: the lock-screen affordance appearing where the user never enrolled *is* the disclosure, and the Security tab lists the factor with its enrolment date.
- **Synced passkeys (iCloud Keychain, Google Password Manager) return an identical PRF output on every synced device** → The factor becomes as strong as the cloud account rather than the local secure element. v1 does **not** refuse backup-eligible credentials, because doing so would plausibly leave macOS with zero working authenticators. Instead the BE bit is recorded at enrolment, bound into the AAD so a storage writer cannot flip it, compared on every assertion, and disclosed in the enable-time copy.
- **Credential loss with no escrow** → Secure Enclave wipe, Hello PIN reset, fingerprint re-enrolment under a `biometryCurrentSet`-style ACL, deletion in the platform manager, or an extension-ID change all destroy the secret permanently. Mitigated by the password being non-removable, by rehearsal, and by a designed "permanently unusable factor" state offering to forget it.
- **The PRF output crosses the message bus as `number[]`** → `runtime.sendMessage` structured-clones it into a copy neither side can zeroize. Transferable `ArrayBuffer`s were evaluated and are not available on `runtime.sendMessage` or `Port.postMessage`, so the copy is unavoidable. It is bounded by the message lifetime and is the same exposure `vault.unlock` already gives the master password. The design states this rather than claiming erasure, exactly as `memory.ts:10-21` does for strings.
- **Three new parsers on attacker-influenced bytes** → Minimised deliberately: no CBOR decoder, `attestationObject` never read, `attestation: "none"`, `pubKeyCredParams: [-7]` only, explicit minimum and maximum lengths, trailing bytes rejected, hostile-input tests for truncation, over-length, wrong prefix and wrong type strings.
- **Disclosing to a locked screen that a factor is enrolled** → Showing "Unlock with your device" tells anyone holding the device that an authenticator is enrolled for this vault. Accepted: the affordance is the disclosure mechanism for silent enrolment, which is the larger risk, and `rpc-router.ts:124-132` already establishes that reachable is not the same as unredacted — `biometricStatus` returns usability, never the credential id or label.
- **Re-entrant unlock** → A second unlock over a live session is now materially more likely with two entry points. `unlock` must zeroize previously held keys before clearing the map (the `:611` defect), and a ceremony in flight when auto-lock fires must fail closed against a consumed challenge.
- **Extension downgrade** → An older build predating this code can read and rewrite `storage.local`. It will not understand `vaultBiometric`; the wrapping is re-validated against the live envelope on every read, so a stale record cannot open a rotated vault.
- **Multiple machines** → `storage.local` does not sync, so a user with a laptop and a desktop enrols twice. A restored or copied browser profile carries the same extension id and the same wrapper with no matching credential — the "permanently unusable factor" state is what catches it.
- **Scope** → Roughly 14 task groups across domain, application, infrastructure, extension, UI, tests and docs, with 13 delta specs. Large for one change, but Gate B cannot be deferred without shipping a security claim the code does not keep, and the platform guards cannot be deferred without breaking `pnpm run test:build-output`.

## Migration Plan

No data migration. Nothing existing is read differently, rewritten or re-encrypted; `vaultBiometric` simply does not exist until a user enrols.

- **Forward:** a vault with no factor record behaves exactly as today. Enrolment requires the password and an unlocked, fully-versioned vault.
- **Legacy vaults:** any stored key record with no `v` field refuses both enrolment and biometric unlock, and says the vault must be opened once with the password first. Mixing a lazy legacy migration with a second credential path is avoidable complexity for a case that resolves itself on the next password unlock.
- **Upgrade with a live session:** a session opened before this change records no `authFactor`. An absent value reads as `password`, so no live session is force-locked on upgrade. An unrecognised value reads as locked.
- **Rollback:** delete the `vaultBiometric` record. `forget()` requires no credential and is reachable while locked, so a user locked out of a dead authenticator is never stuck. The envelope, every key record and the password are untouched.
- **Envelope writes delete the factor.** Implemented at `saveEnvelope`, so a future change-password flow — which does not exist today (`grep changePassword src/` is empty) — cannot leave a wrapping that opens a KEK the user believes they rotated away from. This is the rule written down before the flow that needs it exists.

## Open Questions

- **Does any PRF-capable authenticator answer a `chrome-extension://<id>` relying-party identifier, on which platforms?** Resolved by task group 1 against the kill criterion in the proposal. Everything downstream is contingent on it.
- **Which ceremony hosts satisfy Chrome's visible-`WebContents` check?** The spike measures a `windows.create` window, a foreground options tab, a background options tab and a side panel. The design commits to the created window; if it does not qualify, no surface does and the change is withdrawn.
- **Does `add-auto-lock-countdown` rebase onto this, or this onto it?** Both touch `SecuritySettingsTab`, `session-auto-lock` and `ui-options-page`. Their lock-gate classifications should be decided together, in one pass.
