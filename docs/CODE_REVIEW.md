
# Ostrilo Code Review and Architecture Proposal

## Executive summary

This review aligns the current extension with the product docs under `/docs` and proposes a clean, testable architecture following React best practices and SOLID/DRY principles. The north star is: background-first security (all key usage confined to BG), pure-domain utilities, explicit boundaries, and predictable state via small composable stores. A phased implementation plan is provided.


## Requirements alignment (from docs)

- Security & scope
  - NS-F-002 Background-only signing: All signing and key ops in BG; UI never touches plaintext.
  - NS-N-001 Crypto suite: Noble secp256k1 + SHA-256, WebCrypto AES-GCM, Argon2id/PBKDF2.
  - NS-N-003 Zeroization: Overwrite secrets on lock/unload.
  - Encrypted at rest; random salt/iv per key.
- UX & flows
  - Onboarding: Import/generate; password; backup; selected active key.
  - Lock/unlock with auto-lock; session grant TTL.
  - Settings and per-origin policy with trust defaults and per-kind overrides.
- Testability & ops
  - Unit tests for crypto and policy evaluation; E2E for flows; lint/type; CI.


## Current state (high-level)

Strengths:

- Clear separation of storage types: encrypted keys (local), settings (sync), lock meta (session).
- Context-based lock state with session persistence; fewer effects; `useSyncExternalStore` for settings.
- Crypto helpers centralized; onboarding flows implemented.

Gaps vs requirements:

- BG-only signing not fully enforced. Unlock/keys are still handled in UI context; plaintext may exist in popup memory.
- Policy evaluation logic is not centralized as a pure engine with tests.
- Storage access is direct to `browser.storage` from UI; no thin abstraction for testing.
- Tests are missing; crypto/policy/utilities aren’t covered.
- Adapters and interfaces for SOLID boundaries (crypto, storage, policy, approval queue) are not yet defined.


## Recommended architecture

A layered, background-first architecture with explicit boundaries:

- Domain (pure, no side effects)
  - Types: KeyRecord, OriginPolicy, AppSettingsV1, Authorisation, TrustLevel.
  - Pure utilities: bech32/hex normalize/validate, npub/nsec encode/decode, policy evaluation engine.
  - Crypto core: KDF, AES-GCM, Schnorr/secp256k1 primitives (wrap noble + WebCrypto) exposed via interface.

- Application services (imperative, orchestrate domain)
  - KeyVaultService (BG): holds decrypted keys in memory only after unlock; exposes RPC for getPublicKey, signEvent, list/generate/import/export, lock; handles zeroization and auto-lock timers.
  - PolicyService (BG): computes allow/deny/ask given origin/kind and state; maintains session grants; logs decisions.
  - SettingsService (BG): versioned settings with atomic writes and migrations; emits change events.
  - ApprovalQueue (BG): queues sign requests; interacts with UI prompts.

- Infrastructure (adapters implementing interfaces)
  - Storage: LocalStorageAdapter, SyncStorageAdapter, SessionStorageAdapter (wrap `browser.storage.*`).
  - Crypto: WebCryptoAesGcmAdapter (AES-GCM), KdfAdapter (PBKDF2/Argon2id), NobleSchnorrAdapter.
  - Messaging: RPC over `browser.runtime` ports/messages with a thin typed layer.

- Presentation (React UI)
  - Components/View models subscribe to small stores via `useSyncExternalStore` and call BG RPCs.
  - UI owns no secret material; shows derived state (locked/unlocked, active key id, policy previews, queue items).

Key principles

- SOLID
  - SRP: Separate policy evaluation from persistence/mutation.
  - OCP: Add new policies/algorithms via interfaces with minimal edits.
  - LSP: Swappable adapters (e.g., PBKDF2 → Argon2id).
  - ISP: Small interfaces (CryptoKdf, CryptoAead, Schnorr) rather than one big crypto util.
  - DIP: React consumes services via interfaces (context or simple DI), not concrete `browser.*` APIs.
- React best practices
  - Prefer derived state and `useSyncExternalStore` stores for shared state.
  - Effects only for subscriptions/timers/IO; everything else pure/memoized.
  - Keep hooks thin; call services, not the platform directly.
- Security
  - Secrets only live in BG memory; zeroize on lock/unload and on timer.
  - UI communicates via RPC; no plaintext crossing message boundaries.


## Suggested folder structure

```text
src/
  domain/
    crypto/
      aes.ts          // interface + pure wrappers
      kdf.ts
      schnorr.ts
    policy/
      evaluate.ts     // pure function + tests
    types.ts
    utils/
      bech32.ts
      encoding.ts
  application/
    services/
      key-vault.service.ts
      policy.service.ts
      settings.service.ts
      approval-queue.service.ts
    ports/
      storage.ts      // interfaces for storage operations
      crypto.ts       // interfaces for crypto ops
  infrastructure/
    storage/
      local.adapter.ts
      sync.adapter.ts
      session.adapter.ts
    crypto/
      webcrypto-aes.adapter.ts
      pbkdf2.adapter.ts
      argon2id.adapter.ts (optional)
      noble-schnorr.adapter.ts
    messaging/
      rpc.ts          // typed request/response
  extension/
    background/
      index.ts        // compose services + rpc handlers
    content/
      index.ts
    provider/
      nip07.ts        // page provider (PV)
  ui/
    components/
    hooks/
      useSettings.ts  // wraps store from BG
      usePolicyPreview.ts
    state/
      settings.store.ts // useSyncExternalStore with BG events
      lock.store.ts
```

Note: With WXT, keep `entrypoints/*` but organize code into `src/*` and import from there.


## Service contracts (tiny specs)

- CryptoAead
  - `encrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array>`
  - `decrypt(…): Promise<Uint8Array>`
- CryptoKdf
  - `deriveKey(password: Uint8Array, salt: Uint8Array, params): Promise<CryptoKey>`
- Schnorr
  - `getPublicKey(sk: Uint8Array): Promise<Uint8Array>`
  - `sign(hash32: Uint8Array, sk: Uint8Array): Promise<Uint8Array>`
- StoragePort
  - `get\<T\>(key: string): Promise<T | undefined>`
  - `set\<T\>(key: string, value: T): Promise<void>`
  - `remove(key: string): Promise<void>`
- KeyVaultService
  - `unlock(password: string): Promise<{ selectedKeyId?: string }>`
  - `lock(): Promise<void>`
  - `getPublicKey(): Promise<string>`
  - `signEvent(evt: NostrEvent): Promise<string>`
  - `generateKey(label?: string): Promise<KeyRecord>`
  - `importKey(nsecOrHex: string, label?: string): Promise<KeyRecord>`
  - `listKeys(): Promise<KeyRecordMeta[]>`  // no secret
  - `selectKey(id: string): Promise<void>`
- PolicyService
  - `evaluate(origin: string, kind: number): { mode: Authorisation; reason: EvalReason }`
  - `setOriginPolicy(origin: string, patch: Partial<OriginPolicy>): Promise<void>`
  - `setPerKindRule(origin: string, kind: number, mode: Authorisation): Promise<void>`
  - `clearSessionGrant(origin: string): Promise<void>`


## Testing strategy

- Unit tests (Vitest)
  - Crypto: AES-GCM round-trip, PBKDF2 vectors, Schnorr pubkey/sign vectors. Use Node’s `crypto.webcrypto` or a polyfill in test env.
  - Policy engine: table-driven tests for precedence (deny wins, session grant, trust defaults, fallback).
  - Encoders: bech32/nsec/hex validation and normalization.
  - Storage adapters: mock `browser.storage` with in-memory map; verify atomic set/remove and event fanout.
- Integration tests
  - KeyVaultService with in-memory adapters; verify lock/unlock, zeroization, auto-lock timer, selection.
  - SettingsService migrations: version bump upgrade path.
- E2E (Playwright)
  - Onboarding generate/import; unlock; auto-lock; per-origin policy; signing prompts.
- CI
  - Run `typecheck`, `lint`, `vitest`, extension static build. Optional size budget on BG bundle.


## Implementation plan (phased)

Phase 1 — Domain hardening and tests

- Extract domain modules: `domain/types.ts`, `domain/policy/evaluate.ts` (pure), crypto interfaces.
- Write unit tests for policy/evaluate and encoders.
- Introduce test setup that provides `globalThis.crypto = require('node:crypto').webcrypto` in Vitest.

Phase 2 — Adapters and services in BG

- Implement storage adapters (local/sync/session).
- Implement Crypto adapters (PBKDF2 + AES-GCM using WebCrypto; noble schnorr).
- Implement `KeyVaultService` in BG: load encrypted keys, unlock to memory, zeroize on lock/timeout, sign in BG only.
- Implement `PolicyService` with session grants and logging.
- Establish typed RPC (request/response schemas) for UI <-> BG.

Phase 3 — UI ports and state stores

- Replace direct storage usage in UI: `useSettings` subscribes to BG SettingsService via events; keep `useSyncExternalStore` stores.
- Replace key operations in hooks with RPC calls to `KeyVaultService` (no secrets in UI).
- Add Policy preview hook that calls BG for evaluate() with a dry-run flag.

Phase 4 — Onboarding and settings alignment

- Onboarding: invoke BG `generateKey`/`importKey` + `unlock`; ensure backup confirm logic.
- Settings: per-origin editor wired to `PolicyService` methods; session grant toggles and TTL.

Phase 5 — Hardening & QA

- Zeroization audits; ensure no secret copied to strings.
- Add activity log (BG) with ring buffer; UI list subscribes.
- Add lint rules for forbidden imports (UI cannot import crypto adapters or local storage directly).
- Add CI with type/lint/test/build and optional size budgets.


## Risks and mitigations

- BG lifecycle (service worker sleep): Persist lock meta in `storage.session`; refresh auto-lock timers on wake; keep secrets only in memory, never in storage.
- WebCrypto availability in tests: use Node’s `crypto.webcrypto`; fall back to polyfill if needed.
- RPC complexity: Keep a single `rpc.ts` with discriminated unions; add exhaustive switch and runtime validation (zod optional).
- Migration safety: Versioned settings; merge defaults conservatively; backups on significant schema changes.


## Immediate, low-risk improvements

- Keep `useSyncExternalStore` for settings/lock/meta stores; avoid effects for derivations.
- Introduce a tiny `browserApi` facade for `browser.storage` and `runtime` to simplify mocking.
- Add unit tests for existing crypto helpers today (vectors + round-trips) without moving code yet.


## Appendix: example test skeletons

AES-GCM round-trip

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { encrypt, decrypt, deriveKey } from '@/lib/crypto';

beforeAll(() => {
  // @ts-expect-error
  globalThis.crypto = require('node:crypto').webcrypto;
});

describe('AES-GCM', () => {
  it('round-trips', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey('password', salt);
    const pt = new TextEncoder().encode('hello');
    const ct = await encrypt(key, iv, pt);
    const rt = await decrypt(key, iv, ct);
    expect(new TextDecoder().decode(rt)).toBe('hello');
  });
});
```

Policy evaluation table

```ts
import { evaluate } from '@/domain/policy/evaluate';

type C = { origin: string; kind: number; unlocked: boolean };

test.each<[{c:C, expectMode:string}]>([
  [{ c: { origin:'https://app', kind:1, unlocked:false }, expectMode:'locked' }],
])('policy %o', ({ c, expectMode }) => {
  const out = evaluate(c.origin, c.kind, c.unlocked);
  expect(out.mode).toBe(expectMode);
});
```


## Conclusion

This plan moves Ostrilo to a background-first, testable architecture with clear boundaries and React best practices. It preserves existing UI flows while tightening security and maintainability. The phases are incremental and can land as small PRs with growing test coverage.
