# identity-disclosure-consent Specification

## Purpose

Governs disclosure of the selected public key to a web origin through `nostr.getPublicKey`. Every request carries a validated page origin, is rate limited, and requires a per-origin consent decision that the user can remember and revoke; every outcome is logged, and no record written before this capability existed counts as consent.
## Requirements
### Requirement: Public Key Requests Carry The Page Origin

The content script SHALL include the page origin in every forwarded `nostr.getPublicKey` request, and the background handler SHALL validate that origin before evaluating consent, reading any key, or queuing any prompt. The router's existing lock gate still runs ahead of the handler, so a locked vault is refused without reaching origin validation.

#### Scenario: Content script attaches the origin

- **WHEN** the injected provider calls `getPublicKey` and the content script forwards the request
- **THEN** the forwarded `nostr.getPublicKey` RPC message includes the page origin taken from the content-script context
- **AND** the origin is not read from any page-supplied field

#### Scenario: Missing origin is rejected

- **WHEN** the background receives a `nostr.getPublicKey` request with no origin
- **THEN** the request is rejected with error code `invalid_origin`
- **AND** no public key is returned

#### Scenario: Malformed origin is rejected

- **WHEN** the background receives a `nostr.getPublicKey` request whose origin is not a valid HTTP(S) URL as accepted by the shared origin validator
- **THEN** the request is rejected with error code `invalid_origin`
- **AND** no public key is returned

### Requirement: Identity Disclosure Is Recorded In The Activity Log

The extension SHALL write an activity-log entry for every `nostr.getPublicKey` outcome, and that entry SHALL be distinguishable from event-signing entries. An entry for an allowed disclosure SHALL record which key was disclosed, by the vault's key id, and SHALL NOT carry the public key in any free-text field.

This requirement is independent of the consent gate and SHALL hold whether or not a prompt is shown, so the user can see which origins have read their public key even before any gate exists.

#### Scenario: Approved disclosure is logged

- **WHEN** identity disclosure is allowed for `https://example.com`
- **THEN** an activity-log entry records origin `https://example.com` and decision `allow`
- **AND** the entry identifies the operation as identity disclosure rather than event signing

#### Scenario: The disclosed key is recorded

- **GIVEN** the user has two keys, A and B
- **WHEN** identity disclosure is allowed for `https://example.com` while B is selected
- **THEN** the activity-log entry records B's key id
- **AND** the entry does not record A's key id
- **AND** no free-text field of the entry contains a public key

#### Scenario: Denied disclosure is logged

- **WHEN** identity disclosure is denied for `https://example.com`
- **THEN** an activity-log entry records origin `https://example.com` and decision `deny`

#### Scenario: Auto-allowed disclosure from a remembered grant is logged

- **GIVEN** a remembered identity-disclosure grant exists for `https://example.com`
- **WHEN** `https://example.com` calls `getPublicKey`
- **THEN** an activity-log entry is still recorded for the disclosure

#### Scenario: Disclosure history is visible per origin

- **GIVEN** one or more origins have read the public key
- **WHEN** the user views the per-origin permissions surface
- **THEN** the user can see which origins have read their public key

### Requirement: Public Key Requests Are Rate Limited Per Origin

The extension SHALL bound how often a single origin may call `nostr.getPublicKey`, independently of whether a consent gate is in force.

Without this bound, a page left open can poll in a tight loop, so the auto-lock timeout buys nothing against a persistent tab. The bound caps how often an origin may sample; it does not by itself prevent a single successful read shortly after an unlock, which is what the consent requirement below addresses.

#### Scenario: A polling origin is refused

- **GIVEN** an origin has called `getPublicKey` more times within the rate window than the limit allows
- **WHEN** it calls `getPublicKey` again within that window
- **THEN** the request is refused with error code `rate_limited`
- **AND** no public key is returned
- **AND** no approval prompt is queued

#### Scenario: The limit is per origin

- **GIVEN** one origin has exhausted its rate allowance
- **WHEN** a different origin calls `getPublicKey`
- **THEN** that origin is not affected by the first origin's exhausted allowance

#### Scenario: The allowance recovers

- **GIVEN** an origin has exhausted its rate allowance
- **WHEN** the rate window elapses
- **THEN** the origin may call `getPublicKey` again

### Requirement: Public Key Disclosure Requires Per-Origin Consent

The extension SHALL evaluate consent for the requesting origin AND the selected key before returning the selected public key in response to `nostr.getPublicKey`, and MUST NOT answer that method for an origin that has no recorded consent decision allowing that key. A recorded `allow` applies only to the key it was granted for.

This requirement governs `nostr.getPublicKey` only. It does not prevent an origin from obtaining the public key by other means: a signed event returned to an origin contains it, so approving a signature discloses it. The `Signing Consent And Disclosure Consent Agree` requirement below exists so that the two paths cannot report contradictory states.

#### Scenario: First request from an unknown origin prompts

- **GIVEN** the vault is unlocked with a selected key
- **AND** no identity-disclosure decision exists for `https://example.com`
- **WHEN** `https://example.com` calls `getPublicKey`
- **THEN** the extension queues an approval request describing the identity-disclosure decision
- **AND** the public key is not returned until the user decides

#### Scenario: Approved disclosure returns the public key

- **GIVEN** an identity-disclosure prompt is open for `https://example.com`
- **WHEN** the user approves it
- **THEN** the Promise resolves to the 64-character hex public key of the selected key

#### Scenario: Denied disclosure returns a disclosure-specific error

- **GIVEN** an identity-disclosure prompt is open for `https://example.com`
- **WHEN** the user denies it
- **THEN** the Promise rejects with an error code specific to a refused identity disclosure
- **AND** that code is distinguishable from the code returned when a signing request is denied
- **AND** no public key is returned

#### Scenario: Timed-out disclosure returns an error

- **GIVEN** an identity-disclosure prompt is open for `https://example.com`
- **WHEN** the prompt times out with no user decision
- **THEN** the Promise rejects with error code `timeout`
- **AND** no public key is returned

#### Scenario: A silent `getPublicKey` read is not possible from an unconsented origin

- **GIVEN** the vault is unlocked with a selected key
- **AND** no identity-disclosure decision exists for `https://tracker.example`
- **WHEN** a script on `https://tracker.example` calls `getPublicKey`
- **THEN** the public key is not returned without a user decision

#### Scenario: Consent for another key does not apply

- **GIVEN** the user allowed identity disclosure for `https://example.com` while key A was selected
- **AND** the user then selected key B
- **WHEN** `https://example.com` calls `getPublicKey`
- **THEN** the extension queues an approval request describing the identity-disclosure decision for key B
- **AND** key B's public key is not returned until the user decides

#### Scenario: The prompt names the key it asks about

- **GIVEN** `https://example.com` has called `getPublicKey` while key B is selected and no decision exists for B
- **WHEN** the approval request is shown
- **THEN** it identifies key B as the identity being asked about

#### Scenario: A caller after a key switch is not answered by the earlier prompt

- **GIVEN** an identity-disclosure prompt for key A is open for `https://example.com`
- **AND** the user selects key B
- **WHEN** `https://example.com` calls `getPublicKey` again
- **THEN** a separate prompt for key B is queued
- **AND** the user's answer to the prompt for key A is not applied to the call made while B was selected

### Requirement: Signing Consent And Disclosure Consent Agree

A recorded identity-disclosure decision and the signing path SHALL NOT contradict each other, because a successful signature returns the public key to the origin inside the signed event.

#### Scenario: Approving a signature records disclosure consent

- **GIVEN** no identity-disclosure decision exists for `https://example.com`
- **WHEN** the user approves a signing request from `https://example.com`
- **THEN** identity disclosure is recorded as allowed for that origin and for the key that signed
- **AND** the user is not separately prompted to disclose that key to an origin whose signature they have just approved

#### Scenario: Approving a signature does not consent for another key

- **GIVEN** the user approved a signing request from `https://example.com` made with key A
- **WHEN** the user selects key B and `https://example.com` calls `getPublicKey`
- **THEN** the extension prompts for key B

#### Scenario: A remembered disclosure denial forces signing to prompt

- **GIVEN** the user has denied identity disclosure for `https://example.com` with the remember option enabled
- **WHEN** `https://example.com` requests a signature for a kind that would otherwise be auto-allowed by a remembered rule
- **THEN** the request prompts rather than signing silently

#### Scenario: Settings never displays an unenforced decision

- **GIVEN** any identity-disclosure decision shown in Settings for an origin
- **WHEN** that origin obtains the public key by any path
- **THEN** the displayed decision reflects what the product actually enforces

### Requirement: Identity Consent Is Remembered And Revocable

The extension SHALL persist an identity-disclosure grant per origin and key, so a consenting user is prompted once per origin and key, SHALL persist a denial per origin, and SHALL allow the user to revoke either decision in Settings. A grant for one key SHALL NOT be changed by a decision about another key. A denial applies to every key of the origin.

#### Scenario: Remembered grant skips later prompts

- **GIVEN** the user approved identity disclosure for `https://example.com` with the remember option enabled
- **AND** the vault is unlocked
- **WHEN** `https://example.com` calls `getPublicKey` again
- **THEN** the public key is returned without a prompt

#### Scenario: One-time approval does not persist

- **GIVEN** the user approved identity disclosure for `https://example.com` without the remember option
- **WHEN** `https://example.com` calls `getPublicKey` again
- **THEN** the extension prompts again

#### Scenario: Remembered deny rejects without prompting

- **GIVEN** the user denied identity disclosure for `https://example.com` with the remember option enabled
- **WHEN** `https://example.com` calls `getPublicKey`
- **THEN** the Promise rejects with the disclosure-refused error code
- **AND** no prompt is shown

#### Scenario: A remembered deny covers every key

- **GIVEN** the user denied identity disclosure for `https://example.com` with the remember option enabled while key A was selected
- **WHEN** the user selects key B and `https://example.com` calls `getPublicKey`
- **THEN** the Promise rejects with the disclosure-refused error code
- **AND** no prompt is shown

#### Scenario: Revoking a denial does not restore earlier grants

- **GIVEN** `https://example.com` held a grant for key A
- **AND** the user then denied identity disclosure for it with the remember option enabled
- **WHEN** the user revokes the denial in Settings
- **THEN** `https://example.com` is prompted for key A

#### Scenario: A denied origin cannot re-summon the prompt

- **GIVEN** the user denied identity disclosure for `https://example.com` with the remember option enabled
- **WHEN** `https://example.com` reloads and calls `getPublicKey` repeatedly
- **THEN** no approval window is opened or focused for those calls

#### Scenario: Revoking consent restores prompting

- **GIVEN** a remembered identity-disclosure grant exists for `https://example.com` and the selected key
- **WHEN** the user revokes it in Settings
- **THEN** the next `getPublicKey` call from `https://example.com` with that key selected prompts again

#### Scenario: Switching back to the granted key does not prompt

- **GIVEN** the user allowed identity disclosure for `https://example.com` with the remember option while key A was selected
- **AND** the user selected key B and `https://example.com` was prompted
- **WHEN** the user selects key A again and `https://example.com` calls `getPublicKey`
- **THEN** key A's public key is returned without a prompt

#### Scenario: A grant for a second key is added to the first

- **GIVEN** the user allowed identity disclosure for `https://example.com` for key A
- **WHEN** the user allows it for key B with the remember option
- **THEN** `https://example.com` is answered without a prompt for either key

#### Scenario: Revoking one key's grant leaves the others

- **GIVEN** a remembered identity-disclosure grant exists for `https://example.com` for keys A and B
- **WHEN** the user revokes the grant for key A in Settings
- **THEN** `https://example.com` is prompted for key A
- **AND** `https://example.com` is still answered without a prompt for key B

#### Scenario: A remembered approval is for the key the prompt named

- **GIVEN** an identity-disclosure prompt for key A is open for `https://example.com`
- **AND** the user selects key B while it is open
- **WHEN** the user approves the prompt with the remember option
- **THEN** the grant is recorded for key A
- **AND** no grant is recorded for key B

#### Scenario: Identity consent is scoped to one origin

- **GIVEN** a remembered identity-disclosure grant exists for `https://example.com`
- **WHEN** `https://other.example` calls `getPublicKey`
- **THEN** the grant for `https://example.com` does not apply
- **AND** `https://other.example` is prompted

### Requirement: No Existing Origin Is Granted Disclosure Consent By Migration

Introducing identity-disclosure consent SHALL NOT grant consent to any origin on the basis of records written before this capability existed.

Stored origin records are not evidence of consent to disclose an identity. The same record shape is written when a user refuses a request as when they approve one, and `low` is the level the code assigns by default when a record is created as a side effect of a decision — so an all-deny or empty `low` record is evidence of refusal, or of nothing.

#### Scenario: An origin with a stored policy is still prompted

- **GIVEN** an origin has a stored policy record written before this change, of any trust level and with any per-kind rules
- **WHEN** that origin calls `getPublicKey` for the first time after the change
- **THEN** the user is prompted

#### Scenario: A previously refused origin is not granted consent

- **GIVEN** an origin whose stored record was written by a remembered denial
- **WHEN** that origin calls `getPublicKey`
- **THEN** the user is prompted
- **AND** the origin is not treated as having consented

### Requirement: Locked Vault Fails Before Consent Evaluation

The extension SHALL keep returning a locked error for `nostr.getPublicKey` when the vault is locked, without prompting for consent and without recording a consent decision.

#### Scenario: Locked vault returns locked

- **GIVEN** the vault is locked
- **WHEN** `https://example.com` calls `getPublicKey`
- **THEN** the Promise rejects with error code `locked`
- **AND** no identity-disclosure prompt is shown
- **AND** no identity-disclosure decision is persisted

#### Scenario: No key selected returns no_key_selected

- **GIVEN** the vault is unlocked
- **AND** no key is selected
- **WHEN** `https://example.com` calls `getPublicKey`
- **THEN** the Promise rejects with error code `no_key_selected`

### Requirement: A Non-Signing Approval Request Cannot Break The Approval Surface

The approval pipeline SHALL carry a request that has no unsigned event without failing, and a request that cannot be rendered SHALL NOT remove the user's ability to act on other queued requests.

#### Scenario: An eventless request resolves normally

- **GIVEN** an identity-disclosure request is queued
- **WHEN** the user approves or denies it
- **THEN** the resolution completes without error
- **AND** the request does not remain queued until its timeout

#### Scenario: An eventless request writes no per-kind rule

- **GIVEN** an identity-disclosure request is queued
- **WHEN** the user approves it with the remember option
- **THEN** no per-kind signing rule is written for that origin
- **AND** no rule is written under an undefined or non-integer kind

#### Scenario: A failed render does not disable the queue

- **GIVEN** several requests are queued and one cannot be rendered
- **WHEN** the approval window displays the queue
- **THEN** the user can still deny the other queued requests

#### Scenario: Disclosure requests do not exhaust the signing queue

- **GIVEN** identity-disclosure requests and signing requests are queued together
- **WHEN** the queue's per-origin and global capacity is evaluated
- **THEN** a repeated disclosure request from one origin does not displace a pending signing request from another origin

### Requirement: The Public Key Rate Window Survives A Worker Restart

The extension SHALL keep the `nostr.getPublicKey` rate window across a restart of the background worker, so that an evicted worker does not return the allowance to an origin. This SHALL hold while the vault is locked, where no keepalive runs and the worker is routinely ended between calls. A request that arrives at a restarted worker SHALL be judged against the persisted window. A persisted window that cannot be read as valid SHALL be treated as empty. The persisted window is specified by `approval-flood-controls`, "Rate-Limit Counters Survive A Worker Restart".

#### Scenario: An exhausted allowance survives a restart

- **GIVEN** an origin has exhausted its `getPublicKey` allowance within the rate window
- **WHEN** the background worker is restarted and the origin calls `getPublicKey` again within that window
- **THEN** the request is refused with error code `rate_limited`
- **AND** no public key is returned
- **AND** no approval prompt is queued

#### Scenario: The allowance recovers on the original schedule

- **GIVEN** an origin exhausted its allowance before a restart
- **WHEN** the rate window, measured from the original calls, elapses
- **THEN** the origin may call `getPublicKey` again

### Requirement: Existing Disclosure Grants Are Bound To One Key By Migration

The extension SHALL bind every identity-disclosure `allow` stored before disclosure was per key to the key selected when the migration runs, and to no other key. The migration SHALL run when the background starts, SHALL be versioned and idempotent, SHALL preserve fields it does not own, and SHALL NOT widen any grant: it adds no `allow`, adds no key to a grant, and leaves refusals and undecided origins as they were. When no key is selected, an `allow` SHALL become the prompting state and SHALL NOT be bound to any key.

#### Scenario: An existing allow is bound to the selected key

- **GIVEN** stored settings hold an identity-disclosure `allow` for `https://example.com` with no key recorded
- **AND** key A is selected
- **WHEN** the migration runs
- **THEN** `https://example.com` is answered without a prompt for key A
- **AND** `https://example.com` is prompted for every other key

#### Scenario: The binding does not follow a later selection

- **GIVEN** the migration bound an allow to key A
- **WHEN** the user later selects key B and the extension restarts
- **THEN** the grant is still for key A only

#### Scenario: An allow with no selected key is dropped to ask

- **GIVEN** stored settings hold an identity-disclosure `allow` for `https://example.com`
- **AND** no key is selected
- **WHEN** the migration runs
- **THEN** `https://example.com` is prompted for every key

#### Scenario: A refusal, an ask and an undecided origin are unchanged

- **GIVEN** stored settings hold a refused origin, an origin recorded as `ask` and an origin with no disclosure decision
- **WHEN** the migration runs
- **THEN** each of them is exactly as it was

#### Scenario: Migration preserves unknown fields

- **GIVEN** an origin record carries a field this version does not define
- **WHEN** the migration runs
- **THEN** that field is unchanged

#### Scenario: Migration is idempotent

- **GIVEN** the migration has already run
- **WHEN** it runs again, including from a fresh service instance after the selected key changed
- **THEN** stored settings are unchanged

#### Scenario: A malformed key list grants nothing

- **GIVEN** an origin record holds an `allow` whose key list is not a list, or contains no well-formed key id
- **WHEN** the migration runs
- **THEN** the origin is prompted for every key

### Requirement: Settings Shows The Identity Each Disclosure Grant Belongs To

Settings → Permissions SHALL show, for each origin with identity-disclosure grants, one entry per granted key naming that key by its label and a short middle-truncated npub, and SHALL allow the user to revoke each grant on its own without a password. A grant whose key is no longer in the vault SHALL remain listed and revocable, marked as a removed key. An origin whose stored `allow` names no key SHALL be shown as prompting, because that is what the extension does.

#### Scenario: Each grant is named by its identity

- **GIVEN** `https://example.com` holds grants for keys A, labelled "Main", and B, labelled "Work"
- **WHEN** the user opens Settings → Permissions and expands `https://example.com`
- **THEN** an entry names "Main" with a short npub
- **AND** an entry names "Work" with a short npub

#### Scenario: Revoking a grant revokes only that key

- **WHEN** the user revokes the entry for "Main"
- **THEN** `https://example.com` is prompted for key A
- **AND** the entry for "Work" remains

#### Scenario: A grant for a removed key stays listed

- **GIVEN** `https://example.com` holds a grant for a key that has since been deleted
- **WHEN** the user opens its entry in Settings
- **THEN** the grant is listed as a removed key
- **AND** it can be revoked

#### Scenario: The collapsed row counts the keys

- **GIVEN** `https://example.com` holds grants for two keys
- **WHEN** Settings → Permissions lists the origin
- **THEN** the row states that the site can read 2 public keys

