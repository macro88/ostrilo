# Design Document: Multi-Key Selector

**Change ID:** `add-multi-key-selector`  
**Date:** 2025-01-23

## Architecture Overview

This change introduces UI components for multi-key management without modifying the underlying vault or RPC infrastructure. All state management flows through the existing KeyManagerContext.

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
│                               └────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Component Design

### KeySelector Component

**Location:** `src/ui/components/layout/KeySelector.tsx`

**Purpose:** Dropdown/popover that displays all available keys and allows switching between them.

**Props:**
```typescript
interface KeySelectorProps {
  // No props needed - reads from KeyManagerContext
}
```

**State:**
```typescript
interface KeySelectorState {
  isOpen: boolean;              // Dropdown open state
  profiles: Map<string, ProfileMetadata>; // Cached profiles
  isLoadingProfiles: boolean;   // Loading state for profile fetches
}
```

**Key Features:**
- Uses Radix UI DropdownMenu for accessible dropdown behavior
- Fetches profile metadata for all keys on mount (cached)
- Shows currently selected key with checkmark icon
- Click key item → calls `selectKey(keyId)` → closes dropdown
- "Add Key" button at bottom opens AddKeyDialog

**Wire frame:**
```
┌────────────────────────────────────┐
│ [Avatar] Alice (@alice)       [▼] │ ← Trigger (closed state)
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ [Avatar] Alice (@alice)       [▲] │ ← Trigger (open state)
├────────────────────────────────────┤
│ ┌────────────────────────────────┐ │
│ │ [✓] [Avatar] Alice            │ │ ← Selected key
│ │     alice@example.com         │ │
│ │     npub1abc...def            │ │
│ ├────────────────────────────────┤ │
│ │ [ ] [Avatar] Bob              │ │ ← Other key
│ │     Work Account              │ │
│ │     npub1xyz...123            │ │
│ ├────────────────────────────────┤ │
│ │ [ ] [Icon] Key 3              │ │ ← No profile
│ │     Personal Backup           │ │
│ │     npub1def...456            │ │
│ ├────────────────────────────────┤ │
│ │ [+] Add Key                   │ │ ← Add action
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

**Accessibility:**
- `role="listbox"` on dropdown container
- `role="option"` on each key item
- `aria-selected="true"` on active key
- Keyboard: Arrow Up/Down to navigate, Enter to select, Escape to close
- Focus trap within dropdown when open

### AddKeyDialog Component

**Location:** `src/ui/components/dialogs/AddKeyDialog.tsx`

**Purpose:** Modal dialog for creating or importing a new key.

**Props:**
```typescript
interface AddKeyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (keyId: string) => void; // Called after successful add
}
```

**State:**
```typescript
interface AddKeyDialogState {
  step: 'choose' | 'create' | 'import'; // Current flow step
  error: string | null;                 // Error message
  isSubmitting: boolean;                // Loading state
}
```

**Flow:**
```
1. Choose Step
   ┌──────────────────┐
   │ Add New Key      │
   ├──────────────────┤
   │ [🔑] Create Key  │ ← Click to step='create'
   │ [📥] Import Key  │ ← Click to step='import'
   │ [Cancel]         │
   └──────────────────┘

2a. Create Step (reuses OnboardingCreateKey)
    ┌────────────────────┐
    │ Create New Key     │
    ├────────────────────┤
    │ Password: [____]   │
    │ Label: [____]      │
    │ [Generate] [Back]  │
    └────────────────────┘

2b. Import Step (reuses OnboardingImportKey)
    ┌──────────────────────┐
    │ Import Existing Key  │
    ├──────────────────────┤
    │ Private Key: [____]  │
    │ Password: [____]     │
    │ Label: [____]        │
    │ [Import] [Back]      │
    └──────────────────────┘
```

**Success Flow:**
1. User completes create/import
2. Call `onSuccess(newKeyId)`
3. Parent component (KeySelector) calls `selectKey(newKeyId)`
4. Dialog closes automatically

### Settings Keys Section

**Location:** Updated `src/ui/features/settings/components/SettingsView.tsx`

**New Section:** "Keys & Identities"

**Wire frame:**
```
┌───────────────────────────────────────────────────┐
│ [🔑] Keys & Identities                            │
├───────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────┐ │
│ │ [Avatar] Alice (@alice)         [Active]      │ │
│ │          alice@example.com                    │ │
│ │          npub1abc...def                       │ │
│ │          [Rename] [Delete]                    │ │
│ ├───────────────────────────────────────────────┤ │
│ │ [Avatar] Bob                                  │ │
│ │          Work Account                         │ │
│ │          npub1xyz...123                       │ │
│ │          [Set Active] [Rename] [Delete]       │ │
│ ├───────────────────────────────────────────────┤ │
│ │ [Icon]   Key 3                                │ │
│ │          Personal Backup                      │ │
│ │          npub1def...456                       │ │
│ │          [Set Active] [Rename] [Delete]       │ │
│ └───────────────────────────────────────────────┘ │
│                                                   │
│ [+ Add Key]                                       │
└───────────────────────────────────────────────────┘
```

**Operations:**
- **Set Active**: Calls `selectKey(keyId)`, updates UI
- **Rename**: Shows inline text input, calls `renameKey(keyId, newLabel)` (new RPC method)
- **Delete**: Shows confirmation dialog, calls `deleteKey(keyId)` (check if exists in RPC)

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
    ├─▶ Create: OnboardingCreateKey component
    │       │
    │       ▼
    │   generateKey(password, label)
    │       │
    └─▶ Import: OnboardingImportKey component
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

## RPC Methods

### Existing (No Changes)
- `selectKey(keyId: string): Promise<void>` - Switch active key
- `generateKey(password: string, label?: string): Promise<KeyRecord>` - Create new key
- `importKey(privateKey: string, password: string, label?: string): Promise<KeyRecord>` - Import key

### New Methods Required

#### renameKey
```typescript
async function renameKey(keyId: string, newLabel: string): Promise<void>
```
**Implementation:**
- Validate `newLabel` (non-empty, max 64 chars)
- Call `KeyVaultService.renameKey(keyId, newLabel)`
- Update label in encrypted vault
- Broadcast updated state via KeyManagerContext

**Alternative:** Could be handled client-side by updating KeyRecord metadata in storage without new RPC method if storage schema supports it.

#### deleteKey
```typescript
async function deleteKey(keyId: string): Promise<void>
```
**Implementation:**
- Check if `keyId` is last remaining key → throw error
- Check if `keyId` is currently selected → auto-select another key first
- Call `KeyVaultService.deleteKey(keyId)`
- Remove from encrypted vault
- Broadcast updated state via KeyManagerContext
- Zeroize deleted key material from memory

**Security:** Must ensure deleted key material is overwritten before GC.

## Error Handling

### Key Selection Errors
- **Key not found**: Show toast "Key no longer exists", auto-select another
- **RPC timeout**: Show toast "Failed to switch key, try again"
- **Network error**: Retry once, then show error toast

### Add Key Errors
- **Duplicate key**: Show "This key already exists in your vault"
- **Invalid private key**: Show "Invalid key format, use nsec1... or hex"
- **Encryption failed**: Show "Failed to encrypt key, check password"
- **Storage full**: Show "Cannot add more keys, storage limit reached"

### Delete Key Errors
- **Last key**: Disable delete button, show tooltip "Cannot delete last key"
- **Key in use**: (Should not happen if we auto-select first) Show error "Cannot delete active key"
- **RPC error**: Show toast "Failed to delete key, try again"

## Performance Considerations

### Profile Fetching
- **Cache Strategy**: Use ProfileCacheService's existing 5-minute TTL cache
- **Batch Fetching**: Fetch all profiles in parallel on KeySelector mount
- **Lazy Loading**: Show key labels immediately, avatars load asynchronously
- **Fallback**: Always have local avatar generation for offline/failed fetches

### Rendering Optimization
- **React.memo**: Memoize KeySelector to prevent re-renders when parent updates
- **useMemo**: Memoize sorted key list, profile map
- **Virtualization**: Not needed initially (support 1-10 keys), add if >20 common

### Storage Impact
- **No new storage**: All data already in vault (keys) or profile cache (metadata)
- **Key count limit**: Recommend max 10 keys, no hard limit initially

## Security Considerations

### Key Deletion
- **Confirmation Required**: Must show explicit warning about data loss
- **Cannot Undo**: Make it clear deletion is permanent (no key backup flow yet)
- **Memory Zeroization**: Deleted key material must be overwritten before GC
- **Audit Logging**: Log key deletion events in ActivityLog

### Key Display
- **No Secrets in UI**: Never show private keys, only public keys (npub)
- **Copy Protection**: Only allow copying public keys, not private keys
- **Screen Reader Safety**: Ensure ARIA labels don't expose sensitive data

### RPC Security
- **Same Vault Lock**: All keys protected by same password/lock state
- **No Plaintext Storage**: All keys remain encrypted in vault
- **Origin Isolation**: Key selection doesn't bypass permission policies

## Testing Strategy

### Unit Tests
- KeySelector renders all keys correctly
- Profile metadata integration works with cache hits/misses
- Add key dialog handles create/import flows
- Delete confirmation prevents accidental deletion
- Last key cannot be deleted

### Integration Tests
- Key switching updates all UI components
- Add key creates and auto-selects new key
- Profile avatars load and fallback correctly
- Settings page operations sync with selector

### E2E Tests
- User can switch between 3 keys via selector
- User can add key via selector "Add Key" button
- User can rename key in settings
- User can delete non-active key from settings
- Keyboard navigation works through entire flow

### Accessibility Tests
- axe-core scanner passes with 0 violations
- Keyboard-only navigation works (no mouse)
- Screen reader announces key changes correctly
- Focus management works in dropdown and dialogs

## Open Design Questions

1. **Key Count Badge**: Should the selector trigger show "3 keys" indicator?
   - **Recommendation**: No, keep it minimal. Power users will know how many keys they have.

2. **Last Key Protection**: What happens if user tries to delete last key?
   - **Recommendation**: Disable delete button, show tooltip "Cannot delete last key". No logout.

3. **Add Key Visibility**: Always show "Add Key" or only when <N keys?
   - **Recommendation**: Always show. Simple, predictable UX.

4. **Key Ordering**: Should settings allow reordering keys?
   - **Recommendation**: Not in v1. Default to creation date order. Add drag-and-drop in future if requested.

5. **Key Grouping**: Support tags like "Work", "Personal"?
   - **Recommendation**: Not in v1. Keep it simple. Add if users request it.

## Migration Path

This is a pure additive change - no migration required:
- Existing single-key users see selector with 1 key (works as before)
- Add second key → selector shows dropdown with both keys
- No breaking changes to vault, RPC, or storage schemas
- All existing tests continue to pass

## Future Enhancements

Out of scope for this change, but related:
- **Key Backup Flow**: Export encrypted key backup before deletion
- **Key Import from File**: Import backup files
- **Key Sync**: NIP-46 remote signer integration
- **Key Tags/Groups**: Organize keys with custom labels
- **Key Search**: Filter keys by name when >10 keys
- **Key Ordering**: Drag-and-drop to reorder keys in selector
- **Key Health**: Show last used date, relay connectivity status
