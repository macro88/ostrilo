## Context

The vault has exactly one way in. `unlockNow(password)` in `src/application/services/key-vault.service.ts` recovers any interrupted password change, loads the envelope, calls `openEnvelope` to derive the KEK with Argon2id and prove it against a known-plaintext verifier, then walks each record: unwrap the DEK under the KEK, decrypt the private key under the DEK, verify the recovered key derives the stored `pubkey`. `isLocked: false` is written only after at least one key is held in memory, and the KEK is zeroized in a `finally`. The shape is already right for a second credential: there is a single point where a candidate KEK is proven, and everything after it is credential-agnostic.

What does not exist: any WebAuthn code (`grep navigator.credentials src/` is empty), any HKDF (`grep -rn hkdf src/` is empty), and any extension document beyond popup, options, sidepanel, approval and the background worker.

Four platform facts shape everything below. The first three were read out of Chromium `main` on 2026-11-20; the reports under the fourth are third-party and are what task group 1 exists to confirm or refute on real hardware.

**An extension may assert its own origin as a relying-party identifier, on Chromium, with no permission.** `ExtensionCanAssertRpId` returns true when `extension.id() == rp_id`, before any permission check, and `MaybeGetRelyingPartyIdOverride` rewrites the RP ID to `caller_origin.Serialize()` (both in `chrome/browser/webauthn/chrome_web_authentication_delegate.cc`). The rpIdHash is therefore SHA-256 of `chrome-extension://<id>`. This is a deliberate Chromium deviation from the WebAuthn specification, which otherwise requires a valid domain. The manifest `key` that fixes the id is public, so the RP ID identifies the extension id, not the Web Store build: an unpacked extension carrying the same `key` asserts the same RP.

**The ceremony needs a visible document.** `navigator.credentials` is `[Exposed=Window, SecureContext]`, so there is no service-worker path. Chrome's `IsFocused` is `web_contents->GetVisibility() == content::Visibility::VISIBLE`, which rules out offscreen documents and hidden frames. The source has no special case for the action popup or the side panel; the popup is ruled out because it closes when focus moves to the authenticator prompt (Bitwarden hit exactly this and moved the ceremony out, `bitwarden/clients#4695`), and a third-party report describes the prompt hanging in the side panel.

**Which authenticators can answer with PRF, per platform:**

| Platform | Authenticator | PRF | Synced | Source |
| --- | --- | --- | --- | --- |
| macOS | Chrome's own Touch ID (profile) authenticator | No | No | `device/fido/mac/authenticator.mm` sets four options, none of them PRF or hmac-secret |
| macOS 15+ | iCloud Keychain | Yes | Yes | `device/fido/mac/icloud_keychain.mm`, `supports_prf` under `@available(macOS 15.0, *)` |
| macOS, Windows, Linux | Google Password Manager | Yes | Yes | `device/fido/enclave/`, with `MakeCredentialWithPrf` and `GetAssertionWithPrf` browser tests |
| Windows | Windows Hello | Yes | No | `device/fido/win/authenticator.cc`, `supports_hmac_secret = true`; results at `create()` need API v8, so the follow-up `get()` is required |
| Any | CTAP2 security key with hmac-secret | Yes | No | standard |

Two consequences the earlier draft did not have. On macOS **no device-bound platform authenticator can answer**: the only candidates are synced passkey providers, so on a Mac the factor is as strong as the user's iCloud or Google account, and that is the main case rather than an edge. And a Mac user with neither provider set up is routed by Chrome to its own Touch ID authenticator, completes the prompt, and gets no PRF output — enrolment fails after a successful-looking ceremony, which needs a designed state. Linux is not empty either: Chrome reports a user-verifying platform authenticator when Google Password Manager passkeys are available to a signed-in profile.

**Whether a provider accepts an extension-origin RP ID is decided per provider, and two have been measured** (`prf-platform-matrix.md`, 2026-11-21, Chrome 158 on macOS 26.6.2). Apple Passwords accepts it: registration, assertion and a stable 32-byte PRF output, with user verification performed even when the request discourages it. 1Password, installed as a passkey provider, refuses it with "Unable to save passkey". Before that measurement the position was this: Chrome passes the rewritten RP ID to Apple's `relyingPartyIdentifier` verbatim, and a string containing `://` is not a domain. One first-hand third-party report (better-auth issue #11421, Chrome 153 on macOS, iCloud Keychain) says registration, authentication and a PRF evaluation all succeed with user verification set. No report was found for Windows Hello, a security key, or Google Password Manager from an extension origin, and none shows the output bytes. Both providers always create discoverable credentials, whatever `residentKey` asks for.

This is why task group 1 is a measurement spike with a written kill criterion, and why nothing else starts until it lands.

## Goals / Non-Goals

**Goals:**

- Remove the master password from the highest-frequency surface in the product without removing it from the product.
- Reuse the existing KEK. One KEK, one envelope, one verifier; the biometric path produces the same 32 bytes the password does and proves them the same way.
- Claim only what the cryptography delivers. The wrapping is opened by a secret; nothing else is presented as a gate.
- Keep the password where it is asked for: a biometric unlock opens the vault and satisfies nothing that asks for the password.
- Fail closed and fail visibly: every failure state is designed, the password is always named as the working alternative, and enrolment is disclosed on a surface the user sees.
- Be absent, not broken, where the platform cannot support it.

**Non-Goals:**

- No background verification of a WebAuthn assertion. See Decision 3 for why it was removed.
- No biometric re-authentication. The password-gated set stays exactly as it is: `vault.deleteKey` and the two `REAUTH_SETTINGS_FIELDS` timeouts through `requireReauth`; the three policy cases in `handlers/policy-rpc.ts` that call it — raising an origin to high trust, an allow kind rule, enabling a session grant; `vault.reveal`, which calls `revealKey(password, …)` directly; `vault.generate` and `vault.import`, through `kekForWrite(password)`; and `vault.changePassword`. A biometric ceremony produces no password, so every one of these refuses it with **zero new enforcement code**, and `tests/security/reveal-requires-password.test.ts` keeps passing untouched.
- No biometric route to key add or import. `kekForWrite` is password-only and stays so. The alternative — holding a live KEK on the service for the session — is the unbounded-authority mistake `reauth.ts` refuses by name.
- No cached "biometrically verified for N minutes" window.
- No Firefox. Firefox grants extension RP IDs only for host-permission **domains** (bug 1956484); `moz-extension://<id>` is bug 1693562, unconfirmed. The cross-browser route needs `host_permissions`, which `tests/security/manifest-assertions.test.ts` fails as a stated security regression.
- No Safari, **and no claim that Safari is impossible**. There is no Safari build script in `package.json`, so this is documentation risk only.
- No onboarding enrolment step. The create flow deliberately drops the password from memory at exactly the moment enrolment would need it.
- No multiple enrolled factors in v1. One factor plus the password covers the daily journey; an array is a later format-compatible extension.
- No change to `VAULT_VERSION`, `SUPPORTED_VAULT_VERSIONS`, `KDF_DEFAULTS`, `KDF_FLOORS` or any existing AAD. No existing ciphertext is re-encrypted.
- No new manifest permission, no `host_permissions`, no new CSP source, no new npm package.
- No activity-log entry for enrolment. `ActivityLogEntry.operation` is a signing-shaped union; the user-visible record is the lock-screen affordance appearing and the Security tab listing the factor.
- No `largeBlob`, no user-handle fallback, and no assertion-only gate that releases a stored key. Named as rejected so nobody retries them.

## Decisions

### Decision 1: One KEK, wrapped twice

There is exactly one KEK. The biometric path adds one more wrapping of the same 32 bytes.

```
UNCHANGED:

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

**Alternative rejected — store a separate biometric-derived KEK and re-wrap every DEK under it.** Two KEKs that must stay consistent across every key add and every password change.

**Alternative rejected — assertion-only gate that releases a stored plaintext key.** This is the CVE-2023-27706 pattern: Bitwarden stored the Windows biometric unlock key under DPAPI, retrievable by any process in the user session with no Hello ceremony. It is also the only thing Chrome's own Touch ID authenticator could support, since it has no PRF — which is why that authenticator is unsupported rather than accommodated.

**Alternative rejected — `largeBlob` instead of PRF.** It stores a blob rather than deriving a secret, so the wrapping key would have to be stored somewhere, which is the pattern above.

### Decision 2: HKDF, returning a key object rather than bytes

The 32-byte PRF output is input keying material, not a key. It is stretched with HKDF-SHA256 (empty salt, versioned purpose-bound info) into the wrapping key.

The port returns a **non-extractable `CryptoKey`** and never derived bytes:

```ts
deriveAeadKey(ikm: SecretBytes, info: Uint8Array, usages): Promise<CryptoKey>
```

**Rationale:** `src/domain/utils/memory.ts` can zeroize a `Uint8Array` and cannot zeroize a `CryptoKey`. Returning bytes would create a secret the codebase's own zeroization contract cannot honour. Returning a non-extractable key means the wrapping key never exists as a JS buffer at all. The existing AEAD adapter already imports its keys into `crypto.subtle`, so opening the wrapping with a `CryptoKey` adds a port method, not a second AES-GCM implementation, and `tests/security/crypto-single-implementation.test.ts` keeps its single match.

The wrapping must **not** be modelled as a `KdfParams` variant: `assertKdfAcceptable` rejects unknown algorithms, and that check is a security control for password derivation specifically. Widening it to admit a non-password algorithm would weaken it.

### Decision 3: One gate, and no assertion verification

The admission gate is that a key derived from the supplied PRF output opens `factor.wrapped`, and the result opens the envelope verifier. Nothing else is checked, and nothing else is claimed.

An earlier draft added a second gate: the background minted a single-use challenge, and verified the assertion's ECDSA P-256 signature, client data and authenticator-data flags before unwrapping, on the argument that "a captured PRF output alone unlocks nothing". That gate is removed, because the argument fails:

- The PRF salt is fixed per factor, so the PRF output is the same 32 bytes at every unlock. It is a static secret.
- Every input to `bioWrapAad` and the wrapping itself sit in `storage.local` in plaintext. So `PRF output + a copy of storage.local = KEK`, computed offline, with no background involved and therefore no challenge to satisfy.
- Every party able to capture a PRF output can read `storage.local`. An extension page reads it through `browser.storage` by default. Local malware reads the profile directory. There is no attacker who holds the output, lacks the storage, and can still send a UI-only RPC.
- The user-verified bit the gate checked is already enforced where it matters. CTAP2 hmac-secret keeps separate secrets for verified and presence-only ceremonies, and platform authenticators verify on every use, so a ceremony without verification does not yield the enrolled output. That is measured per authenticator class in the spike rather than assumed.

Against that, the gate cost an ECDSA port and adapter, three parsers over attacker-influenced bytes (`authenticatorData`, `clientDataJSON`, SPKI), a challenge store with its own lifetime and re-entrancy rules, two extra RPC methods, and five extra AAD fields whose only job was to protect the gate. Parsers on hostile input are attack surface; a gate that stops no attacker does not pay for them.

**What is true instead, and what the specs now say:** a PRF output is equivalent to the KEK for anyone who can read extension storage. It is revoked by forgetting the factor or changing the password, both of which delete the wrapping. It is strictly less exposed than the password it replaces on the lock screen — it is never typed, never visible to a shoulder or a camera, and exists in a document only for the length of one request.

**Alternative considered — rotate the PRF salt at every unlock**, evaluating `eval.first` for the current salt and `eval.second` for the next and re-wrapping, so a captured output expires at the next legitimate unlock. It narrows the window but does not close it: the capturing party takes a storage snapshot at the same moment. Not worth a write on every unlock in v1; recorded so it is not rediscovered as novel.

### Decision 4: The AAD binds the envelope and the credential

```
bioWrapAad = strField("ostrilo/vault-bio-wrap")
           | numField(envelope.v) | kdfFields(envelope.kdf)   // alg + costs + ENVELOPE SALT
           | numField(wrapperV)
           | field(credentialId) | field(prfSalt) | numField(hkdfInfoVersion)
           | numField(backupEligible ? 1 : 0)
```

`AAD_DOMAIN` gains a fourth entry, because the module's own rule forbids reusing a domain across uses — without it a wrapped-KEK blob could be accepted where a wrapped DEK is expected.

Binding the **envelope's** KDF fields and salt is what makes a rolled-back or swapped envelope break the wrapping by construction, rather than by a separate consistency check somebody could forget to call. The backup-eligible flag is read by the enrolling document from the flags byte of the registration `authenticatorData` (byte 32, bit `0x08`) — a single bounds-checked byte read, not a parser — and bound so a storage writer cannot make the Security tab show a synced credential as device-bound. It is reported by a document, not verified by the background, and is used only for disclosure. Mutable fields — `label`, `transports`, `createdAt`, `lastUnlockAt`, `lastPasswordUnlockAt` — stay outside, so touching them re-encrypts nothing.

### Decision 5: Unlock in a dedicated window, enrolment in the options tab

**Unlock** runs in `unlock.html`, opened with `browser.windows.create` on the `windows` permission already held. It renders the mascot, one line of context and one ghost Cancel; it holds no key list, asks the background for the credential id, PRF salt and transports (`vault.biometricUnlockRequest`), runs the ceremony on load, sends the output (`vault.biometricUnlock`), and closes itself when the RPC resolves. It is a **fifth key-handling document** and must join `KEY_HANDLING_DOCUMENTS`, which must become target-aware first: `tests/security/key-handling-bundle.test.ts` reads every listed document from every target's output with no guard, so a Chromium-only document crashes the suite with ENOENT rather than failing an assertion. The per-target expectation mirrors the existing `expectsSidePanelPermission` precedent in `manifest-assertions.test.ts`.

**Enrolment** runs in the options page. The earlier draft ran both ceremonies in `unlock.html` and collected the password in the options tab's `ReauthDialog`, which cannot work: `enroll` needs the password (for `kekForWrite`) and the PRF output in one operation; `key-material-isolation` forbids either crossing between documents or being staged in storage; and the background must not hold a KEK or a password while it waits two minutes for a ceremony in another window. Running the ceremony in the document that already holds the password satisfies all three with one request. The options page is a foreground tab, so it meets the visibility requirement, and it is already a key-handling document.

The cost is that the ceremony adapter is imported by two documents instead of one. The alternative — collecting the password inside the ceremony window — puts a password field in a second surface and duplicates `ReauthDialog`; it is the fallback only if the spike finds a foreground options tab cannot host a ceremony.

The popup flow is worth stating plainly, because it is the daily one: click the toolbar icon, click `Unlock with your device`, the popup closes as the window opens, complete the authenticator prompt, the window closes, reopen the popup. The spike times that against typing the password.

### Decision 6: A biometric unlock never stands in for the password

A biometric session records `authFactor: "biometric"` and can sign under existing policy. It cannot reveal, generate, import, delete, change the password, change the two security timeouts, raise an origin to high trust, set an allow kind rule, enable a session grant, or enrol a factor without the password — because every one of those asks for the password in any session.

That last clause is the point, and the reason this is not called reduced authority: a password-opened session is asked for the password by exactly the same operations. The two sessions can do the same things. The property is narrower and true — no path accepts a ceremony where the password is asked for.

`policy-rpc.ts` gates exactly three cases. Lowering a trust level, setting a deny or ask kind rule, disabling a session grant and `policy.removeOrigin` are **not** password-gated today, so either session can do them. This change does not widen that gate, and no surface or spec claims it does.

`authFactor` exists so the property can be *asserted by a test* and *explained by `ReauthDialog`*, not so it can gate anything — with one deliberate exception recorded in the Migration Plan: an **unrecognised** factor value reads as locked, while an **absent** one reads as a password session, so a session opened by the previous build is not force-locked on upgrade.

### Decision 7: Rehearsal, and a password-only first unlock per browser session

Two background-enforced availability and coercion controls:

- **30-day rehearsal.** `vault.biometricUnlock` is refused when no password unlock has happened in `PASSWORD_REHEARSAL_DAYS`. `vault.biometricStatus` reports it so the lock screen *withdraws the affordance and explains why*, rather than offering a button that fails.
- **First unlock after a browser restart or extension update is password-only.** Cheap, and it blunts the physical attacker at an unlocked machine with a security key left in the port, the coercion asymmetry (compelled biometrics versus compelled password disclosure), and rehearsal decay. It costs little against the real pain, which is re-unlocking after every auto-lock within a session.

Neither is a cryptographic control. The rehearsal timestamp lives in the factor record outside the AAD and the session marker lives in `storage.session`; a party that can write extension storage can move both. They defend the user against forgetting and against a person at the keyboard, and the specs say no more than that.

### Decision 8: A vault that needs the password once refuses the factor

Biometric unlock is refused, before the supplied output is evaluated, when any record is unversioned or when a `vaultRotation` journal is present. `recoverInterruptedRotation(password)` decides which of two journalled states is live by trying the password against each; a factor unlock has no password, and opening the stored envelope without recovering would run on whichever half-written state happens to be on disk. The next password unlock resolves both conditions. These refusals do not count against the unlock throttle: nothing secret was tested.

### Decision 9: Absent on Firefox, not disabled

`IS_CHROMIUM_BUILD` from `import.meta.env.BROWSER`, plus a WXT per-entrypoint target filter so `unlock.html` is not built for Firefox. No RPC methods registered, no Security section, no lock-screen button, asserted by a build-output test.

**Rationale:** `SecuritySettingsTab.tsx` sets the precedent explicitly — a control that cannot do anything is a promise the surface cannot keep.

## Risks / Trade-offs

- **A captured PRF output is the key** → For anyone who can also read extension storage, which is everyone able to capture it. Not defended against, and said plainly in the storage-format documentation. Revocation is forgetting the factor or changing the password. The exposure is narrower than the password's: never typed, never displayed, held in a document for one request.
- **Malware with code execution in the user's session** → Not defended against. It can load an extension with the same id, prompt the user itself, and keep the output.
- **On macOS the factor is a synced passkey** → iCloud Keychain and Google Password Manager return the same PRF output on every device signed in to the account, so the factor is as strong as that account rather than a local secure element. This is the main case on a Mac, not an edge. The backup-eligible flag is recorded, bound into the AAD, shown on the Security tab, and leads the enable-time copy.
- **A Mac with no passkey provider configured** → Chrome routes creation to its own Touch ID authenticator, the user completes a prompt, and no PRF output comes back. Enrolment writes nothing, says which kinds of authenticator work, and says a passkey entry may have been left behind. `PublicKeyCredential.signalUnknownCredential` is called where available; the web platform offers no guaranteed way to delete it.
- **A passkey provider that refuses the extension origin** → 1Password does, and it may be the first provider a user picks. No factor is created and nothing is left behind. Enrolment treats a ceremony that ends without a credential as retryable, and names the providers measured to work rather than only saying it failed. The list of working providers is copy that the platform matrix maintains, not something the code can detect.
- **User verification is not observable by the background** → It rests on the authenticator binding PRF output to verification. Measured per class in the spike; a class that leaks the output to a presence-only ceremony is not offered.
- **Silent enrolment by a document that has observed the password once** → No cryptographic fix exists. Mitigation is visibility: the lock-screen affordance appearing where the user never enrolled *is* the disclosure, and the Security tab lists the factor with its enrolment date.
- **Credential loss with no escrow** → A deleted passkey, a Hello PIN reset, or an extension-ID change destroys the secret permanently. Mitigated by the password being non-removable, by rehearsal, and by a designed "permanently unusable factor" state offering to forget it.
- **The PRF output crosses the message bus as `number[]`** → `runtime.sendMessage` structured-clones it into a copy neither side can zeroize. It is bounded by the message lifetime and is the same exposure `vault.unlock` already gives the master password.
- **Disclosing to a locked screen that a factor is enrolled** → Accepted: the affordance is the disclosure mechanism for silent enrolment, which is the larger risk. `biometricStatus` returns usability and the enrolment date, never the credential id or label. `biometricUnlockRequest` does return the credential id and salt to an extension page, because the ceremony cannot run without them; both are readable from storage by that page anyway.
- **Extension downgrade** → An older build predating this code can read and rewrite `storage.local`. It will not delete `vaultBiometric` when it writes an envelope; the wrapping is bound to the envelope's salt, so a stale record cannot open a rotated vault, and it surfaces as the permanently-unusable state.
- **Multiple machines** → `storage.local` does not sync, so a user with a laptop and a desktop enrols twice, even when the passkey itself syncs.
- **Scope** → Smaller than the earlier draft by the assertion gate: no ECDSA, no parsers, no challenge store. Still spans domain, application, infrastructure, extension, UI, tests and docs, with 13 delta specs, because the platform guards cannot be deferred without breaking `pnpm run test:build-output`.

## Migration Plan

No data migration. Nothing existing is read differently, rewritten or re-encrypted; `vaultBiometric` simply does not exist until a user enrols.

- **Forward:** a vault with no factor record behaves exactly as today. Enrolment requires the password and an unlocked, fully-versioned vault.
- **Legacy vaults and interrupted password changes:** refuse both enrolment and biometric unlock, and say the vault must be opened once with the password first (Decision 8).
- **Upgrade with a live session:** a session opened before this change records no `authFactor`. An absent value reads as `password`, so no live session is force-locked on upgrade. An unrecognised value reads as locked.
- **Rollback:** delete the `vaultBiometric` record. `forget()` requires no credential and is reachable while locked, so a user locked out of a dead authenticator is never stuck. The envelope, every key record and the password are untouched.
- **Envelope writes delete the factor.** Implemented in `saveEnvelope`, removing the factor record before the envelope is written, so an interruption between the two leaves no factor rather than a stranded one. `saveEnvelope` is the single writer on every path that matters: envelope creation in `kekForWrite` and `unlockNow`, `commitRotation`, and both branches of `recoverInterruptedRotation`.

## Open Questions

- **Does any PRF-capable authenticator answer a `chrome-extension://<id>` relying-party identifier, on which platforms?** Resolved by task group 1 against the kill criterion in the proposal. Everything downstream is contingent on it.
- **Can a foreground options tab host the enrolment ceremony?** Expected yes — it is a visible `WebContents`. If not, enrolment moves into the created window and that window collects the password.
- **What makes a factor "permanently unusable", observably?** A missing credential is indistinguishable from a cancelled prompt. Proposed definition: the authenticator returned an output and the wrapping failed authenticated decryption — which means the credential or the envelope is not the one enrolled against. Measured for Apple Passwords on 2026-11-25 (`prf-platform-matrix.md`): with the passkey deleted, Chrome offers the phone-or-tablet QR prompt, and dismissing it rejects with the same `NotAllowedError` a cancelled Touch ID prompt gives. So a deleted credential never reaches the permanently-unusable state; the user sees the cancelled state every time. The lock screen therefore offers to forget the factor after the second consecutive ceremony that ended without an output, which costs nothing because forgetting needs no credential. Other authenticator classes are still to be measured.
- **Does `residentKey: "discouraged"` change anything?** Both synced providers create discoverable credentials regardless, which leaves a visible passkey entry the user can delete. The spike records what each provider shows the user.
