# Implementation notes

## Spec reconciliation (tasks 13.1 – 13.3)

Three places assert or specify the behaviour this change alters. None is edited
here — a change's delta belongs in its own `specs/` directory — but all three
must be reconciled at archive time, and this is the record of what is owed.

### 13.1 — `openspec/specs/nip07-provider/spec.md:30-36`

Its `Successful retrieval when unlocked` scenario says the promise resolves
whenever the vault is unlocked with at least one key. **This change makes that
false.** Superseded by the `MODIFIED Requirement: Get Public Key` in
`specs/nip07-provider/spec.md` of this change, whose equivalent scenario adds
"and the calling origin has a recorded identity-disclosure decision allowing it"
and "and the origin is within its per-origin rate allowance".

### 13.2 — `openspec/changes/harden-provider-trust-boundary/specs/nip07-provider/spec.md:38-52`

Carries the **same requirement, with the same now-false scenario, verbatim**,
plus two locked-state assertions this change's version also keeps. That change
is unarchived. Whichever of the two archives last silently overwrites the other,
so if `harden-provider-trust-boundary` archives after this one, `openspec/specs/`
regains a scenario the code does not satisfy. **This change must archive after
it, or the two deltas must be merged at archive time.**

### 13.3 — `openspec/changes/fix-consent-policy-defects/specs/identity-disclosure-consent/spec.md`

An earlier delta for **this same capability**, whose implementation tasks are all
marked skipped — six on file-ownership grounds and four on the deadlock ground
(a gate with no prompt is either fail-open or breaks every dapp) that the
two-phase split in this change exists to break. If it archives first,
`openspec/specs/` gains a spec the code did not satisfy at that moment. This
change supersedes it; the two must be reconciled rather than both archived.

## Decisions taken during implementation

### The disclosure prompt does not remember by default

Task 10.3 left this open, and the design named it as a human decision. It was
put to the user, who chose to **match the signing prompt**: the primary button
is allow-**once**, and a "Remember this site" checkbox — unticked by default —
upgrades it to a standing allow, or to a standing refusal when ticked before
Deny.

The reason is that both screens share one window. A button in the same position,
with the same weight, must not mean "just this once" on one and "forever" on the
other. No new `ApprovalActionSchema` value was needed: the existing
`allow` / `allow_once` / `deny` / `deny_remember` set already expresses it.

The cost is real and is accepted: since nothing is grandfathered, a user with
several dApps sees several prompts in their first session after the update, and
must notice the checkbox to stop being asked again. Decision 8's first half
absorbs most of that — approving a signature records disclosure consent — so a
returning user converges through the flow they were going to use anyway.

### Revoke had to send `"ask"`, not `undefined`

`revokeIdentityDisclosure` first sent `{ identityDisclosure: undefined }`. Zod
**strips an explicitly-undefined optional key**, so `OriginPolicyPatchSchema`
parsed it to `{}`, `setOriginPolicy` spread an empty patch, and the stored
decision survived untouched. The Revoke button would have looked like it worked
and done nothing — which is precisely the "Settings displays a decision the
product does not enforce" defect this whole change exists to remove.

It now sends `{ identityDisclosure: "ask" }`. Both `"ask"` and absent mean
"prompt next time"; only one of them is representable in a patch.
`tests/security/disclosure-consent-agreement.test.ts` pins the Zod behaviour
directly so the no-op cannot come back silently.

### `PendingRequest.event` is optional, and the compiler found every consumer

Making `event` optional surfaced **23 unguarded `request.event` reads across
four files** — including `ActivityPendingApprovals.tsx`, which is outside
`src/ui/features/approval/**` and renders in the popup and side panel. A change
scoped to the approval folder would have shipped a second crash site in a
surface the user sees more often than the approval window.

They are fixed by narrowing at the routing point via `isSigningRequest` /
`isDisclosureRequest`, **not** by optional-chaining each read. An optional chain
would render a blank field rather than failing, and a blank field in an approval
prompt is worse than a crash.

### The weak revert, and what it showed

Task 12.10's revert pass initially disabled the discriminator branch in
`approval-rpc.ts` with `if (false)`, and the "resolves without error" test still
passed — because control then fell through to the `isSigningRequest` branch,
which is also false, so nothing ran and the resolve succeeded. That was a weak
revert, not a passing protection. Restoring the **original** unconditional
`request.event.kind` dereference turned it red, which is the real defect shape.

## Residuals, stated rather than implied

- **A consented page's realm is not isolated.** The content script is top-frame
  only (`content.ts:50`, `all_frames` unset), so a third-party script inside a
  page the user has consented to inherits that page's grant. Documented in the
  README and the PRD; not solved.
- **Any origin the user signs for has the key regardless.** Every signature
  returns the public key inside the signed event, and a remembered per-kind
  allow makes that silent thereafter. The gate protects the window before the
  first approved signature, and origins that never ask for one.
- **The rate limiter is in memory.** An MV3 worker evicted after ~30s idle loses
  the counters. That is the right trade for the attack it bounds — a fast
  polling loop is also what keeps the worker alive — but an attacker patient
  enough to wait out an eviction between calls is already within any rate this
  would impose.
