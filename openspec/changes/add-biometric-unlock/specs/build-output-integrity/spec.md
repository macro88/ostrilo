## ADDED Requirements

### Requirement: The Key-Handling Document List Is Expressed Per Build Target

The key-handling document list the build-output checks consult SHALL be expressed per build target. For each target, every document declared for that target SHALL be asserted present in that target's output and asserted free of disallowed decorative dependencies; every document not declared for that target SHALL be asserted absent from that target's output. The checks SHALL NOT read the same document list unconditionally from every target's output.

#### Scenario: A document declared for one target is checked only in that target

- **GIVEN** a key-handling document declared for the Chromium target only
- **WHEN** the build-output checks run over the Chromium output
- **THEN** that document SHALL be asserted present
- **AND** the chunks reachable from it SHALL be asserted free of disallowed decorative dependencies

#### Scenario: A target-scoped document is asserted absent from targets that do not declare it

- **GIVEN** a key-handling document declared for the Chromium target only
- **WHEN** the build-output checks run over the Firefox output
- **THEN** that document SHALL be asserted absent from the Firefox output
- **AND** the checks SHALL NOT attempt to read it from the Firefox output

#### Scenario: A document declared for every target is checked in every target

- **GIVEN** a key-handling document declared for all build targets
- **WHEN** the build-output checks run
- **THEN** each target's output SHALL be asserted to contain that document
- **AND** the dependency assertions SHALL run against each target's copy

#### Scenario: Target scoping is read from the shared declaration

- **WHEN** a key-handling document's target scope changes
- **THEN** the change SHALL be made once in the shared key-handling document declaration
- **AND** the build-output checks SHALL pick it up with no per-document special case in the test

### Requirement: Target-Scoped Document Checks Fail With A Stated Assertion

The build-output checks SHALL fail with an assertion naming the document and the target whenever a document's presence does not match its declared target scope. A document missing from a target that does not declare it SHALL NOT surface as a file-read error, and the checks SHALL establish that a document exists before reading it.

#### Scenario: A document absent from a target that does not declare it fails as an assertion

- **GIVEN** a key-handling document declared for the Chromium target only
- **WHEN** the build-output checks run over the Firefox output
- **THEN** the checks SHALL report a passing absence assertion or a failing assertion naming the document and the target
- **AND** they SHALL NOT raise a file-not-found error from an unguarded read

#### Scenario: A declared document missing from its own target fails as an assertion

- **GIVEN** a key-handling document declared for the Chromium target
- **WHEN** it is absent from the Chromium output
- **THEN** the checks SHALL fail with an assertion naming the document and the target
- **AND** the message SHALL state that the document was expected to be built for that target

#### Scenario: A document present in a target that does not declare it fails as an assertion

- **GIVEN** a key-handling document declared for the Chromium target only
- **WHEN** it is present in the Firefox output
- **THEN** the checks SHALL fail with an assertion naming the document and the target
- **AND** the message SHALL state that the document was expected to be absent from that target

#### Scenario: Existence is established before any read

- **WHEN** the build-output checks resolve a key-handling document in a target's output
- **THEN** they SHALL determine its presence before reading its contents
- **AND** no code path SHALL read a document whose presence has not been asserted
