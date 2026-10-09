## 1. Policy model

- [x] 1.1 `OriginPolicy.identityDisclosureKeyIds`; `PendingRequest.signingKeyId`
- [x] 1.2 `PolicyService`: `grantIdentityDisclosure`, `revokeIdentityDisclosureKey`, `getIdentityDisclosure(origin, keyId)`; `setIdentityDisclosure` takes `deny`/`ask` and drops key grants; `setOriginPolicy` ignores an `allow` and a key list in a patch
- [x] 1.3 Consent migration step 2 (version 2), `migrate()`, called at worker start in `background.ts`
- [x] 1.4 Unit tests: grant, add a second key, no duplicates, revoke one and the last, refusal covers every key and drops grants, patch cannot grant, every malformed stored shape answers no decision, migration cases (bound to the selected key, no selected key, malformed lists, never widens, unknown fields kept, idempotent across instances, earlier-stamped settings, no settings)

## 2. Handlers

- [x] 2.1 `getPublicKey` asks `getIdentityDisclosure(origin, selectedKey.id)` after `resolveSigningKey`
- [x] 2.2 Disclosure prompts carry `signingKeyId` and de-duplicate on origin and key; signing prompts carry it too
- [x] 2.3 `approval.resolve` grants the prompt's key on a remembered disclosure approval and on an approved signature; a request with no key records nothing
- [x] 2.4 `policy.revokeDisclosure` (RPC type, handler, client); `policy.setOrigin` `allow` grants the selected key and refuses with `no_key_selected` without one
- [x] 2.5 Integration tests with the real handlers, queue, policy and vault: grant A, switch to B asks, switch back answers silently; a one-time approval grants nothing; both keys granted; a refusal covers both keys; a caller after a switch gets its own prompt; approval binds to the prompt's key when the selection moved; approving a signature grants the signing key; per-key revoke; the activity log records the key id
- [x] 2.6 Security test: no stored shape and no migration result discloses a key the grant does not name; a patch cannot plant a grant; the migration only narrows

## 3. Settings and the prompt

- [x] 3.1 `DisclosureGrants`: one row per grant with key name, short npub, copy and its own Revoke; removed and unreadable keys named as such
- [x] 3.2 `OriginPolicyTable` and `PermissionsTab`: the count in the collapsed row, the list in the details, per-grant revoke; an `allow` that names no key shows as the prompting state
- [x] 3.3 The remember note in the consent prompt
- [x] 3.4 Component and hook tests
- [x] 3.5 Light and dark review on the production build with a populated vault, recorded in `docs/design-review/README.md`

## 4. Docs and verify

- [x] 4.1 `docs/roadmap.md` (SEC-026 and its residual), `docs/agent-loop.md`
- [x] 4.2 Chrome e2e: key switch through a real page and approval window (`tests/e2e/identity-disclosure.spec.ts`)
- [ ] 4.3 Archive this change (Task 14 of phase 0.10)
