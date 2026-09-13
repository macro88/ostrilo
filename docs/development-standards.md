# Ostrilo Development Standards

These standards are binding for all code changes. They summarize the conventions already documented across the repo so contributors and agents have one pre-flight and handoff checklist.

## Source Documents

- `docs/architecture_primer.md` and `docs/developers_readme.md` define the layered, ports-and-adapters architecture.
- `docs/ostrilo-signer-requirements.md` and `docs/v2-prd.md` define product, protocol, security, and privacy contracts.
- `docs/rpc-architecture.md` and `docs/rpc-error-codes.md` define messaging structure and dApp-facing error behavior.
- `docs/design/DESIGN_RULES.md` defines the canonical Inkline UI system.
- `docs/TESTING.md` defines the verification strategy and available test commands.

If these documents conflict, prefer the most specific current document for the area being changed. For UI work, `docs/design/DESIGN_RULES.md` wins over all older notes.

## Architecture Rules

- Preserve the hexagonal architecture boundaries:
  - `src/domain` contains pure business rules, types, and side-effect-free utilities.
  - `src/application` contains services, use cases, and ports.
  - `src/infrastructure` contains adapters for browser APIs, crypto, storage, relay, and messaging.
  - `src/extension` contains browser extension entry points and runtime wiring.
  - `src/ui` contains React presentation, feature components, hooks, and local UI state.
- Prefer existing services, ports, adapters, hooks, and component primitives before adding new patterns.
- Keep cross-layer dependencies pointed inward through ports and services. UI and extension code should not bypass application services to reach storage, crypto, or domain internals directly.
- **Cryptographic primitives live in `src/infrastructure/crypto/` and nowhere else.** Every other layer reaches them through the ports in `src/application/ports/crypto.ts` - `CryptoAead`, `CryptoKdf`, `Schnorr`, `CryptoHash`, `Bech32Codec` - and receives an adapter by injection. This is enforced, not advisory: `eslint.config.js` fails any `@noble/*` or `@scure/*` import outside the adapter directory (`pnpm run lint`), and `tests/security/crypto-single-implementation.test.ts` fails if a primitive gains a second implementation anywhere under `src/`, including inside the adapter directory where lint permits the import. If you need a primitive that has no port, add the port; do not add the import.
- Put new RPC behavior into typed request/response definitions, namespace handlers, and service methods rather than expanding ad hoc message handling.

## Security And Privacy Rules

- Preserve background-only signing and key operations. Page scripts, content scripts, and UI surfaces must never receive plaintext private keys or passphrases.
- Store private material only as encrypted ciphertext at rest, with per-record salt/iv where applicable.
- Validate all untrusted inputs at the boundary before they reach services or cryptographic operations.
- Return standardized RPC error codes from `src/infrastructure/messaging/error-codes.ts`; do not invent dApp-facing strings inline.
- Zeroize sensitive `Uint8Array` material when it is no longer needed and avoid long-lived secret references.
- Keep extension permissions minimal, avoid remote code, and do not add telemetry or background network behavior without explicit product approval.
- Treat browser-fetched profile or relay data as untrusted until validated.

## UI Rules

- Follow `docs/design/DESIGN_RULES.md` for every UI change.
- Do not reintroduce gradients, accent rails, dot-grid backgrounds, retired Arcade Plush class names, pink/candy palette choices, or other banned Inkline patterns.
- Use shared UI primitives and tokens from the existing design system instead of hard-coded colors or one-off component styling.
- Keep signing and approval surfaces data-forward: show the payload, origin, event kind, trust state, and action consequences clearly.

## Verification Rules

- Before handing off, verify the work at the level of risk and surface area changed. Prefer focused checks first, then broader checks when shared behavior is touched.
- Run `pnpm run compile` after TypeScript changes.
- Run `pnpm run lint` after any change that touches cryptographic code or adds an import under `src/`. It carries one rule - the crypto layer boundary above - and is blocking in CI.
- Run relevant Vitest suites for changed domain, application, infrastructure, security, and UI logic. Use `pnpm test` when changes cross layers or risk is broad.
- Run Playwright extension tests for user workflows, browser-extension integration, onboarding, approval, NIP-07, options, or permission-policy changes.
- Run `pnpm run build` when changes affect extension entry points, manifests, bundling, assets, or runtime wiring. Add `pnpm run build:firefox` when cross-browser behavior could be affected.
- After code edits, run the pinned local React Doctor with `pnpm run doctor` and address the findings in the files you changed. Report the score; do not gate on it, and do not disable rules to lower the count. Never invoke it via `npx`, `pnpm dlx`, or `@latest`: that executes an unpinned dependency tree on a machine holding signing keys.
- If React Doctor cannot run, first try `pnpm install --frozen-lockfile`. If it still cannot run, state the exact command and the verbatim failure. A security or quality tool that could not run is a failure to report, never a silent pass.
- `pnpm run compile`, `pnpm run test`, both builds, and the dependency audit remain blocking regardless of the React Doctor result.
- For docs-only changes, verify local links and references instead of running the application test suite unless the docs change also modifies executable examples or scripts.
- If a required verification command cannot run, state the exact command, why it could not run, and what residual risk remains.

## Agent Workflow

- Read the relevant source documents and nearby implementation before editing.
- Keep changes scoped to the requested behavior and current codebase conventions.
- Do not suppress rules, bypass checks, or replace established patterns to make a warning disappear.
- In the final handoff, list the standards-sensitive areas touched and the verification commands that passed or were blocked.
