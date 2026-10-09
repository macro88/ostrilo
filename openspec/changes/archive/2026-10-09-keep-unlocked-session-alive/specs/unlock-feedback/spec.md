## ADDED Requirements

### Requirement: The Lock Screen States Why The Vault Is Locked

The lock screen SHALL show a short sentence stating why the vault is locked whenever the background reports a lock reason, and SHALL show none otherwise. The sentence SHALL be chosen by the UI from the recorded reason and never taken from background text. An inactivity lock SHALL name the minutes of the timeout that elapsed. The sentence SHALL NOT claim a cause the background did not record.

#### Scenario: An inactivity lock names the timeout

- **GIVEN** the vault locked after a `35` minute inactivity timeout
- **WHEN** the lock screen is shown
- **THEN** it reads "Locked after 35 minutes without activity."

#### Scenario: A lost background is not reported as a timeout

- **GIVEN** the vault locked because the browser ended the background
- **WHEN** the lock screen is shown
- **THEN** it reads "Locked because the browser restarted Ostrilo's background."
- **AND** it does not mention inactivity

#### Scenario: A manual lock is acknowledged

- **GIVEN** the user pressed Lock
- **WHEN** the lock screen is shown
- **THEN** it reads "You locked Ostrilo."

#### Scenario: No reason, no sentence

- **GIVEN** the background reported no lock reason
- **WHEN** the lock screen is shown
- **THEN** no reason sentence is shown
- **AND** the password field is unchanged

### Requirement: An Unreachable Background Is Not Reported As A Locked Vault

A surface SHALL NOT present a failed lock-state request as a locked vault. When the background does not answer, the surface SHALL show that it cannot reach Ostrilo, offer a retry, and show no vault content and no onboarding. The surface SHALL recover without user action when a later request is answered. A failed request SHALL NOT change the last lock state the background reported.

#### Scenario: The first lock-state request fails

- **GIVEN** the background does not answer the first lock-state request
- **WHEN** a surface opens
- **THEN** it shows "Can't reach Ostrilo" with a retry
- **AND** it does not show the lock screen
- **AND** it does not show onboarding

#### Scenario: A later poll fails on an unlocked surface

- **GIVEN** a surface is showing an unlocked vault
- **WHEN** a lock-state request fails
- **THEN** the surface shows "Can't reach Ostrilo" with a retry
- **AND** it does not claim the vault is locked

#### Scenario: Retrying recovers

- **GIVEN** a surface is showing "Can't reach Ostrilo"
- **WHEN** the user retries and the background answers
- **THEN** the surface shows what the background reported

#### Scenario: A later answer recovers without a retry

- **GIVEN** a surface is showing "Can't reach Ostrilo"
- **WHEN** a later periodic lock-state request is answered
- **THEN** the surface shows what the background reported
