# Harden Security Posture

## Summary
This proposal addresses critical and high-severity security vulnerabilities identified in the `DEEP_REVIEW_2025-12-15.md` audit. It focuses on enforcing the "background-first" security model by removing sensitive data from memory and UI state, and strengthening the RPC layer with comprehensive input validation.

## Motivation
A recent deep code review revealed that the current implementation compromises the project's core security goals. Specifically:
1.  **Raw Password in Memory:** The master password is stored in a long-lived class property in the background service, defeating the purpose of zeroization.
2.  **Secrets in UI State:** Private keys and passwords are stored in React state, exposing them to potential XSS or DevTools inspection.
3.  **Missing Validation:** Several RPC handlers lack input validation, trusting the UI implicitly.

Addressing these issues is mandatory to meet the project's "zero-trust" and "defense-in-depth" requirements.

## Proposed Changes
1.  **Remove Persistent Password Storage:** Eliminate the `_sessionPassword` property from `KeyVaultService`. Operations requiring the password (like adding a new key) must re-request it from the user or use a secure, ephemeral mechanism.
2.  **Secure UI Input Handling:** Refactor sensitive input fields (passwords, private keys) to use uncontrolled components (`useRef`) and clear references immediately after use.
3.  **Background-Only Key Handling:** Ensure private keys are never returned to the UI state. Backup workflows will use a "copy to clipboard" RPC or a secure, ephemeral display mechanism that does not persist in React state.
4.  **Comprehensive RPC Validation:** Implement Zod schemas for all RPC payloads (`Activity`, `Approval`, etc.) and enforce validation at the handler entry point.

## Alternatives Considered
-   **Session Key Derivation:** Instead of re-prompting for the password, we could derive a temporary "session key" to encrypt new keys. However, this adds significant cryptographic complexity and state management. The proposed "re-prompt" or "ephemeral pass" approach is safer and simpler for now.
-   **Visual Key Backup:** Users often prefer seeing the key to write it down. The strict "copy only" recommendation might be too aggressive. We will explore a "reveal" RPC that returns the key for ephemeral display, but strictly forbids `useState`.

## Risks
-   **UX Friction:** Removing the session password means users may need to enter their password more frequently (e.g., when adding a second key).
-   **Complexity:** Refactoring UI to be uncontrolled requires careful state management to ensure validation feedback still works smoothly.
