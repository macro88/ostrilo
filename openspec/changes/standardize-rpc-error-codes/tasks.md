## Prerequisites

- [x] Review existing error strings across all RPC handlers and services
- [x] Identify all unique error scenarios requiring codes
- [x] Design error code naming convention and structure

## 1. Error Code Foundation

- [ ] 1.1 Create `src/infrastructure/messaging/error-codes.ts` with `RPC_ERROR_CODES` constant object
- [ ] 1.2 Define all standard error codes: `LOCKED`, `DENIED`, `NEEDS_APPROVAL`, `INVALID_EVENT`, `INVALID_ORIGIN`, `INVALID_PASSWORD`, `INVALID_KEY_INPUT`, `INVALID_HASH`, `INVALID_REQUEST`, `NO_KEY_SELECTED`, `KEY_ALREADY_EXISTS`, `TIMEOUT`, `UNKNOWN_METHOD`, `UNKNOWN_NAMESPACE`, `APPROVAL_FAILED`
- [ ] 1.3 Export `RpcErrorCode` type as union of all code values
- [ ] 1.4 Add JSDoc comments documenting when each code should be used

## 2. RPC Type Updates

- [ ] 2.1 Update `RpcResponse` type in `src/infrastructure/messaging/rpc.ts` to add optional `details?: string` field to error variant
- [ ] 2.2 Update specialized response types (`NostrGetPublicKeyResponse`, `NostrSignEventResponse`, etc.) to match new RpcResponse structure
- [ ] 2.3 Import and re-export `RPC_ERROR_CODES` and `RpcErrorCode` from `rpc.ts` for convenience
- [ ] 2.4 Run `npm run compile` to verify type changes don't break existing code

## 3. RpcRouter Error Standardization

- [ ] 3.1 Update `RpcRouter.handleRequest` catch block to return `{ ok: false, error: RPC_ERROR_CODES.UNKNOWN_METHOD, details: error.message }`
- [ ] 3.2 Update invalid namespace error to use `RPC_ERROR_CODES.UNKNOWN_NAMESPACE`
- [ ] 3.3 Update invalid message type error to use `RPC_ERROR_CODES.INVALID_REQUEST`
- [ ] 3.4 Update `createRpcMessageListener` error handling to use standard codes

## 4. Vault RPC Handler Updates

- [ ] 4.1 Update `vault-rpc.ts` unsupported method error to `RPC_ERROR_CODES.UNKNOWN_METHOD`
- [ ] 4.2 Update password validation failures to `RPC_ERROR_CODES.INVALID_PASSWORD` with Zod message in details
- [ ] 4.3 Update key input validation failures to `RPC_ERROR_CODES.INVALID_KEY_INPUT` with details
- [ ] 4.4 Update label validation failures to use details field instead of inline message
- [ ] 4.5 Update key ID validation failures to use details field
- [ ] 4.6 Update hash validation failures to `RPC_ERROR_CODES.INVALID_HASH` with details
- [ ] 4.7 Add try-catch around service calls to translate service errors (e.g., `key_locked_or_missing` → `LOCKED`)

## 5. Nostr RPC Handler Updates

- [ ] 5.1 Update `nostr-rpc.ts` unsupported method error to `RPC_ERROR_CODES.UNKNOWN_METHOD`
- [ ] 5.2 Update `vault_locked` error to `RPC_ERROR_CODES.LOCKED`
- [ ] 5.3 Update `no_key_selected` error to `RPC_ERROR_CODES.NO_KEY_SELECTED`
- [ ] 5.4 Update `policy_denied` error to `RPC_ERROR_CODES.DENIED` with details about policy mode
- [ ] 5.5 Update `approval_required` error to `RPC_ERROR_CODES.NEEDS_APPROVAL`
- [ ] 5.6 Update `user_denied` error to `RPC_ERROR_CODES.DENIED` with details "user rejected"
- [ ] 5.7 Update `approval_failed` catch block to use `RPC_ERROR_CODES.APPROVAL_FAILED` with error message in details
- [ ] 5.8 Update event validation error to `RPC_ERROR_CODES.INVALID_EVENT` with Zod message in details
- [ ] 5.9 Update origin validation error to `RPC_ERROR_CODES.INVALID_ORIGIN` with details

## 6. Policy RPC Handler Updates

- [ ] 6.1 Update `policy-rpc.ts` unsupported method error to `RPC_ERROR_CODES.UNKNOWN_METHOD`
- [ ] 6.2 Update origin validation failures to `RPC_ERROR_CODES.INVALID_ORIGIN` with details
- [ ] 6.3 Update kind validation failures to use details field
- [ ] 6.4 Add error handling for policy service exceptions

## 7. Settings RPC Handler Updates

- [ ] 7.1 Update `settings-rpc.ts` unsupported method error to `RPC_ERROR_CODES.UNKNOWN_METHOD`
- [ ] 7.2 Update patch validation failures to use details field
- [ ] 7.3 Add error handling for settings service exceptions

## 8. State RPC Handler Updates

- [ ] 8.1 Update `state-rpc.ts` unsupported method error to `RPC_ERROR_CODES.UNKNOWN_METHOD`
- [ ] 8.2 Add error handling for vault service exceptions

## 9. Crypto RPC Handler Updates

- [ ] 9.1 Update `crypto-rpc.ts` unsupported method error to `RPC_ERROR_CODES.UNKNOWN_METHOD`
- [ ] 9.2 Update password validation failures to `RPC_ERROR_CODES.INVALID_PASSWORD` with details
- [ ] 9.3 Update key input validation failures to `RPC_ERROR_CODES.INVALID_KEY_INPUT` with details

## 10. Approval RPC Handler Updates

- [ ] 10.1 Update `approval-rpc.ts` unsupported method error to `RPC_ERROR_CODES.UNKNOWN_METHOD`
- [ ] 10.2 Update "Request not found" error to use standard code (consider adding `NOT_FOUND` to error codes)
- [ ] 10.3 Wrap error messages in details field while using appropriate error codes

## 11. Service Layer Error Review (No Changes, Documentation Only)

- [ ] 11.1 Document KeyVaultService error messages and their RPC code mappings
- [ ] 11.2 Document ApprovalQueueService error messages and their RPC code mappings
- [ ] 11.3 Verify service layer errors remain as Error objects (no changes needed)
- [ ] 11.4 Create internal documentation mapping service errors → RPC codes

## 12. Content Script Updates

- [ ] 12.1 Review `content.ts` error forwarding to ensure it passes through error codes unchanged
- [ ] 12.2 Update generic error messages to use standard codes if applicable
- [ ] 12.3 Verify error propagation from background → content → injected script

## 13. Unit Test Updates - RPC Handlers

- [ ] 13.1 Update `tests/unit/infrastructure/rpc-handlers.test.ts` router tests to use exact error code matching
- [ ] 13.2 Update VaultRpcHandler tests to check for new error codes
- [ ] 13.3 Update NostrRpcHandler tests to check `LOCKED`, `NO_KEY_SELECTED`, `DENIED`, `INVALID_EVENT`, `INVALID_ORIGIN`
- [ ] 13.4 Update PolicyRpcHandler tests if any error assertions exist
- [ ] 13.5 Update SettingsRpcHandler tests if any error assertions exist
- [ ] 13.6 Update ApprovalRpcHandler tests to use new error codes
- [ ] 13.7 Add tests for `details` field when validation errors occur

## 14. Unit Test Updates - RPC Validation

- [ ] 14.1 Update `tests/unit/infrastructure/rpc-validation.test.ts` to check exact error codes
- [ ] 14.2 Replace all `.toContain()` assertions with exact `.toBe()` for error codes
- [ ] 14.3 Add assertions for `details` field content where relevant

## 15. Unit Test Updates - Services

- [ ] 15.1 Update `tests/unit/application/keyvault.service.test.ts` error checks (if any affect RPC layer)
- [ ] 15.2 Review other service tests for error message dependencies

## 16. Integration Test Updates

- [ ] 16.1 Update `tests/integration/cross-layer.test.ts` to use new error codes
- [ ] 16.2 Update `tests/integration/rpc-type-safety.test.ts` to verify error code types
- [ ] 16.3 Update `tests/integration/rpc-validation-integration.test.ts` to check error codes

## 17. E2E Test Updates

- [ ] 17.1 Update `tests/e2e/nip07-provider.spec.ts` to expect new error codes (e.g., `locked` instead of `vault_locked`)
- [ ] 17.2 Update `tests/e2e/approval-flow.spec.ts` to check for `DENIED`, `TIMEOUT` codes
- [ ] 17.3 Update `tests/e2e/settings-origin-policy.spec.ts` if it checks error messages
- [ ] 17.4 Update onboarding E2E tests if they check error codes

## 18. Documentation

- [ ] 18.1 Create `docs/rpc-error-codes.md` documenting all standard error codes
- [ ] 18.2 Add "When to Use" section for each error code with examples
- [ ] 18.3 Document the optional `details` field and when it's populated
- [ ] 18.4 Create dApp developer migration guide mapping old errors → new codes
- [ ] 18.5 Update `docs/rpc-architecture.md` to include error code section
- [ ] 18.6 Add error code examples to NIP-07 integration documentation

## 19. Build & Validation

- [ ] 19.1 Run `npm run compile` to verify all TypeScript changes are valid
- [ ] 19.2 Run `npm run build` to ensure production build succeeds
- [ ] 19.3 Run full test suite: `npm test`
- [ ] 19.4 Run E2E tests: `npm run test:e2e` (both Chrome and Firefox if available)
- [ ] 19.5 Manual testing: Trigger each error code scenario through the UI

## 20. Error Code Coverage Verification

- [ ] 20.1 Create test to verify every error code in `RPC_ERROR_CODES` is used at least once
- [ ] 20.2 Create test to verify no hardcoded error strings remain (use AST or grep-based check)
- [ ] 20.3 Review coverage report to ensure all error paths tested

## Implementation Notes

- **Parallelization**: Tasks 4-10 (handler updates) can be done in parallel after task 1-3 are complete
- **Testing strategy**: Update tests immediately after updating each handler to verify correctness
- **Validation points**: Run `npm run compile` after tasks 2, 4-10, and 12; run full test suite after task 17
- **Breaking change awareness**: Task 17.1 represents the breaking change for dApps - document carefully
