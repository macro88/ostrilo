## ADDED Requirements

### Requirement: Remembered Allow Persists Site Kind Rule

The extension SHALL persist a per-origin, per-kind `allow` rule when a user approves an unprotected signing request with the remember option enabled.

#### Scenario: Remembered allow creates a durable rule

- **GIVEN** the vault is unlocked
- **AND** `https://primal.net` requests signing for unprotected kind `10002`
- **AND** the request requires approval
- **WHEN** the user enables the remember option and approves the request
- **THEN** the extension persists an `allow` rule for origin `https://primal.net` and kind `10002`
- **AND** the original request is signed

#### Scenario: Allow once does not create a durable rule

- **GIVEN** the vault is unlocked
- **AND** `https://primal.net` requests signing for unprotected kind `10002`
- **WHEN** the user approves the request without enabling the remember option
- **THEN** the extension signs the request
- **AND** no per-kind `allow` rule is persisted for that origin and kind

### Requirement: Remembered Allow Skips Future Prompts

The extension SHALL auto-sign future matching requests after a remembered `allow` rule is saved for the requesting origin and unprotected event kind.

#### Scenario: Matching second request auto-signs

- **GIVEN** an `allow` rule exists for origin `https://primal.net` and kind `10002`
- **AND** the vault is unlocked
- **WHEN** `https://primal.net` requests signing for kind `10002`
- **THEN** the extension signs the request without opening an approval prompt
- **AND** the signing activity is recorded as an allow decision

#### Scenario: Different kind still prompts

- **GIVEN** an `allow` rule exists for origin `https://primal.net` and kind `10002`
- **AND** the vault is unlocked
- **WHEN** `https://primal.net` requests signing for kind `30078`
- **THEN** the remembered kind `10002` rule does not apply
- **AND** the request follows normal policy evaluation

#### Scenario: Different origin still prompts

- **GIVEN** an `allow` rule exists for origin `https://primal.net` and kind `10002`
- **AND** the vault is unlocked
- **WHEN** `https://example.com` requests signing for kind `10002`
- **THEN** the remembered rule for `https://primal.net` does not apply
- **AND** the request follows normal policy evaluation

### Requirement: Protected Kinds Cannot Be Remembered As Allow

The extension SHALL NOT persist remembered `allow` rules for protected event kinds.

#### Scenario: Protected Short Text Note remains one-time approval

- **GIVEN** kind `1` is protected
- **AND** `https://primal.net` requests signing for kind `1`
- **WHEN** the user approves the request
- **THEN** the extension signs only that approved request
- **AND** no `allow` rule is persisted for origin `https://primal.net` and kind `1`

#### Scenario: Protected Zap Request remains one-time approval

- **GIVEN** kind `9734` is protected
- **AND** `https://primal.net` requests signing for kind `9734`
- **WHEN** the user approves the request
- **THEN** the extension signs only that approved request
- **AND** no `allow` rule is persisted for origin `https://primal.net` and kind `9734`

### Requirement: Remembered Policies Are Visible And Reversible

The extension SHALL display remembered per-origin, per-kind policies in Settings and allow users to change or remove those policies.

#### Scenario: Settings shows remembered allow

- **GIVEN** a user remembered allow for origin `https://primal.net` and kind `10002`
- **WHEN** the user opens Settings permissions
- **THEN** the origin `https://primal.net` is listed
- **AND** kind `10002` is shown with an `allow` rule
- **AND** the kind label identifies it as Relay List

#### Scenario: Settings updates when remembered allow is created elsewhere

- **GIVEN** Settings permissions is already open
- **WHEN** the user remembers allow for origin `https://primal.net` and kind `10002` from an approval window
- **THEN** Settings updates to show the new origin rule without requiring a manual reload

#### Scenario: User revokes remembered allow

- **GIVEN** an `allow` rule exists for origin `https://primal.net` and kind `10002`
- **WHEN** the user changes the rule to `ask` in Settings
- **THEN** future matching requests no longer auto-sign from the remembered rule

### Requirement: Approval UI Communicates Remembered Scope

The approval UI SHALL explain that remembered decisions apply only to the requesting origin and event kind.

#### Scenario: Unprotected request shows remember scope

- **GIVEN** an approval request for origin `https://primal.net` and unprotected kind `10002`
- **WHEN** the approval detail is shown
- **THEN** the remember control says the decision applies to this site and this event kind
- **AND** the event kind label is visible near the decision

#### Scenario: Protected request explains auto-allow is unavailable

- **GIVEN** an approval request for protected kind `1`
- **WHEN** the approval detail is shown
- **THEN** the UI explains that this kind always requires approval before signing
- **AND** the UI does not offer remembered allow for the protected kind

### Requirement: Common Client Policy Kinds Are Legible

The extension SHALL label common Nostr client event kinds used for profile, settings, relay, list, reaction, repost, and application-data workflows.

#### Scenario: Common settings and profile kinds have labels

- **WHEN** the extension displays event kind labels
- **THEN** kind `0` is labeled as Profile Metadata
- **AND** kind `3` is labeled as Contacts
- **AND** kind `10000` is labeled as Mute List
- **AND** kind `10001` is labeled as Pin List
- **AND** kind `10002` is labeled as Relay List
- **AND** kind `30078` is labeled as Application Data

#### Scenario: Settings quick controls include common policy kinds

- **WHEN** the user views per-origin policy controls in Settings
- **THEN** quick controls include common unprotected policy kinds for profile, contacts, lists, relay list, and application data
- **AND** protected kinds are not presented as auto-allow candidates
