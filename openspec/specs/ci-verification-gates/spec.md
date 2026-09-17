# ci-verification-gates Specification

## Purpose

Defines the continuous integration checks a change must pass before it can merge: typechecking, the unit, integration and security suites, both browser builds, and a dependency audit. Also fixes where the E2E cadence is declared and requires lockfile-only dependency installs.

## Requirements

### Requirement: CI Runs The Full Verification Suite On Every Pull Request

The repository SHALL provide a continuous integration workflow that runs TypeScript typechecking and the unit, integration and security Vitest suites on every pull request and on every push to the default branch.

#### Scenario: Pull request triggers verification

- **WHEN** a pull request is opened, synchronized, reopened, or marked ready for review
- **THEN** the verification workflow runs `tsc --noEmit`
- **AND** it runs the unit suite
- **AND** it runs the integration suite
- **AND** it runs the security suite
- **AND** any failure fails the workflow

#### Scenario: Default branch push triggers verification

- **WHEN** a commit lands on the default branch
- **THEN** the same verification workflow runs

#### Scenario: Security suite failure is not skippable

- **GIVEN** a failing security test
- **WHEN** the workflow runs
- **THEN** the workflow fails
- **AND** the security suite is not marked as advisory, continue-on-error, or allowed to fail

### Requirement: CI Is A Required Status Check

The verification workflow SHALL be configured as a required status check on the default branch, so that no change merges without it passing.

#### Scenario: Merge is blocked on failure

- **GIVEN** the verification workflow has failed for a pull request
- **WHEN** a merge is attempted
- **THEN** the merge is blocked

#### Scenario: Required check is recorded

- **WHEN** branch protection is configured
- **THEN** the verification workflow job name is listed as required
- **AND** the configuration is documented in the repository so it can be re-created

### Requirement: Both Browser Builds Are Verified In CI

The workflow SHALL build the Chrome MV3 and Firefox MV2 targets, so that a change which compiles but does not package is caught before merge.

#### Scenario: Chrome and Firefox builds run

- **WHEN** the verification workflow runs
- **THEN** it runs the Chrome extension build
- **AND** it runs the Firefox extension build
- **AND** a failure in either build fails the workflow

### Requirement: Dependency Audit Runs In CI

The workflow SHALL run a dependency vulnerability audit on every pull request and SHALL fail on findings at or above an agreed severity threshold.

#### Scenario: Audit runs and gates on severity

- **WHEN** the verification workflow runs
- **THEN** a dependency audit is executed against the installed dependency tree
- **AND** findings at or above the agreed severity threshold fail the workflow
- **AND** the threshold and any accepted exceptions are recorded in the repository

#### Scenario: Audit result is legible

- **GIVEN** the audit reports a finding
- **WHEN** a reviewer opens the workflow run
- **THEN** the affected package, the advisory, and the dependency path are visible in the log

### Requirement: E2E Coverage Runs On A Defined Cadence

The repository SHALL define, in one place, when the Playwright extension suite runs, and SHALL keep that decision separate from the required verification check so that browser flakiness cannot block unrelated merges.

#### Scenario: E2E cadence is defined

- **WHEN** the CI configuration is read
- **THEN** the trigger for the Playwright suite is explicit
- **AND** whether it is a required check is explicit
- **AND** the reasoning for that choice is recorded

#### Scenario: E2E can be requested on a pull request

- **GIVEN** a pull request that changes extension entrypoints, approval flows, or the NIP-07 provider
- **WHEN** the author or a reviewer requests the E2E run
- **THEN** the Playwright suite runs for that pull request without requiring a configuration change

### Requirement: CI Installs From The Lockfile Only

The workflow SHALL install dependencies with a frozen lockfile and SHALL NOT fetch any unpinned package at job runtime.

#### Scenario: Frozen lockfile install

- **WHEN** the workflow installs dependencies
- **THEN** the install uses the committed lockfile without modifying it
- **AND** a lockfile that does not match the manifest fails the job

#### Scenario: No runtime package fetch

- **WHEN** any workflow step runs a tool
- **THEN** the tool is resolved from the installed dependency tree
- **AND** no step invokes a package specifier resolved to `latest`
