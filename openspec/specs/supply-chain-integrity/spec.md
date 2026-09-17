# Supply Chain Integrity Specification

## Purpose

Define the dependency and tooling guarantees that keep a key-holding developer machine and the published extension trustworthy: pinned locally installed tools, an enforced lockfile, preserved package manager trust settings, verified provenance, and reproducible builds.

## Requirements

### Requirement: Verification Tooling Is Pinned And Locally Installed

Every tool this repository invokes automatically SHALL be declared as an exact-version development dependency, resolved through the local binary, and recorded in the lockfile. No script, git hook, or agent hook SHALL fetch an unpinned package from the network.

#### Scenario: React Doctor is a pinned devDependency

- **WHEN** the package manifest is read
- **THEN** React Doctor appears in `devDependencies` at an exact version with no range prefix
- **AND** the `doctor` script invokes the locally installed binary
- **AND** no script in the manifest contains `npx react-doctor@latest` or any other `@latest` specifier

#### Scenario: Git hook uses the local binary only

- **WHEN** the pre-commit hook runs
- **THEN** it invokes the locally installed React Doctor binary
- **AND** it does NOT fall back to `pnpm dlx`, `npx --yes`, or any other network fetch

#### Scenario: Agent hook uses the local binary only

- **WHEN** the Claude post-edit hook runs
- **THEN** it invokes the locally installed React Doctor binary
- **AND** it does NOT fall back to `pnpm dlx`, `npx --yes`, or any other network fetch

#### Scenario: No unpinned fetch on a key-holding machine

- **GIVEN** the machine running these hooks also holds the developer's signing keys
- **WHEN** any hook executes
- **THEN** no package tree is downloaded and executed outside the lockfile

### Requirement: Tooling Failure Is Loud

When a pinned tool cannot be found or cannot run, the invoking hook SHALL report the failure explicitly and SHALL NOT continue as if the check had passed.

#### Scenario: Missing pinned binary is reported

- **GIVEN** the pinned tool is not installed
- **WHEN** a hook attempts to run it
- **THEN** the hook reports that the tool is missing and names the install command
- **AND** it does NOT print a message that the scan was skipped and then exit successfully

#### Scenario: Install refusal is surfaced

- **GIVEN** the package manager refuses to install the pinned tool, for example because of a trust or provenance check
- **WHEN** the failure occurs
- **THEN** the refusal reason is surfaced to the developer verbatim
- **AND** the pinned version is not silently replaced with a different version to make the install succeed

#### Scenario: Blocked verification is declared in handoff

- **GIVEN** a required verification command could not run
- **WHEN** work is handed off
- **THEN** the exact command, the reason it could not run, and the residual risk are stated

### Requirement: Package Manager Trust Policy Is Not Weakened

The existing pnpm trust and release-age settings SHALL be preserved. A tool that cannot be installed under those settings SHALL be pinned to an installable version, replaced, or dropped, rather than accommodated by relaxing the policy.

#### Scenario: Trust settings are preserved

- **WHEN** the workspace configuration is read
- **THEN** `minimumReleaseAge` and `trustPolicy` remain configured at least as strictly as today
- **AND** no per-package trust override is added to work around a trust downgrade

#### Scenario: Trust downgrade blocks the install

- **GIVEN** a dependency version whose earlier releases carried provenance attestation and whose current release does not
- **WHEN** installation is attempted
- **THEN** the install fails
- **AND** the failure is treated as a supply-chain signal requiring a decision, not as noise to suppress

### Requirement: Lockfile Integrity Is Enforced

The lockfile SHALL be the single source of truth for the dependency tree, and CI SHALL fail on any drift between the manifest and the lockfile.

#### Scenario: Frozen install in CI

- **WHEN** CI installs dependencies
- **THEN** the install runs with a frozen lockfile
- **AND** a manifest change without a matching lockfile update fails the job

#### Scenario: Lockfile changes are reviewable

- **WHEN** a pull request changes the lockfile
- **THEN** the change is visible in review
- **AND** dependency additions can be attributed to a manifest change in the same pull request

### Requirement: Provenance Is Verified For Security-Critical Dependencies

The cryptographic and extension-runtime dependencies SHALL be checked for publish provenance, and a package that loses provenance between versions SHALL require an explicit decision before adoption.

#### Scenario: Provenance is checked on update

- **GIVEN** an update to a cryptographic or extension-runtime dependency
- **WHEN** the update is proposed
- **THEN** the provenance status of the new version is recorded
- **AND** a loss of provenance blocks automatic adoption

#### Scenario: Provenance decisions are recorded

- **WHEN** a dependency without provenance is knowingly adopted
- **THEN** the reason, the reviewer, and the residual risk are recorded in the repository

### Requirement: Dependency Updates Are Automated And Reviewed

The repository SHALL run an automated dependency update mechanism that opens reviewable pull requests, and those pull requests SHALL be subject to the same required verification check as any other change.

#### Scenario: Updates arrive as pull requests

- **WHEN** a dependency has a newer version
- **THEN** an automated pull request is opened
- **AND** it runs the required verification workflow
- **AND** it is not merged automatically without that workflow passing

#### Scenario: Security advisories are prioritized

- **GIVEN** an advisory affects an installed dependency
- **WHEN** the update mechanism runs
- **THEN** the advisory-driven update is distinguishable from routine version bumps

### Requirement: Published Builds Are Reproducible

A user SHALL be able to verify that a published extension artifact was built from the tagged source. The build SHALL be deterministic given the same source, lockfile and toolchain, and the verification procedure SHALL be documented.

#### Scenario: Same source produces the same artifact

- **GIVEN** a source tag, its lockfile, and the recorded toolchain versions
- **WHEN** the Chrome and Firefox builds are run twice
- **THEN** the resulting artifacts are byte-identical
- **AND** any nondeterministic input is identified and eliminated or documented

#### Scenario: Verification procedure is published

- **WHEN** a release is published
- **THEN** the repository documents the toolchain versions, the build commands, and the artifact checksums
- **AND** a third party can follow that procedure to reproduce and compare the artifacts

### Requirement: Code Quality Tooling Is Not A Release Gate

The mandate to run a code-quality linter SHALL require running the pinned tool and acting on its findings, and SHALL NOT make a numeric score a blocking condition for handoff or commit. Security and correctness gates SHALL remain blocking.

#### Scenario: Linter mandate is achievable

- **WHEN** the contributor and agent instructions describe the code-quality tool
- **THEN** they require running the pinned local tool and addressing findings
- **AND** they do NOT require a specific numeric score before work may be handed off or committed
- **AND** they state what to do when the tool cannot run

#### Scenario: Security gates remain blocking

- **WHEN** the instructions are revised
- **THEN** typechecking, the unit, integration and security suites, both builds, and the dependency audit remain blocking
- **AND** only the code-quality score requirement is relaxed
