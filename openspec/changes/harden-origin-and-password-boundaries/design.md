## Context

Each of these defects lives at a boundary another spec already describes, and each leaves the boundary open in a way that spec does not intend. The fixes are small, but they share one principle: **a security decision takes its inputs from what the browser attests or the background derived, never from what the caller claims.**

Current state, confirmed against `main` at `53c91fe`:

- **Origin.** `createRpcMessageListener` (`rpc-router.ts`) receives `sender` and uses it for exactly one purpose: `isTrustedExtensionSender` on privileged namespaces. `nostr.*` messages are dispatched with `sender` dropped, and `NostrRpcHandler` reads `message.origin` in nine places (`nostr-rpc.ts:103-110, 311-499, 594`). The content script's own origin handling is correct (`provider-trust-boundary`, "Page Realm Decides Nothing Security-Critical"). The gap is the hop after it.
- **`policy.setOrigin`.** `OriginPolicyPatchSchema` accepts `name`, `trustLevel`, `rules`, `sessionGrantAll`, `identityDisclosure` and `updatedAt`. The handler re-authenticates only for `trustLevel === "high"`, so `rules` bypasses the password `policy.setKindRule` demands. `sessionGrantAll` is a display flag that `PolicyService` recomputes from real grants, so writing it achieves nothing but confusion. The shipped UI sends `trustLevel`, `identityDisclosure: "ask"` and `name`. The design-review runner additionally sends `identityDisclosure: "allow"` and `"deny"`, with the password where it raises trust.
- **Password verification.** `UnlockThrottleService` is persisted in `storage.local`, checked before derivation, and consulted only by `handleUnlock`. `requireReauth` → `vault.verifyPassword`, `vault.revealKey`, and `generateKey` / `importKey` → `kekForWrite` all open the envelope with the supplied password unthrottled.
- **`unlock()`** clears `this.unlocked` without zeroizing it. The map is normally empty at unlock, but not after a re-unlock issued while unlocked, which is reachable because `vault.unlock` is lock-reachable in every state.
- **`lock()`** zeroizes keys, writes the lock state, removes session grants, then does a `getSettings` + `storage.sync.set` that can throw (quota, sync disabled, a corrupt record), and only then runs listeners. The approval-queue teardown is a listener.
- **KDF parameters** read from storage and from backup files are floor-checked only.
- **`ostrilo.openApprovalWindow`** is a second `onMessage` listener in `background.ts` that answers any sender.

## Goals / Non-Goals

**Goals:**

- The origin every `nostr.*` handler sees is derived from the browser-attested sender, and a disagreement with the content script's claim is refused.
- There is exactly one path to each kind of authority in the policy RPC, and each carries the password requirement `key-vault` already states.
- No master-password check anywhere in the background is an unthrottled oracle.
- The three smaller defects are closed with tests that read real state.

**Non-Goals:**

- **Moving `appSettings` out of `storage.sync`.** Origin policies replicate across a user's synced browser profiles, so a grant made on one profile applies on another without that profile's password. The product owner decided on 2026-09-26 to make these settings device-local. That work is its own change, `localize-authority-settings`, so this one stays small.
- **Defending `storage.local` / `storage.sync` against a compromised renderer.** Both areas are writable from content-script contexts unless `setAccessLevel` restricts them, which Chrome supports only for `storage.session`. Any fix here is a storage-architecture change. This change removes the message-level trust in the page origin; it does not claim to stop an attacker with arbitrary code in the content-script process from editing storage directly.
- **Re-authenticating the approval prompt's "Remember".** A remembered allow is a decision made at the moment of signing, on a surface the page cannot drive, and `site-signing-policies` specifies it without a password. That is left alone.
- **Per-key consent, a follow-list guard, and an encrypted activity log.** These came out of the same review, but they are new behaviour, not defects. They are roadmap rows.
- **Raising the Argon2id work factor.** A separate tuning decision governed by `vault-key-derivation`'s responsiveness requirement.

## Decisions

### 1. Bind the page origin in the router, before dispatch

The router listener already holds `sender`, and it is where the privilege boundary lives. For the `nostr` namespace it will:

1. Require `sender.id === runtime.id`: our own content script, not another extension's page.
2. Require a tab sender in the top frame (`sender.tab` present and `sender.frameId === 0`). The content script is top-frame only, so a subframe sender is not a legitimate caller.
3. Parse `sender.url` and take its origin. Where the browser also supplies `sender.origin` (Chromium), it must agree.
4. Require `https:`, matching the content script's match pattern.
5. Require the derived origin to equal `message.origin`, then overwrite `message.origin` with the derived value before dispatch.

Any failure returns `invalid_origin` without touching a service, and without charging the per-origin rate limit, since there is no trustworthy origin to charge.

The pure decision goes in a function beside `isTrustedExtensionSender`, e.g. `attestPageOrigin(sender, runtimeId, claimed)`, so it is unit-testable without a browser.

*Alternative: pass `sender` into `NostrRpcHandler` and let each handler derive the origin.* Rejected. It spreads the rule across three handlers, and one handler forgetting is the same defect back again. The router is the only place that sees every page request.

*Alternative: ignore `message.origin` entirely and use only `sender.url`.* Rejected in favour of compare-then-overwrite. A mismatch between what the content script saw and what the browser attests means something is wrong (a navigation race or a tampered process), and refusing is the right response. Silently substituting would hide it.

### 2. Narrow `setOrigin` instead of adding more gates

Remove `rules`, `sessionGrantAll` and `updatedAt` from `OriginPolicyPatchSchema` (it is a `strictObject`, so they become `invalid_params`). Keep `name`, `trustLevel` and `identityDisclosure`. Re-authenticate when the patch sets `trustLevel: "high"` **or** `identityDisclosure: "allow"`: each grants authority that is used silently from then on.

Make the handler's re-auth predicate a named function (`patchGrantsAuthority(patch)`), mirroring `patchNeedsReauth` for settings. That gives the security test one thing to enumerate against the schema's fields, so a field added to the schema later without a decision about re-auth fails a test.

*Alternative: keep `rules` and re-authenticate when any rule is `allow`.* Rejected. Two paths to the same state, with two sets of validation, is how this defect arose. `setKindRule` is already the one path, and nothing ships that uses the other.

### 3. One throttle, charged by every password check

Extract a helper beside `requireReauth`, e.g. `withPasswordThrottle(context, method, fn)`. It calls `unlockThrottle.check()` before `fn` and returns `rate_limited` with the remaining wait. It calls `recordFailure()` when `fn` throws `incorrect_password`, and `recordSuccess()` when `fn` succeeds. `handleUnlock`, `requireReauth`, `handleReveal`, and `handleGenerate` / `handleImport` when a vault already exists all use it.

The counter is shared, not per-method. It is one secret; an attacker who has used up the unlock attempts must not be able to switch to `vault.reveal` for fresh ones.

A verified success resets the counter on any path, as a successful unlock does today. Proving the password on one path is proof of it on all.

First-key `generate` / `import` (no vault yet) verifies nothing, so it is not charged.

*Alternative: separate, lower budgets for re-auth.* Rejected as complexity without benefit. The backoff schedule already leaves typos free, and every path guards the same password.

### 4. Zeroize before clear in `unlock()`

`this.unlocked.forEach(zeroize)` before `this.unlocked.clear()`, as `lock()` already does. `memory-zeroization.test.ts` gains a re-unlock case that holds a reference to the first unlock's buffer and asserts every byte is zero.

### 5. `lock()` runs its listeners in `finally`

The security-critical steps — zeroize, write the lock state, remove session grants — stay first and unconditional. The settings display-flag write and the broadcast move into a `try`, and the listeners into its `finally`, so a sync failure still tears down the approval queue and clears the badge. The error propagates after the listeners, so the failure is not swallowed.

### 6. KDF ceilings

Add `KDF_CEILINGS` beside `KDF_FLOORS` in `src/domain/types.ts`, and check both in `assertKdfAcceptable` and in `deserializeKdf`. Proposed values, to be confirmed against the benchmark in `vault-key-derivation`'s "Unlock Remains Responsive" requirement:

| Parameter | Floor (today) | Ceiling (new) | Shipped default |
|---|---|---|---|
| Argon2id `m` (KiB) | 19456 | 262144 (256 MiB) | 19456 |
| Argon2id `t` | 2 | 10 | 2 |
| Argon2id `p` | 1 | 4 | 1 |
| PBKDF2 `c` | 600,000 | 5,000,000 | not written for new material |

The ceilings sit well above anything the product writes, so no legitimate record is refused. A record above the ceiling fails like one below the floor: `kdf_above_ceiling` in the vault, and the generic `BACKUP_DECRYPT_FAILURE_MESSAGE` for a backup file, because a file is untrusted input and the message must not help an attacker probe it.

### 7. `ostrilo.openApprovalWindow` takes the extension-page check

The listener in `background.ts` calls `isTrustedExtensionSender(sender, …)` and ignores anything else. Its only caller is `ActivityView`, an extension page.

## Risks / Trade-offs

- **[A legitimate request refused on a navigation race]** A page that calls `signEvent` while navigating cross-origin can have `sender.url` reflect a different origin from the one the content script saw. → The refusal is `invalid_origin`, and the page that sent it is gone. Same-document navigations (`pushState`, hash changes) keep the origin, so SPA routing is unaffected. An e2e case covers `pushState` before a request.
- **[Firefox `sender` shape]** Firefox supplies `sender.url`, `sender.tab` and `sender.frameId` for content-script messages but not `sender.origin`. → Treat `sender.origin` as an extra check when present, never as required. Both builds run the new e2e case.
- **[The shared throttle can lock a user out of re-auth after mistyped unlocks]** → Intended. It is the same password and the same backoff schedule, and the lock screen already explains the wait. The re-auth dialog must render `rate_limited` with its remaining time rather than "incorrect password"; that is a task.
- **[Breaking `setOrigin` for out-of-tree callers]** Scratch agent-loop specs or local scripts may send `rules` through `setOrigin`. → CI never runs scratch specs. The in-tree callers (UI, design-review runner, tests) are updated in this change, and `invalid_params` names the offending field.
- **[Ceilings chosen too low]** → The table sits more than 13× above the default memory cost. If `add-biometric-unlock` or a later tuning raises defaults, `KDF_CEILINGS` moves with it, and a test asserts `KDF_DEFAULTS` sits between `KDF_FLOORS` and `KDF_CEILINGS`.

## Migration Plan

No stored data changes shape. Existing `OriginPolicy` records that hold `rules` keep them: only the write path narrows. Rollback is a revert.

## Open Questions

- ~~Should origin policies stay in `storage.sync`?~~ Decided 2026-09-26: no. See `localize-authority-settings`.
- **Exact ceiling values.** Confirm against a measured Argon2id run at 256 MiB in the Chrome and Firefox service workers before merging. If it cannot finish within the responsiveness budget, lower `m`.
