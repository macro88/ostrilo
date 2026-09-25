# key-material-isolation Specification

## Purpose

Defines the boundary around extension documents that can hold a private key, master password, or backup passphrase. Such documents load a minimal dependency set with no decorative 3D or WebGL code, the document set is declared once for both the UI and the build guard, and key material never crosses between documents.
## Requirements
### Requirement: Key Handling Documents Exclude Decorative Dependencies

Any extension document that can hold a private key or a master password SHALL load a minimal dependency set. Such documents MUST NOT include 3D rendering, WebGL, model loading, or other decorative third-party libraries.

#### Scenario: Build output contains no 3D library in key handling documents

- **GIVEN** a production build for Chrome or Firefox
- **WHEN** the chunks reachable from a key-handling document are inspected
- **THEN** none of them SHALL contain the `three` library or its GLTF loader
- **AND** none of them SHALL construct a WebGL renderer

#### Scenario: Key handling surfaces render without WebGL

- **WHEN** the create-key step, the backup step, or the unlock step is rendered
- **THEN** the surface SHALL render its mascot as a static image
- **AND** SHALL NOT initialise a WebGL context

#### Scenario: Reintroducing a heavy dependency fails the build guard

- **GIVEN** a build guard that inspects the chunks reachable from each key-handling document
- **WHEN** a change makes a 3D or other disallowed decorative dependency reachable from such a document
- **THEN** the guard SHALL fail with the offending document and dependency named

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

### Requirement: Key Material Does Not Cross The Realm Boundary

When the user moves between the key-handling document and other extension documents, the extension MUST NOT transfer a private key, a master password, or a backup passphrase across that boundary.

#### Scenario: Navigation carries no secrets

- **GIVEN** the user completes the create-key flow in the key-handling document
- **WHEN** the extension navigates to the main surface
- **THEN** no private key, master password, or backup passphrase SHALL be passed in a URL, query string, hash fragment, or broadcast message
- **AND** the receiving document SHALL determine vault state from the background service instead

#### Scenario: Secrets are not staged in storage for handoff

- **WHEN** the extension hands off between documents during onboarding
- **THEN** it SHALL NOT write a private key, master password, or backup passphrase to `chrome.storage`, `localStorage`, or `sessionStorage` as part of the handoff

#### Scenario: Leaving the key handling document tears down key material

- **GIVEN** the key-handling document holds a revealed key or a password
- **WHEN** the document is left or closed
- **THEN** the flow SHALL drop its references to that material before the document unloads

