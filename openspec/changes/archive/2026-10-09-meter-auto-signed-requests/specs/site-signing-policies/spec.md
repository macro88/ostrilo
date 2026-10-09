## MODIFIED Requirements

### Requirement: Remembered Allow Skips Future Prompts

The extension SHALL auto-sign future matching requests after a remembered `allow` rule is saved for the requesting origin and unprotected event kind, up to the origin's automatic-signing budget. A matching request beyond the budget SHALL be routed to approval as an unremembered request is, and SHALL NOT be refused.

#### Scenario: Matching second request auto-signs

- **GIVEN** an `allow` rule exists for origin `https://primal.net` and kind `10002`
- **AND** the vault is unlocked
- **AND** `https://primal.net` is within its automatic-signing budget
- **WHEN** `https://primal.net` requests signing for kind `10002`
- **THEN** the extension signs the request without opening an approval prompt
- **AND** the signing activity is recorded as an allow decision

#### Scenario: A matching request over the budget prompts

- **GIVEN** an `allow` rule exists for origin `https://primal.net` and kind `10002`
- **AND** the vault is unlocked
- **AND** `https://primal.net` has had 60 requests signed without a prompt in the last 60 seconds
- **WHEN** `https://primal.net` requests signing for kind `10002`
- **THEN** the request is routed to approval, as it would be with no remembered rule
- **AND** the remembered `allow` rule is unchanged

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
