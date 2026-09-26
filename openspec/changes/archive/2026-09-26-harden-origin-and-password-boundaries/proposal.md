## Why

A competitor review (nostr-wot-extension v0.8.3, 2026-09-25) ran the same security audit against Ostrilo and turned up defects at two boundaries this project already claims to enforce. Each was confirmed against the source before this proposal was written.

**The password gate on per-kind `allow` rules can be walked around.** `key-vault` requires re-authentication for "changing a per-kind rule to `allow`", and `policy.setKindRule` enforces it (`policy-rpc.ts:148`). `policy.setOrigin` does not: its patch schema accepts `rules` and `identityDisclosure` (`schemas.ts:48-56`), and the handler asks for a password only when `trustLevel === "high"` (`policy-rpc.ts:104`). One message carrying `{ rules: { "0": "allow", "3": "allow" }, identityDisclosure: "allow" }` persists silent profile and contact-list rewrites for a site without a password. The shipped UI sends only `trustLevel` and `identityDisclosure: "ask"` through this method (`useAppSettings.ts:209, 229`), so the rest of the patch is surface with no caller.

**The background believes the page origin the message tells it.** The content script sets `origin` from `window.location.origin`, which is correct, but `nostr-rpc.ts:110, 345` then use `message.origin` and nothing ever compares it with the browser-attested `sender.url`. Every per-origin decision — consent, trust level, rate limit, the origin shown in the approval window — rests on a value any code in the content-script process can write. Exploiting it needs a compromised renderer; the competitor derives the origin from `sender.url` and so does not have this gap.

**The unlock throttle guards one door of several.** `vault.unlock` is throttled (`vault-rpc.ts:143`). `requireReauth` (`reauth.ts:43`), `vault.reveal`, and `vault.generate` / `vault.import` against an existing vault each verify the master password with no backoff, and the last three are reachable while locked (`rpc-router.ts:113-128`). The throttle bounds guessing only on the path an attacker has no reason to use.

Three smaller defects travel with these, because they sit on the same paths:

- `unlock()` calls `this.unlocked.clear()` without zeroizing what the map holds (`key-vault.service.ts:615`), unlike `lock()` (`:768-769`).
- In `lock()`, a failing `storage.sync` write of the `sessionGrantAll` display flags throws before the lock listeners run (`:781-810`), so pending approvals can survive a lock — contrary to `session-auto-lock`'s "Pending Approvals Do Not Survive A Lock".
- KDF parameters read from a backup file or from vault storage are checked against a floor but not a ceiling (`key-backup-envelope.ts:186-195`; `key-vault.service.ts:117-130`). A crafted file with `m` in the gigabytes stalls or crashes the context that opens it.

## What Changes

- **BREAKING (RPC)** Narrow `policy.setOrigin` to `name`, `trustLevel` and `identityDisclosure`. `rules`, `sessionGrantAll` and `updatedAt` are removed from the patch: per-kind rules go through `policy.setKindRule` and session grants through `policy.setSession`, both of which already require the password where it matters, and `updatedAt` is the service's to set. A patch carrying a removed field fails with `invalid_params`.
- Require password re-authentication for `identityDisclosure: "allow"` through `policy.setOrigin`, as for `trustLevel: "high"`. Tightening to `ask` or `deny` stays password-free.
- Bind the `nostr` namespace's origin to the sender in the background: derive it from `sender.url` for a top-frame sender from this extension, compare it with the origin the content script sent, refuse a mismatch or an unattestable sender with `invalid_origin`, and pass only the derived origin to the handlers.
- Route every master-password verification — unlock, re-authentication, reveal, and generate or import against an existing vault — through the one persisted unlock throttle, checked before any key derivation, with failures counted against the same counter.
- Zeroize held key material before `unlock()` replaces it.
- Make `lock()` run its listeners even when the settings write fails, while still reporting the failure.
- Add ceilings to KDF parameters accepted from a backup file or vault storage, refused before derivation.
- Require a verified extension-page sender for the `ostrilo.openApprovalWindow` command, which today answers any runtime message (`background.ts:382-396`).
- Correct `docs/extension-manifest.md`, which says sync storage holds only `isDocked`, lists `alarms` as pending, and omits `idle`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `provider-trust-boundary`: the background derives the requesting origin from the browser-attested sender rather than accepting it from the message.
- `rpc-privilege-boundary`: extension-internal commands outside the RPC router require the same verified extension-page sender as UI-only namespaces.
- `consent-scope-integrity`: the origin-policy patch can no longer write per-kind rules or session flags, and cannot grant disclosure consent without the password.
- `unlock-throttling`: the throttle covers every master-password verification path, not only `vault.unlock`.
- `key-vault`: re-unlock zeroizes the key material it replaces.
- `session-auto-lock`: a failed settings write does not stop the lock listeners.
- `vault-key-derivation`: KDF parameters read from storage are bounded above as well as below.
- `secure-key-backup`: KDF parameters read from a backup file are bounded above as well as below.

## Impact

- `src/infrastructure/messaging/rpc-router.ts`: sender-bound origin for the `nostr` namespace; `isTrustedExtensionSender` reused by the background command listener.
- `src/infrastructure/messaging/handlers/nostr-rpc.ts`: handlers consume the bound origin only.
- `src/infrastructure/messaging/handlers/policy-rpc.ts`, `src/infrastructure/validation/schemas.ts`, `src/infrastructure/messaging/client.ts`: narrowed `OriginPolicyPatchSchema` and its callers.
- `src/infrastructure/messaging/reauth.ts`, `src/infrastructure/messaging/handlers/vault-rpc.ts`: throttle applied to all password verification.
- `src/application/services/key-vault.service.ts`: zeroize-before-clear, `lock()` listener ordering, KDF ceiling.
- `src/domain/types.ts`: a `KDF_CEILINGS` constant next to `KDF_FLOORS`.
- `src/ui/features/onboarding/backup/key-backup-envelope.ts`: ceiling check on import.
- `src/extension/background.ts`: sender check on `ostrilo.openApprovalWindow`.
- `tests/security/`: new or extended suites for each boundary, including a `setOrigin` case in `reauth-boundary.test.ts`, which today tests only `trustLevel`.
- Docs: `docs/extension-manifest.md`, `docs/rpc-architecture.md` (origin binding), and the `docs/roadmap.md` rows these close, coordinated with the roadmap reconciliation in progress.
- No new dependency, permission, or network behaviour.
