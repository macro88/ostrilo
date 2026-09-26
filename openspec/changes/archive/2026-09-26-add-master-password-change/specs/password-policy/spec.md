## ADDED Requirements

### Requirement: Policy Applies To A Changed Password

The new-password policy SHALL be enforced on the new password of `vault.changePassword` at the RPC boundary, with the same blocklist as vault creation. It SHALL NOT be applied to the current password being verified, so an existing user whose password predates the policy can always change it.

#### Scenario: A weak new password is refused

- **GIVEN** an unlocked vault
- **WHEN** `vault.changePassword` carries the correct current password and a four-character new password
- **THEN** the response carries `invalid_password` with details explaining the policy and without echoing the password
- **AND** no stored item changes

#### Scenario: A pre-policy current password can be replaced

- **GIVEN** a vault created before the password policy under an eight-character password
- **WHEN** `vault.changePassword` carries that password as current and a policy-compliant new password
- **THEN** the change succeeds

### Requirement: Password Change Requires A Matching Confirmation

The password-change surface SHALL require a confirmation field for the new password and SHALL block submission while the new password and its confirmation differ. The current-password field SHALL NOT have a confirmation.

#### Scenario: Mismatched confirmation

- **WHEN** the user enters differing values in the new and confirm fields of the password-change dialog
- **THEN** submission is blocked
- **AND** no `vault.changePassword` request is sent
