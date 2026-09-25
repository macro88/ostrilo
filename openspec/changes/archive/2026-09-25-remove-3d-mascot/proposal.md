## Why

The 3D mascot is not going to be used in the extension. It was already inert: `MODEL_CAPABLE_DOCUMENTS` in `src/ui/components/logo/key-handling-documents.ts` is empty, so `Logo` downgraded every `mode="model"` request to the static PNG, and no shipped document ever instantiated WebGL. What remained was cost with no benefit:

- `three` (a runtime dependency) and `@types/three`, plus a lazily loaded chunk and a 115 KB `.glb` in every build.
- 170 lines of untestable WebGL code counted against coverage.
- `connect-src 'self'` in the extension CSP, whose only recorded justification was `GLTFLoader` fetching the bundled model.

## What Changes

- Delete `ModelViewer.tsx`, `LazyModel.tsx` and `src/assets/ostrilo.glb`; remove `three` and `@types/three`.
- `Logo` renders the static image only. The `mode` prop, the lazy boundary and the fallback error boundary go with the model.
- `MODEL_CAPABLE_DOCUMENTS` and `isModelCapableDocument` are removed. `KEY_HANDLING_DOCUMENTS` stays, moved to `src/infrastructure/messaging/key-handling-documents.ts`, and the build guard in `tests/security/key-handling-bundle.test.ts` keeps inspecting every key-handling document for WebGL markers.
- **Tightening**: `connect-src` drops `'self'`. Nothing in an extension page fetches a bundled file.
- Remove the `.glb` asset handling and the `three` pre-bundling from `wxt.config.ts`.

## Capabilities

### Modified Capabilities

- `key-material-isolation`: removes "Decorative 3D Model Loads Behind A Lazy Boundary". The exclusion requirement and its build guard are unchanged.
- `extension-manifest-policy`: `connect-src` no longer includes `'self'`.

## Impact

- Code: `src/ui/components/logo/`, `src/types/assets.d.ts`, `src/ui/features/authentication/components/LockScreen.tsx`, `src/ui/features/onboarding/components/OnboardingWelcome.tsx`, `wxt.config.ts`, `package.json`.
- Tests: `tests/security/key-handling-bundle.test.ts`, `tests/security/key-material-realm-isolation.test.tsx`, `tests/security/manifest-assertions.test.ts`.
- Docs: `docs/design/DESIGN_RULES.md` §9, `docs/extension-manifest.md`, `docs/ostrilo-onboarding-requirements.md` NS-U-011, `docs/roadmap.md`, `CHANGELOG.md`.
- In-flight change `add-biometric-unlock`: its `extension-manifest-policy` delta and its `KEY_HANDLING_DOCUMENTS` path references are updated to match.
