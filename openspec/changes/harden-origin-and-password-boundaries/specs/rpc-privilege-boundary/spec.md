## ADDED Requirements

### Requirement: Extension-Internal Commands Require A Verified Extension-Page Sender

Every background message listener that performs an action outside the RPC router, including `ostrilo.openApprovalWindow`, SHALL apply the same verified extension-page sender check as UI-only RPC namespaces, and SHALL neither perform the action nor reply with a result when the check fails.

#### Scenario: An extension page opens the approval window

- **GIVEN** the Activity page sends `ostrilo.openApprovalWindow`
- **WHEN** the background receives it
- **THEN** the approval window is focused or created

#### Scenario: A content-script sender cannot open the approval window

- **GIVEN** a message `{ __command: "ostrilo.openApprovalWindow" }` whose sender URL is a web page
- **WHEN** the background receives it
- **THEN** no window is created or focused
- **AND** the sender receives no result
