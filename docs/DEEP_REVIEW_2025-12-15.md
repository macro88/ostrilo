# Ostrilo - Deep Code Review (2025-12-15)

## 1. Overall Assessment

This deep-dive analysis confirms that Ostrilo is built on a strong architectural foundation (Hexagonal Architecture) with a clear intent for high security. However, the investigation has revealed several critical and high-severity vulnerabilities where the implementation does not consistently enforce the core "background-first" security principle.

Sensitive data (passwords, private keys) is present in the UI layer, and multiple RPC endpoints lack necessary input validation. These issues represent a significant risk to the extension's security posture. While much of the cryptographic and storage logic is sound, these implementation gaps undermine the architecture's security goals.

This report provides specific, actionable recommendations to remediate these vulnerabilities and align the codebase with its documented security standards.

## 2. Security Review

### 2.1. Critical: Raw Password Stored in Memory

-   **Observation:** The `KeyVaultService` stores the user's master password in a private class property (`_sessionPassword`) for the entire duration of an unlocked session.
-   **Risk:** This is a critical vulnerability. A sophisticated attacker with memory-dumping capabilities, or a separate vulnerability that allows memory inspection, could recover the user's raw password. This completely compromises all keys in the vault. The principle of zeroization is defeated if the password persists in memory.
-   **Recommendation:** The password must only be held in memory for the absolute minimum time required to derive the encryption key. It should be zeroized immediately after. The `_sessionPassword` property should be removed entirely. Operations during an unlocked session that require the password (if any) should use a derived session key or re-prompt the user.

#### Before (Vulnerable)

**File:** `src/application/services/key-vault.service.ts`
```typescript
export class KeyVaultService {
  private _sessionPassword?: Uint8Array; // Password stored in memory

  // ...

  async unlock(password: string): Promise<{ selectedKeyId?: string }> {
    // ... (derivation logic)
    
    this._sessionPassword = new TextEncoder().encode(password); // Stored on unlock

    // ...
  }

  async lock(): Promise<void> {
    // ...
    if (this._sessionPassword) {
      zeroize(this._sessionPassword); // Cleared only on lock
      this._sessionPassword = undefined;
    }
  }
}
```

#### After (Proposed)

**File:** `src/application/services/key-vault.service.ts`
```typescript
import { zeroize } from '@/domain/utils/crypto';

export class KeyVaultService {
  // private _sessionPassword?: Uint8Array; // REMOVED

  // ...

  async unlock(password: string): Promise<{ selectedKeyId?: string }> {
    const passBuff = new TextEncoder().encode(password);
    try {
      // Use passBuff to derive key and decrypt secrets
      // ...
      for (const rec of records) {
        // ...
        const rawKey = await this.kdf.deriveKey(passBuff, salt); 
        // ...
        // It is important to zeroize the rawKey after use inside the loop.
        zeroize(rawKey);
      }
    } finally {
      zeroize(passBuff); // Ensure password buffer is always zeroized
    }
    // Do not store the password or a derived version that can be reversed.
    // The unlocked private keys are stored in `this.unlocked`, which is acceptable as long as they are zeroized on lock.
  }

  async lock(): Promise<void> {
    // ...
    // No longer need to manage _sessionPassword here.
    // The existing logic to zeroize `this.unlocked` keys is correct.
  }
}
```

### 2.2. High: Private Key Stored in UI State

-   **Observation:** The `OnboardingCreateKey` component stores a newly generated private key (`nsec` format) in its React state to display it to the user for backup.
-   **Risk:** This is a high-severity vulnerability. Storing any private key material in React state makes it accessible via React DevTools and potentially vulnerable to DOM-based XSS attacks that could inspect component state. This directly violates the background-first security model.
-   **Recommendation:** Sensitive data generated in the background should never be sent back to the UI to be held in state. For a "copy to clipboard" feature, the RPC call should perform the copy action in the background and return only a success status to the UI. The backup step should confirm the user understands they need to copy the key, without displaying the key again.

#### Before (Vulnerable)

**File:** `src/ui/features/onboarding/components/OnboardingCreateKey.tsx`
```typescript
// ... inside OnboardingCreateKey component
const [privateKey, setPrivateKey] = useState<string | null>(null);

// ...
const handleGenerate = async () => {
    // ...
    const newKey = await generateKey(password, label); // RPC returns key
    setPrivateKey(newKey.nsec); // Private key stored in state!
    setStep('backup');
};

// ...
<p>{privateKey}</p> // Displayed from state
```

#### After (Proposed)

**File:** `src/ui/features/onboarding/components/OnboardingCreateKey.tsx`
```typescript
// ... inside OnboardingCreateKey component
// const [privateKey, setPrivateKey] = useState<string | null>(null); // REMOVED

const handleGenerate = async () => {
    // ...
    // The RPC call should NOT return the private key.
    // It should encrypt and store it, then return only the public key or ID.
    const { id, pubkey } = await generateKey(password, label); 
    // The backup step can offer a "copy private key" button which makes a *new*
    // RPC call to the background to copy the nsec to the clipboard for that session.
    setStep('backup');
};

// In the backup step UI:
const handleCopy = async () => {
    // New RPC call that copies the key to clipboard in the background.
    // This may require temporarily decrypting/deriving the key again.
    await copyPrivateKeyToClipboard(password); 
    // Show feedback to user: "Copied to clipboard!"
}
```
*(This requires adding a `copyPrivateKeyToClipboard` RPC method that re-derives the key or temporarily decrypts it, copies it, and immediately zeroizes.)*

### 2.3. Medium: Passwords Stored in UI State

-   **Observation:** Multiple UI components, including `LockScreen`, `OnboardingCreateKey`, and `OnboardingImportKey`, store the user's password in React state while the form is being filled.
-   **Risk:** While less critical than a private key, storing the password in the UI layer is a bad practice that violates the project's security architecture. It increases the attack surface.
-   **Recommendation:** All sensitive input fields should be uncontrolled components. Use a `useRef` to get the value directly from the DOM element upon submission and send it immediately to the background script via an RPC call. The value should never be stored in React state.

#### Before (Vulnerable)

**File:** `src/ui/features/authentication/components/LockScreen.tsx`
```typescript
const [password, setPassword] = useState('');

// ...
<Input
  type="password"
  value={password} // Password held in state
  onChange={(e) => setPassword(e.target.value)}
/>
```

#### After (Proposed)

**File:** `src/ui/features/authentication/components/LockScreen.tsx`
```typescript
const passwordRef = React.useRef<HTMLInputElement>(null);

const handleUnlock = async () => {
    const password = passwordRef.current?.value;
    if (password) {
        await unlock(password);
        // It's also good practice to clear the ref value after use.
        if (passwordRef.current) {
            passwordRef.current.value = ''; 
        }
    }
}

// ...
<Input
  type="password"
  ref={passwordRef} // Use a ref, making it an uncontrolled component
/>
```

### 2.4. Medium: Incomplete RPC Input Validation

-   **Observation:** The `ActivityRpcHandler` and `ApprovalRpcHandler` do not validate inputs. Parameters like `origin`, `kind`, `limit`, `offset`, `requestId`, and `action` are passed directly to application services.
-   **Risk:** This is an architectural flaw. The infrastructure layer (RPC handlers) is responsible for protecting the application layer from malformed or malicious input. Unsanitized input could lead to unexpected behavior, errors, or security issues if the service layer doesn't perform its own redundant checks.
-   **Recommendation:** Every RPC handler must validate the shape and content of its message payload at the beginning of the `handleRequest` method using the existing Zod schemas (`src/infrastructure/validation/schemas.ts`). If schemas don't exist for these payloads, they must be created.

#### Before (Insecure)

**File:** `src/infrastructure/messaging/handlers/activity-rpc.ts`
```typescript
private async handleFilterBy(
  message: Extract<RpcRequest, { type: "activity.filterBy" }>,
  context: ServiceContext
): Promise<RpcResponse> {
  // No validation of message.origin, message.kind, etc.
  const { entries, total } = await context.activityLog.filterBy({
    origin: message.origin,
    kind: message.kind,
    limit: message.limit,
    offset: message.offset,
  });
  return { ok: true, data: { entries, total } };
}
```

#### After (Proposed)

**File:** `src/infrastructure/messaging/handlers/activity-rpc.ts`
```typescript
import { ActivityFilterSchema } from "@/infrastructure/validation/schemas"; // Assuming this schema exists or is created

private async handleFilterBy(
  message: Extract<RpcRequest, { type: "activity.filterBy" }>,
  context: ServiceContext
): Promise<RpcResponse> {
  // Validate the payload
  const validation = ActivityFilterSchema.safeParse(message);
  if (!validation.success) {
    return { 
      ok: false, 
      error: "invalid_request", 
      details: validation.error.issues[0]?.message 
    };
  }

  // Use validated data
  const { entries, total } = await context.activityLog.filterBy(validation.data);
  return { ok: true, data: { entries, total } };
}
```