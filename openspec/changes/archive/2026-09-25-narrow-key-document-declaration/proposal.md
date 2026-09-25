## Why

The requirement "Key Handling Documents Are Declared In One Place" says the UI consults `KEY_HANDLING_DOCUMENTS` to decide whether a surface may render key-handling steps. That consumer was `Logo`'s model-capable check, removed with the 3D mascot in `2026-09-25-remove-3d-mascot`. No UI code reads the declaration now, so the scenario describes a check that does not exist and can never fail.

## What Changes

- The declaration's consumers are the two security guards that walk it: the build-output guard in `tests/security/key-handling-bundle.test.ts`, which inspects each listed document's module graph, and `tests/security/key-material-realm-isolation.test.tsx`, which fails when a shipped document is missing from the list.
- The scenario is restated against those two guards. UI code still must not repeat document names as literals.

No code changes.

## Capabilities

### Modified Capabilities

- `key-material-isolation`: "Key Handling Documents Are Declared In One Place" names the guards that read the declaration instead of the UI.

## Impact

- Specs only.
