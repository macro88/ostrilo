## 1. Remove the model

- [x] 1.1 Delete `src/ui/components/logo/ModelViewer.tsx`, `src/ui/components/logo/LazyModel.tsx` and `src/assets/ostrilo.glb`
- [x] 1.2 Remove `three` and `@types/three` from `package.json` and the lockfile
- [x] 1.3 Reduce `Logo` to the static image; drop `mode` from its callers
- [x] 1.4 Remove the `*.glb` module declaration, `assetsInclude` and the `three` entry in `optimizeDeps`

## 2. Keep the guard

- [x] 2.1 Move `KEY_HANDLING_DOCUMENTS` to `src/infrastructure/messaging/key-handling-documents.ts`; delete `MODEL_CAPABLE_DOCUMENTS` and `isModelCapableDocument`
- [x] 2.2 Keep `tests/security/key-handling-bundle.test.ts` failing on WebGL markers in any key-handling document; drop its assertions about the lazy chunk
- [x] 2.3 Update `tests/security/key-material-realm-isolation.test.tsx` to assert every key-handling surface renders an `<img>` and no canvas

## 3. Tighten the CSP

- [x] 3.1 Remove `'self'` from `connect-src` in `wxt.config.ts` and `tests/security/manifest-assertions.test.ts`
- [x] 3.2 Run `pnpm run test:build-output` and the Chromium E2E suite against the tightened policy

## 4. Docs

- [x] 4.1 Update DESIGN_RULES §9, extension-manifest.md, onboarding requirement NS-U-011, roadmap and CHANGELOG
- [x] 4.2 Update the `add-biometric-unlock` delta and path references
