## MODIFIED Requirements

### Requirement: Key Handling Documents Are Declared In One Place

The set of extension documents allowed to hold key material SHALL be declared once as shared constants. Every guard that inspects those documents SHALL read that declaration rather than hard-coding document names, and UI code SHALL NOT repeat the document names as literals.

#### Scenario: Both guards read the same declaration

- **WHEN** the build-output guard enumerates the documents whose module graphs it inspects
- **THEN** it SHALL read them from the shared key-handling document constants
- **AND** a source guard SHALL fail when a shipped extension document is missing from the same constants

#### Scenario: Adding a document requires updating the declaration

- **WHEN** a new extension document is added that will hold key material
- **THEN** it SHALL be added to the shared declaration
- **AND** the build guard SHALL begin inspecting it without a separate configuration change
