## Why

A site that the user let read their public key for key A also gets key B's public key after the user switches to B, and is never asked. Disclosure consent (`identity-disclosure-consent`, "Identity Consent Is Remembered And Revocable") is recorded per origin: one `identityDisclosure: "allow"` on the site's record, answered for whichever key happens to be selected when the site calls `getPublicKey`.

The harm is linkage, not secrecy: the public key is public. But which identity a site may tie to the user's browsing is exactly what the consent prompt asks, and a user who keeps a main key and a throwaway key switches between them to keep the two apart. A grant that follows the selection defeats that without any prompt or log line that says so. SEC-026 in the roadmap records it.

## What Changes

- **An allow belongs to a key.** A remembered `getPublicKey` allow is recorded for the origin and the key it was granted for. After the user switches keys, a call from that origin is asked about the new key, in the normal consent flow. Switching back to the first key answers without a prompt. Granting for a second key adds to the first; it does not replace it.
- **A refusal stays per origin.** A remembered `deny` covers every key. "This site may not know who I am" is a statement about the site, and making a refusal per key would let a site that was refused ask again after every key switch, which is the abuse the remembered refusal exists to stop. Refusing also drops the site's key grants, so revoking the refusal later does not bring them back.
- **The binding is to the key's id.** The vault's own immutable handle, not the public key and not the selection. A key deleted and re-imported is a new key and is asked about again, which is the conservative side. A grant for a deleted key stays listed in Settings, marked as a removed key, until it is revoked.
- **A prompt is about one key.** The pending disclosure prompt is de-duplicated on origin and key, not on origin alone. Otherwise a second caller arriving after a key switch would be folded into the prompt that asked about the first key and would be answered with its decision.
- **A remembered approval binds to the key the prompt named.** Not to whichever key is selected when the user clicks. The prompt carries the key id it was queued for.
- **Approving a signature records disclosure for the signing key.** It already recorded disclosure for the origin (`Signing Consent And Disclosure Consent Agree`). It now records it for the key that signed, because that signature is what reveals that key.
- **`policy.setOrigin` with `identityDisclosure: "allow"` grants the selected key.** A patch names no key, so an `allow` in a patch means the identity the user was looking at when they entered their password, and no other. A patch cannot carry the key list, and no patch can grant a key that is not selected. Other values still withdraw: `ask` and `deny` through a patch drop every key grant.
- **Settings → Permissions names the identity of each grant.** Each grant is a row showing the key's name and short npub, with its own Revoke. Revoking one leaves the site's other grants. The collapsed row says how many keys the site may read. A new `policy.revokeDisclosure` RPC withdraws one grant; like other tightening it needs no password.
- **The consent prompt says it is for this identity.** The remember note under "Remember this site" now says the site will not ask again *for this identity* and that another key still asks.
- **Migration binds existing allows.** One versioned, idempotent step in the consent migration binds each stored `allow` to the key selected when it runs, and to no other. It runs at worker start, so "the key selected at upgrade" is not whichever key the user switches to before a site next asks. With no selected key, an `allow` is dropped to `ask` instead of being bound to an arbitrary key. The step only narrows: it never adds an allow, never adds a key to one, and leaves refusals, asks and unknown fields as they are.
- **The activity log already records which key was disclosed** (`keyId`, never the key itself) for every allowed disclosure. The spec now says so.

Not changed: the `getPublicKey` rate limit, which stays per origin and keeps the persisted windows from `meter-auto-signed-requests`; per-kind signing rules, trust levels and session grants, which are not key-bound (see Impact); the activity log's other fields.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `identity-disclosure-consent`: consent is per origin and key; the remember, revoke, signing-agreement and activity-log requirements say so; adds the migration that binds existing grants and the per-grant Settings requirement.
- `consent-scope-integrity`: `policy.setOrigin` with `identityDisclosure: "allow"` grants the selected key only.

Relationship to `meter-auto-signed-requests`, which also carries a delta for `identity-disclosure-consent`: that change ADDS "The Public Key Rate Window Survives A Worker Restart". This one MODIFIES four other requirements and ADDS two more. The two deltas share no requirement, so they apply in either order. The rate limit requirement ("Public Key Requests Are Rate Limited Per Origin") is not touched here.

## Impact

**Code**
- `src/domain/types.ts`: `OriginPolicy.identityDisclosureKeyIds`, `PendingRequest.signingKeyId`.
- `src/application/services/policy.service.ts`: `grantIdentityDisclosure`, `revokeIdentityDisclosureKey`, `getIdentityDisclosure(origin, keyId)`, `setIdentityDisclosure` narrowed to `deny`/`ask`; migration step 2 and `migrate()`.
- `src/application/services/approval-queue.service.ts`: disclosure de-duplication on origin and key; `signingKeyId`.
- `src/infrastructure/messaging/handlers/nostr-rpc.ts`, `approval-rpc.ts`, `policy-rpc.ts`, `rpc.ts`, `client.ts`: the key is carried and checked; `policy.revokeDisclosure`.
- `src/extension/background.ts`: runs the migration at worker start.
- `src/ui/features/settings/components/`: `PermissionsTab.tsx`, `shared/OriginPolicyTable.tsx`, new `shared/DisclosureGrants.tsx`; `src/ui/hooks/useAppSettings.ts`; the remember note in `DisclosureDetailView.tsx`.

**Storage:** one optional field on origin records, `identityDisclosureKeyIds: string[]`, and the consent migration version 1 to 2. No new storage key, permission, dependency or network behaviour.

**Behaviour users will notice:** a user with several keys is asked once per key by each site that has been allowed. After the upgrade, every site that was allowed keeps working for the key that was selected and asks for the others.

**Known residual, not in scope:** a remembered per-kind signing `allow` and the `high` trust level are not key-bound, so a site that signs without a prompt under key B puts B's public key in that signed event without a `getPublicKey` grant for B. Binding signing rules to keys is a larger change to the policy model and is recorded against SEC-026 in the roadmap.
