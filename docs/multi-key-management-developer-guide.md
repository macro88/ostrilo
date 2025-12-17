# Multi-Key Management Developer Documentation

This document provides technical details about the multi-key selector components, RPC methods, and integration points for developers working on Ostrilo.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Components](#components)
3. [RPC Methods](#rpc-methods)
4. [Data Flow](#data-flow)
5. [Testing](#testing)
6. [Security Considerations](#security-considerations)

## Architecture Overview

The multi-key management system follows Ostrilo's hexagonal architecture pattern:

```
┌─────────────────────────────────────────────────────────────┐
│                        UI Layer                              │
│                                                              │
│  ┌──────────────┐    ┌─────────────────┐   ┌──────────────┐│
│  │   Header     │    │  KeySelector    │   │ AddKeyDialog ││
│  │  Component   │───▶│   Component     │───│   Modal      ││
│  └──────────────┘    │                 │   └──────────────┘│
│                      │  - Key List     │                    │
│                      │  - Avatar       │                    │
│                      │  - Profile Data │                    │
│                      └─────────────────┘                    │
│                             │                               │
│                             ▼                               │
│                   ┌──────────────────┐                      │
│                   │ KeyManagerContext│                      │
│                   │  - selectKey()   │                      │
│                   │  - generateKey() │                      │
│                   │  - importKey()   │                      │
│                   └──────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Application Layer                          │
│                                                              │
│  ┌──────────────────┐         ┌────────────────────┐        │
│  │ ProfileCacheService│◀────▶│ KeyVaultService    │        │
│  │  - getMetadata()  │         │  - selectKey()     │        │
│  └──────────────────┘         │  - generateKey()   │        │
│                               │  - importKey()     │        │
│                               │  - deleteKey()     │        │
│                               │  - renameKey()     │        │
│                               └────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

**Key Design Principles:**
- **No props on MainApp**: Components access state via context, not props
- **Memoization**: KeySelector is memoized to prevent unnecessary re-renders
- **Profile caching**: 5-minute TTL cache for profile metadata to reduce relay queries
- **Accessibility**: WCAG 2.1 AA compliant with full keyboard navigation

## Components

### KeySelector

**Location:** `src/ui/components/layout/KeySelector.tsx`

**Purpose:** Dropdown menu for switching between multiple Nostr keys with profile-aware display.

**Props:**
```typescript
interface KeySelectorProps {
  onAddKey?: () => void; // Optional callback for "Add Key" button
}
```

**State:**
```typescript
const [isOpen, setIsOpen] = useState(false);         // Dropdown open state
const [isSwitching, setIsSwitching] = useState(false); // Loading state during key switch
```

**Context Dependencies:**
- `useKeyManager()`: Access to keys, selectedUnlockedKey, selectKey
- `useProfileMetadata(pubkeys)`: Batch fetch profile metadata for all keys

**Key Methods:**

#### `handleSelectKey(keyId: string)`
Switches to the specified key via RPC.

```typescript
const handleSelectKey = async (keyId: string) => {
  if (keyId === selectedUnlockedKey?.id || isSwitching) return;

  try {
    setIsSwitching(true);
    await selectKey(keyId);
    setIsOpen(false);
  } catch (error) {
    console.error("Failed to switch key:", error);
    // TODO: Show toast notification
  } finally {
    setIsSwitching(false);
  }
};
```

**Error Handling:**
- Network errors during key switch show console error (toast planned)
- Prevents switching while another switch is in progress
- Prevents switching to already-selected key

#### `getKeyDisplay(key: UIKeyInfo)`
Extracts display information for a key with profile metadata fallbacks.

```typescript
const getKeyDisplay = (key: UIKeyInfo) => {
  const profile = profiles.get(key.publicKeyHex);
  const displayName = profile?.display_name || profile?.name || key.label || "Unnamed Key";
  const avatarUrl = profile?.picture;
  const truncatedNpub = key.publicKeyBech32
    ? `${key.publicKeyBech32.slice(0, 12)}...${key.publicKeyBech32.slice(-4)}`
    : "";

  return { displayName, avatarUrl, truncatedNpub };
};
```

**Profile Metadata Fallback Chain:**
1. `profile.display_name` (from NIP-01 kind:0 event)
2. `profile.name` (from NIP-01 kind:0 event)
3. `key.label` (user-defined local label)
4. `"Unnamed Key"` (final fallback)

**ARIA Attributes:**
```typescript
// Trigger
aria-label="Select active key"
aria-haspopup="listbox"
aria-expanded={isOpen}
aria-controls="key-selector-listbox"

// Listbox
role="listbox"
id="key-selector-listbox"
aria-label="Available keys"

// Option
role="option"
aria-selected={isSelected}
aria-label={`${displayName} - ${truncatedNpub}${isSelected ? " (currently selected)" : ""}`}
```

**Performance Optimization:**
- Component is wrapped with `React.memo()` to prevent re-renders
- Profile metadata fetched in batch, not per-key
- Lazy loading of avatars (graceful degradation)

### AddKeyDialog

**Location:** `src/ui/components/dialogs/AddKeyDialog.tsx`

**Purpose:** Modal dialog for creating or importing additional keys.

**Props:**
```typescript
interface AddKeyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (keyId: string) => void;
}
```

**State:**
```typescript
type FlowStep = "choose" | "create" | "import";
const [step, setStep] = useState<FlowStep>("choose");
```

**Flow Steps:**

#### 1. Choose Step
Shows two options:
- **Create New Key**: Generates a fresh keypair
- **Import Existing Key**: Imports from nsec1/hex

#### 2. Create Step
Uses `CreateKeyForm` component:
- Label input (optional)
- No password prompt (reuses session password)
- Calls `generateKey(password, label)` RPC
- Auto-selects new key on success

#### 3. Import Step
Uses `ImportKeyForm` component:
- Private key input (nsec1 or hex)
- Label input (optional)
- Validates key format
- Calls `importKey(privateKey, password, label)` RPC
- Auto-selects new key on success

**Key Methods:**

#### `handleClose()`
Resets dialog to initial state.

```typescript
const handleClose = () => {
  setStep("choose");
  onClose();
};
```

#### `handleSuccess()`
Called after successful key creation/import.

```typescript
const handleSuccess = () => {
  handleClose();
  if (onSuccess) {
    onSuccess(""); // keyId not needed, just refresh
  }
};
```

**ARIA Attributes:**
```typescript
// Dialog (provided by Radix Dialog)
role="dialog"
aria-labelledby="dialog-title"
aria-describedby="dialog-description"
```

## RPC Methods

Multi-key management uses the following RPC methods exposed by KeyVaultService:

### selectKey

**Signature:**
```typescript
async selectKey(keyId: string): Promise<void>
```

**Purpose:** Switches the active key to the specified key ID.

**Implementation:** `src/application/services/key-vault.service.ts`

**Workflow:**
1. Validate keyId exists in vault
2. Update selectedKeyId in vault state
3. Persist to storage
4. Broadcast state change via KeyManagerContext
5. All UI components observing context update automatically

**Error Cases:**
- `KEY_NOT_FOUND`: Specified keyId doesn't exist
- `VAULT_LOCKED`: Cannot switch keys when vault is locked

**Example:**
```typescript
await selectKey("key-id-12345");
```

### generateKey

**Signature:**
```typescript
async generateKey(password: string, label?: string): Promise<KeyRecord>
```

**Purpose:** Generates a new Nostr keypair and adds it to the vault.

**Workflow:**
1. Generate keypair using `@noble/curves`
2. Encrypt private key with AES-GCM using provided password
3. Derive public key representations (hex, bech32)
4. Create KeyRecord with metadata
5. Add to vault and persist
6. Auto-select new key
7. Return KeyRecord to caller

**Parameters:**
- `password`: Used for AES-GCM encryption (session password when vault is unlocked)
- `label`: Optional user-friendly identifier

**Returns:**
```typescript
interface KeyRecord {
  id: string;              // UUID
  label?: string;          // Optional user label
  publicKeyHex: string;    // 64-char hex
  publicKeyBech32: string; // npub1...
  createdAt: number;       // Unix timestamp
  isSelected: boolean;     // true for newly created key
}
```

**Example:**
```typescript
const newKey = await generateKey("session-password", "Work Account");
console.log("Created:", newKey.publicKeyBech32);
```

### importKey

**Signature:**
```typescript
async importKey(privateKey: string, password: string, label?: string): Promise<KeyRecord>
```

**Purpose:** Imports an existing Nostr private key into the vault.

**Workflow:**
1. Parse privateKey (nsec1 or hex format)
2. Validate key format and length
3. Derive public key from private key
4. Encrypt private key with AES-GCM
5. Create KeyRecord
6. Add to vault and persist
7. Auto-select imported key
8. Return KeyRecord

**Parameters:**
- `privateKey`: nsec1... or 64-char hex string
- `password`: Used for encryption
- `label`: Optional identifier

**Error Cases:**
- `INVALID_KEY_FORMAT`: Not a valid nsec1 or hex key
- `DUPLICATE_KEY`: Key already exists in vault

**Example:**
```typescript
const imported = await importKey(
  "nsec1abc123...",
  "session-password",
  "Imported Key"
);
```

### renameKey

**Signature:**
```typescript
async renameKey(id: string, label: string): Promise<void>
```

**Purpose:** Updates the label for an existing key.

**Workflow:**
1. Validate keyId exists
2. Validate label (non-empty, max 64 chars)
3. Update label in vault
4. Persist to storage
5. Broadcast update

**Validation:**
- Label must be 1-64 characters
- Any Unicode characters allowed

**Example:**
```typescript
await renameKey("key-id-12345", "Personal Account");
```

### deleteKey

**Signature:**
```typescript
async deleteKey(id: string): Promise<{ newSelectedKeyId?: string }>
```

**Purpose:** Permanently removes a key from the vault.

**Workflow:**
1. Validate keyId exists
2. Check if last remaining key → throw error
3. If deleting active key → auto-select another key
4. Remove key from vault
5. Zeroize private key material in memory
6. Persist to storage
7. Return new selected key ID if auto-switched

**Security:**
- Private key memory is overwritten with zeros before GC
- Operation cannot be undone
- Activity logged for audit trail

**Error Cases:**
- `LAST_KEY`: Cannot delete the last remaining key
- `KEY_NOT_FOUND`: Specified key doesn't exist

**Returns:**
```typescript
{
  newSelectedKeyId?: string; // ID of auto-selected key if active key was deleted
}
```

**Example:**
```typescript
const result = await deleteKey("key-id-12345");
if (result.newSelectedKeyId) {
  console.log("Auto-switched to:", result.newSelectedKeyId);
}
```

## Data Flow

### Key Selection Flow

```
User clicks key in selector
    │
    ▼
KeySelector.handleSelect(keyId)
    │
    ▼
KeyManagerContext.selectKey(keyId)
    │
    ▼
RPC: vault-rpc.selectKey(keyId)
    │
    ▼
KeyVaultService.selectKey(keyId)
    │
    ▼
Storage: Update selectedKeyId in state
    │
    ▼
KeyManagerContext re-renders with new selectedKeyId
    │
    ▼
All UI components using useKeyManager see updated selectedUnlockedKey
```

### Add Key Flow

```
User clicks "Add Key" in selector
    │
    ▼
KeySelector opens AddKeyDialog
    │
    ▼
User chooses "Create" or "Import"
    │
    ├─▶ Create: CreateKeyForm
    │       │
    │       ▼
    │   generateKey(password, label)
    │       │
    └─▶ Import: ImportKeyForm
            │
            ▼
        importKey(privateKey, password, label)
            │
            ▼
    Both return newKeyId
            │
            ▼
    AddKeyDialog.onSuccess(newKeyId)
            │
            ▼
    KeySelector.selectKey(newKeyId)
            │
            ▼
    Close dialog, new key is now active
```

### Profile Integration Flow

```
KeySelector mounts
    │
    ▼
Get all keys from KeyManagerContext
    │
    ▼
For each key:
    Extract publicKeyHex
    │
    ▼
    ProfileCacheService.getMetadata(publicKeyHex)
    │
    ├─▶ Cache hit: Return cached metadata immediately
    │
    └─▶ Cache miss: Fetch from relays, cache, return
            │
            ▼
    Store in local state: profiles.set(keyId, metadata)
    │
    ▼
Render each key with:
    - Avatar (metadata.picture or fallback)
    - Display name (metadata.display_name || metadata.name || label)
    - Secondary text (npub truncated)
```

## Testing

### Unit Tests

**Location:** `tests/unit/ui/components/`

**Coverage:**
- KeySelector logic (display formatting, selection logic, profile integration)
- AddKeyDialog flow transitions
- Error handling

**Run:**
```bash
npm run test:unit tests/unit/ui/components/KeySelector.test.ts
npm run test:unit tests/unit/ui/components/AddKeyDialog.test.ts
```

### Integration Tests

**Location:** `tests/integration/multi-key-management.test.ts`

**Coverage:**
- Key switching across services
- Add key flow (create and import)
- Rename key persistence
- Delete key flow
- Last key protection

**Run:**
```bash
npm run test:integration tests/integration/multi-key-management.test.ts
```

### E2E Tests

**Location:** `tests/e2e/multi-key-selector.spec.ts`

**Coverage:**
- User can switch between keys via UI
- User can add keys via selector
- Settings key management
- Keyboard navigation

**Run:**
```bash
npm run test:e2e tests/e2e/multi-key-selector.spec.ts
```

**Note:** E2E tests require built extension and non-headless browser.

### Accessibility Tests

**Location:** `tests/unit/ui/accessibility/multi-key-selector.a11y.test.ts`

**Coverage:**
- ARIA attributes validation
- Keyboard navigation support
- Focus management
- Semantic HTML structure
- Color contrast compliance

**Run:**
```bash
npm run test:unit tests/unit/ui/accessibility/
```

## Security Considerations

### Key Encryption

All private keys are encrypted at rest using AES-GCM:

```typescript
interface EncryptedKey {
  ciphertext: Uint8Array; // Encrypted private key
  salt: Uint8Array;       // Random salt for key derivation
  iv: Uint8Array;         // Initialization vector for AES-GCM
}
```

**Key derivation:** PBKDF2-SHA256 with 100,000 iterations  
**Encryption:** AES-256-GCM with authenticated encryption  
**Storage:** Encrypted keys stored in browser's IndexedDB

### Memory Zeroization

When a key is deleted, its private key material is overwritten:

```typescript
// Before GC
for (let i = 0; i < privateKeyArray.length; i++) {
  privateKeyArray[i] = 0;
}
```

This prevents private keys from lingering in memory after deletion.

### RPC Security

All RPC methods validate:
- Vault lock state (reject if locked)
- Key ownership (only operate on user's keys)
- Parameter validation (key format, label length)
- Origin isolation (no cross-origin key access)

### Audit Logging

All key operations are logged to ActivityLogService:
- Key creation/import
- Key selection
- Key deletion
- Failed operations

**Log retention:** 50-500 entries (ring buffer)  
**Privacy:** Logs contain timestamps, operation type, and outcome (not private keys)

## Integration Points

### KeyManagerContext

**Location:** `src/ui/state/KeyManagerContext.tsx`

**Purpose:** Provides reactive state for all key operations.

**Provider Setup:**
```tsx
<KeyManagerProvider>
  <MainApp />
</KeyManagerProvider>
```

**Consumer Hook:**
```typescript
const {
  keys,                  // All available keys
  selectedUnlockedKey,   // Currently active key
  selectKey,             // Switch active key
  generateKey,           // Create new key
  importKey,             // Import existing key
  isLocked,              // Vault lock state
  hasKeys,               // Has at least one key
} = useKeyManager();
```

### ProfileCacheService

**Location:** `src/application/services/profile.service.ts`

**Integration:**
```typescript
const { profiles, isLoading } = useProfileMetadata(pubkeys);

// profiles: Map<string, ProfileMetadata>
// isLoading: boolean
```

**Cache TTL:** 5 minutes  
**Batch fetching:** All pubkeys fetched in parallel  
**Offline support:** Returns cached data when offline

### Header Component

**Location:** `src/ui/components/layout/Header.tsx`

**Integration:**
```tsx
<KeySelector onAddKey={() => setShowAddDialog(true)} />
<AddKeyDialog
  isOpen={showAddDialog}
  onClose={() => setShowAddDialog(false)}
  onSuccess={(keyId) => {
    // Optional: Navigate to new key or show success message
  }}
/>
```

## Common Patterns

### Adding a New Key Management Feature

1. **Define RPC method** in `KeyVaultService`
2. **Expose via context** in `KeyManagerContext`
3. **Create UI component** in `src/ui/components/`
4. **Write tests**:
   - Unit tests for logic
   - Integration tests for service interactions
   - E2E tests for user flows
5. **Add accessibility**: ARIA attributes, keyboard nav
6. **Document**: JSDoc comments, user guide, developer docs

### Troubleshooting

**Issue:** Keys not appearing in selector  
**Solution:** Check vault unlock state, verify keys exist in storage

**Issue:** Profile avatars not loading  
**Solution:** Check relay connectivity, verify profile metadata exists

**Issue:** Key switch fails  
**Solution:** Check console for RPC errors, verify keyId is valid

**Issue:** Tests failing  
**Solution:** Ensure extension is built (`npm run build`), check mock setup

## Future Enhancements

Potential improvements tracked in openspec:

- **Key export functionality**: Export encrypted backup files
- **Key grouping/tagging**: Organize keys with custom tags
- **Key reordering**: Drag-and-drop to reorder keys in selector
- **Key health indicators**: Show last used date, relay connectivity
- **Multi-device sync**: NIP-46 remote signer integration
- **Keyboard shortcuts**: Global hotkey for quick key switching

See `openspec/changes/add-multi-key-selector/design.md` for detailed future plans.
