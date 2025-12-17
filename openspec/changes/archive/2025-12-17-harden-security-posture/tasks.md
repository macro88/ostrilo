# Tasks: Harden Security Posture

## Phase 1: RPC Validation (Infrastructure)
- [x] Create `ActivityFilterSchema` in `src/infrastructure/validation/schemas.ts`
- [x] Create `ApprovalActionSchema` in `src/infrastructure/validation/schemas.ts`
- [x] Update `ActivityRpcHandler` to validate inputs using `ActivityFilterSchema`
- [x] Update `ApprovalRpcHandler` to validate inputs using `ApprovalActionSchema`
- [x] Verify all other RPC handlers have input validation

## Phase 2: Password Zeroization (Backend)
- [x] Remove `_sessionPassword` property from `KeyVaultService`
- [x] Update `unlock` method to zeroize password and derived keys immediately
- [x] Update `generateKey` and `importKey` to require `password` argument
- [x] Ensure `generateKey` and `importKey` zeroize sensitive data after use
- [x] Remove `SESSION_PASSWORD_KEY` constant if it still exists

## Phase 3: Secure UI Inputs (Frontend)
- [x] Refactor `LockScreen` to use `useRef` for password input
- [x] Refactor `OnboardingCreateKey` to use `useRef` for password input
- [x] Refactor `OnboardingImportKey` to use `useRef` for private key and password
- [x] Update `AddKeyDialog` to include password field and use `useRef`
- [x] Ensure `AddKeyDialog` passes password to `generateKey`/`importKey` RPCs

## Phase 4: Secure Key Backup (Full Stack)
- [x] Update `generateKey` RPC to return only `{ id, pubkey }` (remove `nsec`)
- [x] Implement `revealKey` RPC method in `KeyVaultService` and `VaultRpcHandler`
- [x] Update `OnboardingCreateKey` to use `revealKey` for backup step
- [x] Ensure `OnboardingCreateKey` does not store `nsec` in `useState`
- [x] Verify "Copy to Clipboard" functionality works without state persistence
