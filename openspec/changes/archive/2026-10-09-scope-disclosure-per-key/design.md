## Context

`OriginPolicy.identityDisclosure` is one `allow | deny | ask` per origin. `getPublicKey` reads it, and `approval.resolve` writes it on a remembered approval and on any approved signature.

## Decisions

### 1. Where the key lives in the record

An `allow` is only in force for the ids in `identityDisclosureKeyIds`. `identityDisclosure` keeps `allow | deny | ask`, so the origin patch schema, the password gate on `allow` and the existing UI and tests keep their meaning, and `deny` stays a single per-origin value.

The two fields are redundant for an `allow`, and the redundancy is made safe by one rule enforced in one place, `PolicyService.getIdentityDisclosure(origin, keyId)`: `allow` is returned only when the mode is `allow`, the list is an array and it contains that exact id. A legacy `allow` with no list, an empty list, a malformed list, or a list under `ask` all answer "no decision". The rule fails closed, so a record the migration has not reshaped yet, or a future writer that forgets the list, prompts rather than discloses. The settings table applies the same reading, so it never shows a grant the product does not enforce.

Rejected: a single `allow` replaced by a map from key id to decision. It would let a refusal be per key, which Decision 3 rules out, and it changes the patch schema and every consumer for no gain.

### 2. Key id, not public key

The vault already identifies a key by its immutable record id, the selected key is resolved to a record by `resolveSigningKey`, and the activity log already stores `keyId`. Binding to the id needs no lookup in the policy service, which has no access to key records, and the migration can bind to `settings.selectedKeyId` directly.

The cost is that a key deleted and re-imported is a different key and asks again. That is the conservative side, and the old grant remains listed and revocable as a removed key.

### 3. A refusal stays per origin

Per-key refusals would let a refused site ask again after each key switch. The point of a remembered refusal is that the site cannot re-summon the prompt (`A denied origin cannot re-summon the prompt`). So `deny` covers every key, and recording `deny` or `ask` through any path drops the key list, so a later revoke-to-ask cannot revive old grants.

A grant after a refusal replaces the refusal, which matches existing behaviour: the user has just decided the other way.

### 4. The prompt carries the key, and de-duplicates on it

The queue folded repeat disclosure requests from one origin into one prompt whose answer fanned out to every waiting caller. With a key switch in between, a caller for key B would receive the answer to a prompt about key A, and the handler would then return B's public key. Disclosure prompts are therefore de-duplicated on origin and key. The per-origin capacity limits are unchanged, so an origin cannot use this to queue without bound.

The request also carries `signingKeyId`, set at enqueue like `signingPubkey`, and the remembered approval binds to it. Resolving a prompt after the selection moved still grants the key the prompt asked about, and it is the key whose public key the handler returns.

### 5. The patch grants the selected key

`policy.setOrigin` with `identityDisclosure: "allow"` keeps its password gate. It cannot name a key, so the handler resolves the selected key and grants that one, and refuses with `no_key_selected` when there is none. The service ignores an `allow` and any key list in a patch, so only `grantIdentityDisclosure` can write a grant. Nothing in the UI sends this patch today.

### 6. Migration

Step 2 of the consent migration, run once by the stamp (`__consentMigrations` 1 to 2). Steps are gated on the stored version, so the earlier repair is not run again on settings that already had it, and settings that never ran it get both.

- A stored `allow` with no key list takes `settings.selectedKeyId`. "Selected key at migration time" is well defined because unlock persists a fallback selection through the same path `vault.select` uses.
- With no selected key, the `allow` becomes `ask`.
- An `allow` that already has a list keeps only its well-formed ids; if none remain it becomes `ask`.
- Refusals, asks and origins with no decision are untouched, as are all other fields on the record and on the settings object.

It runs at worker start, after the settings store has moved any synced item to local storage, and again lazily on first use. Running at start matters: the lazy run would otherwise bind to whichever key the user had selected when a site first asked, and a user who switches keys right after the update would widen the grant to the new key.

### 7. What this does not cover

Signing. A remembered per-kind `allow`, the `high` trust level and a session grant all sign without a prompt, and a signed event carries the signing key's public key. Making them key-bound would mean keying rules by key, a change to the policy model and its evaluation order. It is recorded as a residual against SEC-026 rather than done here.

## Risks

- **A migration that runs after a key switch binds the wrong key.** Mitigated by running at worker start. The window is the interval between the worker starting and the first message, and a switch inside it would need to arrive before the settings read completes.
- **A user with many keys sees more prompts.** One per site per key, once. A grant is added, not replaced, so no key asks twice.
