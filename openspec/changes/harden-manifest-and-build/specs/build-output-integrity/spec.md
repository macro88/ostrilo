## ADDED Requirements

### Requirement: Production Builds Contain No Debug Console Output

Production builds SHALL NOT contain `console` calls. The build configuration MUST remove them so that a debug statement in application code cannot leak runtime state into a user's browser console.

#### Scenario: Background bundle has no console calls

- **WHEN** a production Chrome build is generated
- **THEN** the generated `background.js` contains no occurrence of `console.log`
- **AND** it contains no occurrence of `console.debug`, `console.warn`, or `console.error`

#### Scenario: Every production bundle has no console calls

- **WHEN** a production build is generated for any target
- **THEN** no JavaScript file in the output directory contains a `console` call

#### Scenario: Development builds keep console output

- **WHEN** the development server build is generated
- **THEN** console calls remain present so developers retain diagnostics

#### Scenario: The drop setting is owned by the build configuration

- **WHEN** the build configuration is read
- **THEN** the console-drop setting is declared once, in the build configuration
- **AND** application code is not required to guard `console` calls behind an environment check

### Requirement: Production Builds Emit No Source Maps

Production builds SHALL NOT emit source maps, inline or external, so that the shipped artifact does not include a reconstructable copy of the signer source.

#### Scenario: No external source map files

- **WHEN** a production build is generated for any target
- **THEN** the output directory contains no file with a `.map` extension

#### Scenario: No inline source maps

- **WHEN** a production build is generated for any target
- **THEN** no JavaScript file in the output directory contains a `sourceMappingURL` comment

### Requirement: The Published Extension Archive Contains Only Files The Extension Needs

The extension archive SHALL contain only files the manifest or the runtime references. Unreferenced assets MUST NOT be shipped.

#### Scenario: Unreferenced root icons are not shipped

- **WHEN** the extension archive is produced
- **THEN** it does not contain a top-level `icon.png`
- **AND** it does not contain a top-level `icon.svg`
- **AND** it does contain the sized icon files the manifest `icons` key references

#### Scenario: Archive contains no source maps

- **WHEN** the extension archive is produced
- **THEN** it contains no file with a `.map` extension

#### Scenario: Archive contents are enumerable

- **WHEN** the extension archive is produced
- **THEN** every file in the archive matches an entry in the shipped-file allowlist recorded in the build configuration or the manifest assertion test

### Requirement: The Published Sources Archive Excludes Local Development Artifacts

The sources archive produced for Firefox review SHALL contain only source needed to rebuild the extension. It MUST NOT contain local test output, browser profile data, coverage output, or editor and agent tooling state.

#### Scenario: Playwright output is excluded

- **WHEN** the sources archive is produced
- **THEN** it contains no file under `test-results/`
- **AND** it contains no browser profile directory captured from an end-to-end run

#### Scenario: Test artifacts do not dominate the archive

- **WHEN** the sources archive is produced from a working tree that has just run the end-to-end suite
- **THEN** the archive size does not grow with the size of the local test output directory

#### Scenario: Build output and dependency directories are excluded

- **WHEN** the sources archive is produced
- **THEN** it contains no file under the build output directory
- **AND** it contains no file under `node_modules/`
- **AND** it contains no coverage report

#### Scenario: Rebuild inputs are included

- **WHEN** the sources archive is produced
- **THEN** it contains `package.json`, the lockfile, `wxt.config.ts`, `tsconfig.json`, and the `src/` and `public/` trees
- **AND** a reviewer can install dependencies and produce the submitted build from its contents

#### Scenario: Exclusions do not depend on gitignore

- **WHEN** the sources archive configuration is read
- **THEN** every exclusion is declared explicitly in the build configuration
- **AND** no exclusion relies on the build tool reading `.gitignore`

### Requirement: The Build Is Documented As Reproducible Or The Gap Is Recorded

The project SHALL document how a user can rebuild the published artifact from source and compare it against what was published, and SHALL record any step that currently prevents a byte-identical comparison.

#### Scenario: Rebuild instructions exist

- **WHEN** a user reads the build documentation
- **THEN** it states the pinned package manager version, the Node version, and the exact commands that produce the published artifact

#### Scenario: Known non-determinism is recorded

- **WHEN** a user reads the build documentation
- **THEN** every known source of build non-determinism is listed
- **AND** each listed source states whether it is fixed in this change or tracked as future work

#### Scenario: Comparison procedure is stated

- **WHEN** a user wants to verify a published release against this source
- **THEN** the documentation states which files can be compared and how to obtain a digest of each
