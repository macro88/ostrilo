## Why

A dApp that wants to know what Ostrilo can do has one tool today: probe `window.nostr` for a property, which is how it learns `nip44` is absent. That works for NIP-07 namespaces but gives a page no explicit, stable statement of which methods the signer implements, and no place to hang future additions. Phase 0.10 (DEV-013) adds a read-only `window.nostr.capabilities` object so a dApp can feature-detect without calling a method and interpreting its failure.

The same phase (DEV-010) defines what Ostrilo promises dApp authors: which surfaces are public API, how versions map to it, and how a change is announced. `docs/api-versioning.md` records that policy.

## What Changes

- **`window.nostr.capabilities`**, a frozen `{ methods: string[] }`, where `methods` lists exactly the provider methods Ostrilo implements (today `getPublicKey` and `signEvent`). It carries no extension version, build identifier or any other value that would help a page fingerprint the user's setup.
- **One list feeds both.** `PROVIDER_METHODS` in `src/domain/nostr/provider-methods.ts` is the list the injected provider is built from (the compiler rejects an implementation that is missing from or extra to it), the list `capabilities.methods` reports, and the list the content script's allowlist checks. A method added to or removed from the list changes the provider and what a dApp is told in the same edit; the relay's `buildRpcRequest` switch is exhaustive over it, so a missing relay case fails to compile (and at runtime fails closed with `unknown_method`).
- **The page cannot alter it.** `capabilities` and its `methods` array are frozen, and the provider object stays frozen and non-writable, non-configurable on `window`.
- **An existing `window.nostr` is still left in place.** Ostrilo defines nothing, `capabilities` included, when another signer got there first, so a dApp must treat an absent `capabilities` as "unknown" rather than "none".
- **`docs/api-versioning.md`** states the public API surface, the semver mapping, the deprecation policy (a `Deprecated` CHANGELOG entry, removal no earlier than the next major release, `BREAKING (API)` for a breaking change) and what is not public (the extension's internal RPC namespaces). It is linked from `docs/README.md` and `docs/developers_readme.md`, and the developer guide gains a feature-detection snippet.

Not changed: the error codes and response shape, the messages between the injected and content scripts, the HTTPS-only injection, and every consent, policy and approval rule. `nip04` and `nip44` stay absent.

This change adds requirements only. It does not modify the `Truthful Capability Advertisement` requirement in `provider-trust-boundary`, and it does not touch the requirement that `meter-auto-signed-requests` adds to `nip07-provider`, so the two changes apply independently in either order.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `nip07-provider`: adds the capabilities object and the rule that one list feeds the provider and what it advertises.
- `provider-trust-boundary`: adds the rule that `capabilities` is tamper-resistant and carries no fingerprinting data.

## Impact

**Code**
- `src/domain/nostr/provider-methods.ts` (new): the method list, its type and a guard.
- `src/extension/injected.ts`: builds the provider from the list and adds the frozen `capabilities`.
- `src/extension/content.ts`: its allowlist uses the same guard.

**Tests:** `tests/unit/extension/injected-capabilities.test.ts`, `tests/security/provider-capabilities.test.ts`, and a case in `tests/e2e/nip07-provider.spec.ts`.

**Docs:** `docs/api-versioning.md` (new), `docs/README.md`, `docs/developers_readme.md`.

**Behaviour dApps will notice:** `window.nostr.capabilities` exists. Nothing that worked before changes.
