# Design: Harden Security Posture

## Architecture

### 1. Zero-Retention Password Handling
The current `KeyVaultService` retains `_sessionPassword` to facilitate key generation without re-prompting. This violates the principle of minimizing sensitive data lifetime.

**New Flow:**
-   `unlock(password)`:
    -   Derives the master key.
    -   Decrypts all keys into `this.unlocked` (Map<ID, PrivateKey>).
    -   **Zeroizes** the password and derived master key immediately.
    -   Does **not** store the password.
-   `generateKey(password, label)` / `importKey(key, password, label)`:
    -   Requires the password to be passed explicitly.
    -   Derives the master key, encrypts the new key, stores it.
    -   **Zeroizes** the password and derived master key immediately.

**UX Impact:**
The `AddKeyDialog` currently assumes it can call `generateKey` without a password if the vault is unlocked. This will fail.
-   **Mitigation:** The `AddKeyDialog` must be updated to include a password field, *even if the vault is unlocked*. This is a necessary trade-off for security.

### 2. Ephemeral UI State for Secrets
React's `useState` persists data across renders and potentially in React DevTools.

**Pattern:**
```tsx
// BAD
const [password, setPassword] = useState("");
<input value={password} onChange={e => setPassword(e.target.value)} />

// GOOD
const passwordRef = useRef<HTMLInputElement>(null);
<input ref={passwordRef} />
// On submit: read passwordRef.current.value, call RPC, then passwordRef.current.value = ""
```

This pattern will be applied to:
-   `LockScreen` (password)
-   `OnboardingCreateKey` (password)
-   `OnboardingImportKey` (private key, password)
-   `AddKeyDialog` (password, private key)

### 3. Private Key Backup Flow
The requirement "RPC call should NOT return the private key" conflicts with the user need to write down the key (paper backup).

**Compromise Design:**
-   `generateKey` RPC returns `{ id, pubkey }`. It does *not* return `nsec`.
-   New RPC: `revealKey(id, password)` returns `{ nsec }`.
-   **UI Behavior:**
    -   The "Backup" step calls `revealKey`.
    -   It displays the key in a `<code>` block or input.
    -   It does **not** store it in `useState`.
    -   It provides a "Copy" button that uses `navigator.clipboard.writeText`.
    -   When the user leaves the step, the data is gone.

### 4. RPC Validation Layer
All RPC handlers must follow this pattern:

```typescript
handle(message: Message) {
  const result = Schema.safeParse(message);
  if (!result.success) return { error: "invalid_params" };
  // ... proceed
}
```

We need to define Zod schemas for:
-   `ActivityFilterSchema` (origin, kind, limit, offset)
-   `ApprovalActionSchema` (requestId, action, decision)
