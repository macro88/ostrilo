# Implementation Tasks: Standardize RPC Error Responses

## 2026-06-11 Review Status

This change is ready for development, but it is a breaking RPC migration. Keep it in one branch and update types, handlers, client parsing, content/injected propagation, and tests together.

## Task 1: Define JSON-RPC Error Types and Mapping
**Status:** ⏸️ Not Started  
**Estimated Effort:** 2–4 hours  
**Dependencies:** None

- [ ] Define a `RpcErrorObject` type with `{ code: number; message: string; data?: ... }`
- [ ] Add/standardize canonical machine codes (including `invalid_params`, `rate_limited`, `network_error`)
- [ ] Centralize mapping from machine code → numeric JSON-RPC code and default message
- [ ] Add unit tests for mapping and message defaults

---

## Task 2: Update RpcResponse Type (Breaking)
**Status:** ⏸️ Not Started  
**Estimated Effort:** 1–2 hours  
**Dependencies:** Task 1

- [ ] Update `RpcResponse` error branch to use `error: RpcErrorObject`
- [ ] Update any method-specific response unions that duplicate the error shape
- [ ] Ensure TypeScript compile passes

---

## Task 3: Standardize Error Construction in Router + Handlers
**Status:** ⏸️ Not Started  
**Estimated Effort:** 3–6 hours  
**Dependencies:** Task 1–2

- [ ] Introduce a single helper to construct errors (sets numeric code + message + `data.errorCode`)
- [ ] Update `rpc-router` error fallbacks (invalid request, unknown namespace/method) to use structured errors
- [ ] Update all handler modules to return structured errors
- [ ] Ensure no ad-hoc error literals remain in handlers

---

## Task 4: Update Client Parsing and Error Propagation
**Status:** ⏸️ Not Started  
**Estimated Effort:** 3–6 hours  
**Dependencies:** Task 2–3

- [ ] Update `rpc()` client to parse the structured error object
- [ ] Preserve stable machine error code for branching (e.g., expose `error.data.errorCode`)
- [ ] Decide and implement how thrown `Error` objects represent failures (machine code vs message)
- [ ] Update UI hooks/components that rely on error strings

---

## Task 5: Update NIP-07 / Injected Error Surface
**Status:** ⏸️ Not Started  
**Estimated Effort:** 2–4 hours  
**Dependencies:** Task 4

- [ ] Ensure NIP-07 methods surface consistent error semantics
- [ ] Confirm injected/content boundaries do not receive sensitive debug context

---

## Task 6: Update Tests
**Status:** ⏸️ Not Started  
**Estimated Effort:** 2–6 hours  
**Dependencies:** Task 1–5

- [ ] Update unit/integration tests asserting RPC errors to use the new structure
- [ ] Add tests that cover key codes: LOCKED, NEEDS_APPROVAL, DENIED, INVALID_EVENT, RATE_LIMITED, NETWORK_ERROR
- [ ] Add tests for router-level errors (invalid request, unknown namespace/method)

---

## Task 7: Validation
**Status:** ⏸️ Not Started

- [ ] Run `pnpm run compile`
- [ ] Run `pnpm run build` and `pnpm run build:firefox`
- [ ] Run relevant test suites (unit/integration/e2e as appropriate)
