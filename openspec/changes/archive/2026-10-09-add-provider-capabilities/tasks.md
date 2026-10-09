## 1. Provider

- [x] 1.1 `src/domain/nostr/provider-methods.ts`: the method list, its type and a guard
- [x] 1.2 `injected.ts`: build the provider from the list, add the frozen `capabilities`, keep every existing freeze and the leave-an-existing-provider-alone rule
- [x] 1.3 `content.ts`: check the allowlist against the same list

## 2. Tests

- [x] 2.1 Unit: `capabilities.methods` equals the implemented method set, is a bare `{ methods }`, is frozen, an existing provider is left in place
- [x] 2.2 Security: a page cannot reassign, redefine, delete or extend `capabilities` or its list; existing immutability still holds
- [x] 2.3 Chrome e2e: a page reads `capabilities` and cannot change it

## 3. Docs

- [x] 3.1 `docs/api-versioning.md`, linked from `docs/README.md` and `docs/developers_readme.md`
- [x] 3.2 Feature-detection snippet in `docs/developers_readme.md`
- [x] 3.3 Archive this change (Task 14 of phase 0.10)
