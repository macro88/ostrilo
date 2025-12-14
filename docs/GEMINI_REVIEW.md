# Ostrilo - Senior Engineer Code Review (Deep Dive with Code Examples)

## 1. Overall Assessment

This deep-dive review confirms that Ostrilo is built on a solid architectural foundation (Hexagonal Architecture) and demonstrates a clear commitment to security and code quality. The separation of concerns is well-executed, and the project structure is logical and maintainable. The requirements laid out in `ostrilo-signer-requirements.md` are comprehensive and provide an excellent roadmap.

However, a detailed analysis reveals several areas where the implementation can be significantly improved to better meet these requirements, enhance security, and reduce technical debt. This review provides specific, actionable recommendations with code examples to address these findings.

## 2. Security Review

Security is the most critical aspect of this application. While many security principles are correctly applied, there are significant gaps between the requirements and the current implementation.

### 2.1. Critical: Lack of Memory Zeroization (NS-N-003)

-   **Observation:** The requirement for zeroization is explicitly stated, but the implementation is incomplete. The `unlock` method in `KeyVaultService` does not zero out the derived key (`rawKey`) or the decrypted private key (`pt`) after they are used.
-   **Risk:** A sophisticated attacker with memory-dumping capabilities could potentially recover private key material or the derived password key.
-   **Recommendation:** The `rawKey` and `pt` variables should be zeroed out immediately after use within the loop.

#### Before

**File:** `src/application/services/key-vault.service.ts`

```typescript
// ... inside KeyVaultService.unlock
for (const rec of records) {
  const salt = new Uint8Array(rec.salt);
  const iv = new Uint8Array(rec.iv);
  const ct = new Uint8Array(rec.ct);
  const rawKey = await this.kdf.deriveKey(password, salt);
  const key = await this.aead.importKey(rawKey, ["decrypt"]);
  const pt = await this.aead.decrypt(key, iv, ct);
  this.unlocked.set(rec.id, pt);
  // rawKey is not zeroed out here, leaving it for the garbage collector.
}
```

#### After

**File:** `src/application/services/key-vault.service.ts`

```typescript
// ... inside KeyVaultService.unlock
for (const rec of records) {
  const salt = new Uint8Array(rec.salt);
  const iv = new Uint8Array(rec.iv);
  const ct = new Uint8Array(rec.ct);
  const rawKey = await this.kdf.deriveKey(password, salt);
  try {
    const key = await this.aead.importKey(rawKey, ["decrypt"]);
    const pt = await this.aead.decrypt(key, iv, ct);
    this.unlocked.set(rec.id, pt);
    pt.fill(0); // Zero out the plaintext key after it's stored
  } finally {
    rawKey.fill(0); // Always zero out the derived key
  }
}
```

### 2.2. High: Passwords and Private Keys in UI State

-   **Observation:** The `OnboardingImportKey` component holds the raw private key string in its state (`privateKeyInput`).
-   **Risk:** Storing the raw private key in the UI state is a significant risk, as it could be exposed via React DevTools or a DOM-based attack.
-   **Recommendation:** The private key should never be held in the React state. It should be sent to the background script for validation immediately and not stored.

#### Before

**File:** `src/ui/features/onboarding/components/OnboardingImportKey.tsx`

```typescript
// ... inside OnboardingImportKey component
const [privateKeyInput, setPrivateKeyInput] = useState("");

// ...

<Input
  id="privateKey"
  type={showPrivateKey ? "text" : "password"}
  placeholder="nsec1..."
  value={privateKeyInput} // The private key is held in the component's state
  onChange={(e) => setPrivateKeyInput(e.target.value)}
  // ...
/>
```

#### After

**File:** `src/ui/features/onboarding/components/OnboardingImportKey.tsx`

This requires a more significant refactor. The component should use a `useRef` to hold the input value and send it to the background for validation without ever storing it in the state.

```typescript
// ... inside OnboardingImportKey component
const privateKeyRef = React.useRef<HTMLInputElement>(null);

const validateImport = async () => {
  const keyInput = privateKeyRef.current?.value.trim();
  if (!keyInput) {
    setImportError("Private key is required");
    return false;
  }
  // ... rest of validation
  try {
    // RPC call to background to validate the key
    const isValid = await rpcValidatePrivateKey(keyInput);
    if (!isValid) {
      setImportError("Invalid private key format");
      return false;
    }
    // Do not store the key in state
    return true;
  } catch (error) {
    // ...
  }
};

// ...

<Input
  id="privateKey"
  ref={privateKeyRef} // Use a ref instead of state
  type={showPrivateKey ? "text" : "password"}
  placeholder="nsec1..."
  // ...
/>
```

### 2.3. Medium: Inconsistent Type Safety in RPC Layer

-   **Observation:** The RPC layer makes extensive use of `any` and `Record<string, unknown>`, particularly for `patch` objects.
-   **Risk:** This bypasses TypeScript's type safety, making it possible to introduce bugs and security vulnerabilities.
-   **Recommendation:** Define strict types for all RPC message payloads and use a validation library like `zod` in the background script.

#### Before

**File:** `src/infrastructure/messaging/rpc.ts`

```typescript
export type RpcRequest =
  // ...
  | { type: "settings.update"; patch: Record<string, unknown> }
  | { type: "policy.setOrigin"; origin: string; patch: Record<string, unknown> };
```

#### After

**File:** `src/infrastructure/messaging/rpc.ts`

```typescript
import { z } from 'zod';

// Define schemas for your patch objects
export const AppSettingsPatchSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  autoLockMinutes: z.number().optional(),
  // ... other fields
});

export type AppSettingsPatch = z.infer<typeof AppSettingsPatchSchema>;

export type RpcRequest =
  // ...
  | { type: "settings.update"; patch: AppSettingsPatch }
  // ...
```

**File:** `src/extension/background.ts`

```typescript
// ... inside onMessage listener
case "settings.update": {
  const validationResult = AppSettingsPatchSchema.safeParse(message.patch);
  if (!validationResult.success) {
    result = { ok: false, error: "invalid_patch" };
    break;
  }
  const data = await settings.update(validationResult.data);
  result = { ok: true, data } as const;
  break;
}
```

## 3. Architectural and Structural Review

### 3.1. Code Smell: Monolithic `background.ts` RPC Handler

-   **Observation:** The `onMessage` listener in `background.ts` is a large `switch` statement.
-   **Recommendation:** Refactor into a more modular design with a routing mechanism.

#### Before

**File:** `src/extension/background.ts`

```typescript
// ...
browser.runtime.onMessage.addListener(
  (message: RpcRequest, sender, sendResponse) => {
    // ... giant switch statement here
  }
);
```

#### After

**File:** `src/infrastructure/messaging/rpc-router.ts` (New file)

```typescript
// Create a router
const rpcRouter = {
  "vault.": vaultRpcHandler, // another new file
  "policy.": policyRpcHandler, // another new file
  "settings.": settingsRpcHandler, // another new file
};

export function handleRpcRequest(message: RpcRequest, sender, sendResponse) {
  for (const prefix in rpcRouter) {
    if (message.type.startsWith(prefix)) {
      rpcRouter[prefix](message, sender, sendResponse);
      return;
    }
  }
  // Handle unknown methods
}
```

**File:** `src/extension/background.ts`

```typescript
import { handleRpcRequest } from '@/infrastructure/messaging/rpc-router';

// ...
browser.runtime.onMessage.addListener(handleRpcRequest);
```

### 3.2. Architectural Leak: Domain Logic in UI Components

-   **Observation:** The `PasswordInput` component calls `evaluatePasswordStrength` via RPC.
-   **Recommendation:** Import and use the pure `evaluatePasswordStrength` function directly in the UI.

#### Before

**File:** `src/ui/components/ui/password-input.tsx`

```typescript
import { evaluatePasswordStrength } from "@/infrastructure/messaging/client";

// ...
useEffect(() => {
  // ...
  evaluatePasswordStrength(value).then(setStrength);
}, [showStrengthMeter, value]);
```

#### After

**File:** `src/ui/components/ui/password-input.tsx`

```typescript
import { evaluatePasswordStrength } from "@/domain/utils/crypto";

// ...
useEffect(() => {
  // ...
  const strength = evaluatePasswordStrength(value);
  setStrength(strength);
}, [showStrengthMeter, value]);
```

## 4. Maintainability and Code Quality

### 4.1. Code Smell: Duplicated Logic in `KeyVaultService`

-   **Observation:** `generateKey` and `importKey` in `KeyVaultService` contain nearly identical logic for selecting a new key.
-   **Recommendation:** Refactor this into a private helper method.

#### Before

**File:** `src/application/services/key-vault.service.ts`

```typescript
// In generateKey:
const records = await this.listKeys();
const hasSelected = (await this.getSettings())?.selectedKeyId ?? records.find((r) => r.isSelected)?.id;
if (!hasSelected && records.length === 0) {
  record.isSelected = true;
  // ... update settings
}

// In importKey:
const records = await this.listKeys();
const hasSelected = (await this.getSettings())?.selectedKeyId ?? records.find((r) => r.isSelected)?.id;
if (!hasSelected && records.length === 0) {
  record.isSelected = true;
  // ... update settings
}
```

#### After

**File:** `src/application/services/key-vault.service.ts`

```typescript
private async _selectKeyIfFirst(record: KeyRecord, records: KeyRecord[]): Promise<void> {
  const hasSelected = (await this.getSettings())?.selectedKeyId ?? records.find((r) => r.isSelected)?.id;
  if (!hasSelected && records.length === 0) {
    record.isSelected = true;
    const settings = (await this.getSettings()) ?? defaultSettings();
    await this.storage.sync.set<AppSettingsV1>(SETTINGS_KEY, {
      ...defaultSettings(),
      ...settings,
      __version: "settings.v1",
      selectedKeyId: record.id,
    } as AppSettingsV1);
  }
}

// In generateKey and importKey:
await this._selectKeyIfFirst(record, records);
```

This review provides a more concrete and actionable set of recommendations to guide the continued development of Ostrilo.