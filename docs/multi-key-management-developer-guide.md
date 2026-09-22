# Multi-Key Management Developer Documentation

This document provides technical details about the multi-key selector components, RPC methods, and integration points for developers working on Ostrilo.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Components](#components)
3. [RPC Methods](#rpc-methods)
4. [Data Flow](#data-flow)
5. [Testing](#testing)
6. [Security Considerations](#security-considerations)
7. [Integration Points](#integration-points)
8. [Common Patterns](#common-patterns)

## Architecture Overview

The multi-key management system follows Ostrilo's hexagonal architecture pattern:

```
┌──────────────────────────────────────────────────────────────┐
│                          UI Layer                            │
│                                                              │
│  popup / side panel              options page                │
│  ┌────────────────┐              ┌────────────────────────┐  │
│  │ Header         │              │ KeysIdentitiesTab      │  │
│  │   └ KeySelector│              │   └ KeySelectorCard    │  │
│  │      - key list│              │      - Set Active      │  │
│  │      - seal    │              │      - inline rename   │  │
│  │      - Add Key │              │      - delete (reauth) │  │
│  └────────────────┘              └────────────────────────┘  │
│          │                                  │                │
│          ▼                                  │                │
│  ┌────────────────┐                         │                │
│  │ AddKeyDialog   │  (owned by MainApp)     │                │
│  │   CreateKeyForm│                         │                │
│  │   ImportKeyForm│                         │                │
│  └────────────────┘                         │                │
│          │                                  │                │
│          ▼                                  ▼                │
│  ┌──────────────────┐            ┌────────────────────────┐  │
│  │ KeyManagerContext│            │ messaging/client.ts    │  │
│  │  - selectKey()   │            │  - renameKey()         │  │
│  │  - generateKey() │            │  - deleteKey()         │  │
│  │  - importKey()   │            │                        │  │
│  └──────────────────┘            └────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼  RPC over browser.runtime messaging
┌──────────────────────────────────────────────────────────────┐
│                 Background (MV3 service worker)              │
│                                                              │
│  ┌──────────────────┐         ┌────────────────────┐         │
│  │  VaultRpcHandler │────────▶│ KeyVaultService    │         │
│  └──────────────────┘         │  - selectKey()     │         │
│                               │  - generateKey()   │         │
│  ┌──────────────────┐         │  - importKey()     │         │
│  │  ProfileService  │         │  - renameKey()     │         │
│  │  - getProfile()  │         │  - deleteKey()     │         │
│  └──────────────────┘         └────────────────────┘         │
└──────────────────────────────────────────────────────────────┘
```

Two surfaces, not one. The header selector switches the active key; the
options page's **Keys & Identities** tab is where keys are renamed and
deleted. `renameKey` and `deleteKey` are not on `KeyManagerContext` — the
settings tab imports them directly from
`src/infrastructure/messaging/client.ts`.

**Key Design Principles:**
- **No props on MainApp**: components access state via context, not props
- **Memoization**: `KeySelector` is wrapped in `React.memo` to prevent unnecessary re-renders
- **Profile caching**: `ProfileService` caches metadata for one hour (`DEFAULT_TTL_SECONDS = 3600`) to reduce relay queries
- **Local avatars only**: neither key surface loads the relay-supplied `picture` URL. Both render the local seal avatar with the key's initial. These are the surfaces on which a user confirms which identity is about to sign, so they make no request to a host a relay chose
- **Accessibility**: WCAG 2.1 AA target, with full keyboard navigation

## Components

### KeySelector

**Location:** `src/ui/components/layout/KeySelector.tsx`

**Purpose:** The header's account control — switches between keys and opens the
add-key flow. Rendered by `Header` (`src/ui/components/layout/Header.tsx`), which
is the popup and side-panel chrome.

Not to be confused with `KeySelectorCard`, the settings-page list documented
below. The two are separate components with separate jobs.

**Heading role:** the visible key name is also the screen's level-2 heading. An
`<h2>` wraps the trigger and points `aria-labelledby` at the name span, so the
control is announced (and found by tests) as the key's name rather than as the
trigger's own "Select active key" label.

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
- `useProfileMetadata(pubkeys)` (`src/ui/hooks/useProfileMetadata.ts`): fetches profile metadata for every key in parallel

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
  } finally {
    setIsSwitching(false);
  }
};
```

**Error Handling:**
- Network errors during key switch are written to the console. There is no toast: the extension ships no toast system, so a failed switch is silent to the user beyond the key not changing
- Prevents switching while another switch is in progress
- Prevents switching to already-selected key

#### `getKeyDisplay(key: UIKeyInfo)`
Extracts display information for a key with profile metadata fallbacks.

```typescript
const getKeyDisplay = (key: UIKeyInfo) => {
  const profile = profiles.get(key.publicKeyHex);
  const displayName =
    profile?.display_name || profile?.name || key.label || "Unnamed Key";
  const truncatedNpub = key.publicKeyBech32
    ? `${key.publicKeyBech32.slice(0, 12)}...${key.publicKeyBech32.slice(-4)}`
    : "";

  return { displayName, truncatedNpub };
};
```

No `avatarUrl` is returned. `profile.picture` is deliberately not read here; see
"Local avatars only" above.

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
- Profile metadata for every key is requested in parallel from one `useProfileMetadata(pubkeys)` call (`Promise.allSettled` over one `profile.get` RPC per pubkey — parallel, not a single batched request)
- No avatar images are fetched, so there is nothing to lazy-load: the seal fallback renders synchronously

### KeySelectorCard

**Location:** `src/ui/features/settings/components/shared/KeySelectorCard.tsx`

**Purpose:** The vault's keys as one grouped card of rows, on the options page's
**Keys & Identities** tab. This is the surface that renames, deletes and sets the
active key. Rendered by `KeysIdentitiesTab`
(`src/ui/features/settings/components/KeysIdentitiesTab.tsx`).

**Props:**
```typescript
interface KeySelectorCardProps {
  keys: KeyRecord[];
  selectedKeyId?: string;
  profiles: Map<string, KeyProfile>;
  onSelectKey?: (keyId: string) => void;
  onRename?: (keyId: string, newLabel: string) => void;
  onDelete?: (keyId: string) => void;
}
```

The `KeyRecord` and `KeyProfile` in this file are the component's own view
models, declared alongside it — not the domain `KeyRecord` in
`src/domain/types.ts`.

**Per-row controls:**
- **Set Active** — a button, shown only on rows that are not already active
- **Rename** — a pencil icon button (`aria-label="Rename <name>"`) that swaps the row into an inline `Input` with check/cancel icon buttons; Enter saves, Escape cancels
- **Delete** — a trash icon button (`aria-label="Delete <name>"`), disabled on the last remaining key with the title "The only key in the vault cannot be deleted."
- **Copy** — a copy icon button beside the npub, with a "Copied" status for 1.5s

**Active marker:** a mint `ACTIVE` chip (`.seal-chip-success`), not a tinted row —
mint is the one colour that means "on" (`docs/design/DESIGN_RULES.md` §2).

**Unreadable records:** a key whose stored public key is not valid hex renders
"Unreadable record: stored public key is not valid" in place of an npub, rather
than a decoded one. The decoder this replaced substituted zero bytes for
unparseable characters, so a corrupt record produced a real, well-formed npub for
a key nobody holds.

**Deletion does not confirm here.** The card calls `onDelete(keyId)` directly.
`KeysIdentitiesTab` collects the vault password in a `ReauthDialog`
(`src/ui/components/dialogs/ReauthDialog.tsx`, driven by
`src/ui/hooks/useReauth.ts`) and the background refuses the deletion without it.
A native `confirm()` in front of that was a second confirmation with worse copy.

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
Uses `CreateKeyForm` (`src/ui/components/dialogs/CreateKeyForm.tsx`):
- **Vault Password** input — required. The password is re-entered even though the vault is unlocked; the form holds it in a ref and clears the input afterwards, so nothing long-lived carries it
- **Key Name** input
- Calls `generateKey(password, label)` RPC, submit button "Create Key"

#### 3. Import Step
Uses `ImportKeyForm` (`src/ui/components/dialogs/ImportKeyForm.tsx`):
- **Vault Password** input — required, same zero-retention handling
- **Private Key (nsec or hex)** input, with a show/hide toggle
- **Key Name** input
- Calls `importKey(keyInput, password, label)` RPC, submit button "Import Key"

**Neither flow selects the new key.** `KeyVaultService` sets `isSelected` only
when the vault had no keys at all, and `MainApp` passes `refreshKeys` as
`onSuccess`. A key therefore arrives without silently changing who signs next —
the user switches to it from the selector. `tests/e2e/multi-key-selector.spec.ts`
asserts this.

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
Called after successful key creation/import. `onSuccess` is invoked with an empty
string: the dialog has no use for the new key's id, and every caller treats the
callback as "refresh the list".

```typescript
const handleSuccess = () => {
  handleClose();
  // Refresh the key list in the parent component
  if (onSuccess) {
    onSuccess(""); // keyId not needed, just refresh the list
  }
};
```

**ARIA Attributes:** the dialog role and labelling come from Radix `Dialog`. The
content sets `aria-describedby={undefined}` deliberately — the title says
everything the choice needs and the forms label their own fields, and that is how
Radix is told the missing description is intentional rather than an oversight.

> The options page has its **own** add-key dialog inside `KeysIdentitiesTab`,
> built from `Dialog` plus the same `CreateKeyForm`/`ImportKeyForm`. It does not
> reuse `AddKeyDialog`. Changing the add-key flow means changing both.

## RPC Methods

Multi-key management uses the following methods. Each one is a wire message
handled by `VaultRpcHandler`
(`src/infrastructure/messaging/handlers/vault-rpc.ts`) and executed by
`KeyVaultService` (`src/application/services/key-vault.service.ts`). The UI never
calls the service directly; it calls the typed wrappers in
`src/infrastructure/messaging/client.ts`.

| Wrapper | Wire message | Reachable while locked |
|---|---|---|
| `listKeys()` | `keys.list` | yes (projected to ids only) |
| `selectKey(id)` | `vault.select` | no |
| `generateKey(password, label?)` | `vault.generate` | yes — verifies the password itself |
| `importKey(keyInput, password, label?)` | `vault.import` | yes — verifies the password itself |
| `renameKey(id, label)` | `vault.renameKey` | no |
| `deleteKey(id, password)` | `vault.deleteKey` | no |

Lock gating is an allowlist in `src/infrastructure/messaging/rpc-router.ts`
(`LOCKED_REACHABLE_METHODS`): anything absent from it is refused with `locked`,
so a new method is lock-gated by default.

### selectKey

**Signature:**
```typescript
async selectKey(id: string): Promise<void>
```

**Purpose:** Switches the active key to the specified key ID.

**Implementation:** `src/application/services/key-vault.service.ts`

**Workflow:**
1. Write `selectedKeyId` into settings (`storage.sync`)
2. Re-mark `isSelected` across the stored key list (`storage.local`)
3. Update `selectedKeyId` on the session lock state if the vault is unlocked
4. `KeyManagerContext.selectKey` then calls `refreshKeys()`, and every `useKeyManager` consumer re-renders

**Error Cases:**
- `invalid_params`: `id` is not a UUID (`KeyIdSchema`)
- `locked`: the router refuses `vault.select` while the vault is locked

The handler does **not** check that the key exists — a well-formed UUID for a key
that is not in the vault is written to settings and resolves to no selected key
in the UI.

**Example:**
```typescript
await selectKey("6f0a1e2c-9b3d-4a57-8c21-0d4e5f6a7b89");
```

### generateKey

**Signature:**
```typescript
async generateKey(password: string, label?: string): Promise<KeyRecord>
```

**Purpose:** Generates a new Nostr keypair and adds it to the vault.

**Workflow:**
1. Derive the vault KEK from the password (`kekForWrite`)
2. Draw 32 random bytes and derive the public key (`@noble/curves` secp256k1 Schnorr, via the injected adapter)
3. Seal the private key under a per-record DEK, itself wrapped by the KEK
4. Build a `KeyRecord` with `isSelected: false`
5. Select it **only if the vault had no keys at all**
6. Append to the stored list and persist
7. Zeroize the private key and the KEK in a `finally`

**Parameters:**
- `password`: the vault password. Required — it is re-entered by the user even when the vault is unlocked, and there is no session password to reuse
- `label`: optional user-friendly identifier, max 100 characters (`LabelSchema`)

**Returns:** the domain `KeyRecord` from `src/domain/types.ts`:

```typescript
interface KeyRecord {
  id: string;            // uuid
  label?: string;        // user-visible label
  pubkey: string;        // hex
  ct: number[];          // AES-GCM ciphertext of the private key
  iv: number[];          // 12-byte IV
  v?: number;            // format version; absent means a legacy record
  wrappedDek?: { ct: number[]; iv: number[] }; // present on v:1 records
  createdAt: number;
  lastUsedAt?: number;
  isSelected?: boolean;
}
```

There is no `publicKeyBech32` on the record. The npub is encoded by the
background when it projects records into `KeyListEntry` for `keys.list`, and
`KeyManagerContext.toUIKeyInfo` carries it into `UIKeyInfo.publicKeyBech32`.

**Error Cases:**
- `invalid_params`: password or label fails validation
- `invalid_password`: the password does not match the existing vault

**Example:**
```typescript
const newKey = await generateKey(vaultPassword, "Work Account");
console.log("Created:", newKey.pubkey);
```

### importKey

**Signature:**
```typescript
async importKey(input: string, password: string, label?: string): Promise<KeyRecord>
```

**Purpose:** Imports an existing Nostr private key into the vault.

**Workflow:**
1. Derive the vault KEK from the password
2. Parse `input` (nsec1 or hex) and derive the public key
3. Refuse if a record with that public key already exists
4. Seal the private key exactly as `generateKey` does
5. Select it **only if the vault had no keys at all**
6. Append to the stored list and persist
7. Zeroize the private key and the KEK in a `finally`

**Parameters:**
- `input`: `nsec1...` or 64-char hex string
- `password`: the vault password, required
- `label`: optional identifier, max 100 characters

**Error Cases:**
- `invalid_key_input`: not a valid nsec1 or hex key
- `key_already_exists`: a record with that public key is already in the vault
- `invalid_password`: does not match the existing vault
- `locked`: the vault is locked and the password was not accepted

**Example:**
```typescript
const imported = await importKey("nsec1abc123...", vaultPassword, "Imported Key");
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

**Validation (`LabelSchema`, `src/infrastructure/validation/schemas.ts`):**
- Maximum 100 characters
- Any Unicode characters allowed

**Error Cases:**
- `invalid_params`: `id` is not a UUID, or the label is too long
- `key_not_found`: no record with that id
- `locked`: the vault is locked

Renaming is **not** re-authenticated. It changes a local label and destroys
nothing, so an unlocked vault is authority enough.

**Example:**
```typescript
await renameKey("6f0a1e2c-9b3d-4a57-8c21-0d4e5f6a7b89", "Personal Account");
```

### deleteKey

**Signature (client wrapper — note the password):**
```typescript
async deleteKey(id: string, password: string): Promise<{ newSelectedKeyId?: string }>
```

The service method underneath is `deleteKey(id)`. The password is consumed one
level up, by `requireReauth` in the RPC handler, and is never passed to the
service.

**Purpose:** Permanently removes a key from the vault.

**Workflow:**
1. Validate `id` is a UUID
2. **Re-verify the password** (`requireReauth`, `src/infrastructure/messaging/reauth.ts`). Deleting a key is irreversible and, for a key that is not backed up, final — an unlocked vault is not enough authority for that
3. Refuse if this is the last remaining key
4. Refuse if no record has that id
5. Remove the record and persist
6. Zeroize the key's unlocked in-memory material, if it is in the unlocked map
7. If the deleted key was selected, auto-select the first remaining key
8. Return the new selected key id if one was chosen

Note the order: the key is removed **first**, then a replacement is selected.

**Security:**
- Requires the vault password, re-verified in the background regardless of what the UI does
- Unlocked private key bytes are overwritten via `zeroize()`
- The operation cannot be undone

**Error Cases:**
- `invalid_params`: `id` is not a UUID, or the key is the last remaining one ("Cannot delete the last remaining key")
- `invalid_password`: the re-authentication failed
- `key_not_found`: no record with that id
- `locked`: the vault is locked

**Returns:**
```typescript
{
  newSelectedKeyId?: string; // id of the key auto-selected if the active key was deleted
}
```

**Example:**
```typescript
const result = await deleteKey(keyId, vaultPassword);
if (result.newSelectedKeyId) {
  console.log("Auto-switched to:", result.newSelectedKeyId);
}
```

Callers should drop their reference to `password` as soon as this resolves; a JS
string cannot be wiped, so the practical rule is never to put it in component
state that outlives the dialog.

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
onAddKey() -> MainApp opens AddKeyDialog
    │
    ▼
User chooses "Create" or "Import"
    │
    ├─▶ Create: CreateKeyForm
    │       │   (vault password + key name)
    │       ▼
    │   generateKey(password, label)
    │       │
    └─▶ Import: ImportKeyForm
            │   (vault password + nsec/hex + key name)
            ▼
        importKey(keyInput, password, label)
            │
            ▼
    Background appends the record. isSelected stays false
    unless the vault had no keys at all.
            │
            ▼
    AddKeyDialog.handleSuccess() -> onSuccess("")
            │
            ▼
    MainApp.refreshKeys() -> new key appears in the list
            │
            ▼
    Dialog closes. The ACTIVE key is unchanged; the user
    switches to the new key from the selector if they want it.
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
    RPC profile.get -> ProfileService.getProfile(publicKeyHex)
    │
    ├─▶ Cache hit and not expired: return cached metadata
    │
    └─▶ Cache miss or stale: fetch from relays, cache, return
            │   (on relay failure, fall back to the expired entry)
            ▼
    Store in local state: profiles.set(publicKeyHex, metadata)
    │
    ▼
Render each key with:
    - Seal avatar bearing the display name's first letter
      (never metadata.picture - see "Local avatars only")
    - Display name (metadata.display_name || metadata.name || label)
    - Secondary text (npub truncated)
```

The map is keyed by **hex public key**, not key id.

## Testing

### Unit Tests

**Location:** `tests/unit/ui/components/`

**Coverage:**
- KeySelector logic (display formatting, selection logic, profile integration)
- AddKeyDialog flow transitions
- Error handling

These are logic tests over the components' display and step-transition rules,
not render tests.

**Run:**
```bash
pnpm run test:unit tests/unit/ui/components/KeySelector.test.ts
pnpm run test:unit tests/unit/ui/components/AddKeyDialog.test.ts
```

### Integration Tests

**There is no integration-level suite for multi-key management.** `tests/integration/`
holds nine suites and none of them covers this feature. Earlier revisions of this
document cited a `multi-key-management.test.ts` in that directory; no such file
has ever existed in the repository.

Cross-layer multi-key behaviour is covered instead by the E2E suite below, which
drives the real extension against the real background, and by the security
boundary tests:

- `tests/security/reauth-boundary.test.ts` — deletion refused without a password, refused with a wrong password, proceeds with the correct one, never echoes it, does not remember it for the next action; and rename deliberately **not** gated
- `tests/security/rpc-privilege-boundary.test.ts` — which RPC methods a caller may reach
- `tests/security/lock-gate.test.ts` — the locked-vault allowlist
- `tests/security/memory-zeroization.test.ts` — key material overwritten after use
- `tests/unit/ui/features/settings/tab-components.test.tsx` — the Keys & Identities tab renders and wires its handlers

If you add an integration-level suite for this feature, cite it here and delete
this paragraph.

**Run:**
```bash
pnpm run test:security
```

### E2E Tests

**Location:** `tests/e2e/multi-key-selector.spec.ts`

This is the closest thing to end-to-end coverage of the feature. Its cases:

- adds a second key from the header and switches the active identity (and asserts that adding does **not** auto-select)
- lists every key and marks exactly one as selected
- opens, moves and closes with the keyboard
- the active key survives closing and reopening the popup
- Settings — lists every key and Set Active moves the badge and the vault
- Settings — renaming a key needs no password and the label follows the key
- Settings — deleting a key is password gated and a wrong password refuses
- Settings — deleting the active key promotes the first remaining key
- Settings — deleting the session's only unlocked key locks the vault
- Settings — the last remaining key cannot be deleted
- import into an existing vault takes the existing vault password, and refuses a wrong one

**Run:**
```bash
pnpm run test:e2e tests/e2e/multi-key-selector.spec.ts
```

**Note:** E2E tests require a built extension.

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
pnpm run test:unit tests/unit/ui/accessibility/
```

## Security Considerations

### Key Encryption

All private keys are encrypted at rest using AES-GCM under a two-level key
hierarchy. One password-derived key-encryption key (KEK) per vault wraps a
per-key data-encryption key (DEK), so unlocking costs exactly one KDF run
regardless of how many keys the vault holds.

```typescript
// src/domain/types.ts
interface VaultEnvelope {
  v: number;
  kdf: KdfParams;                            // recorded, never inferred from code
  verifier: { ct: number[]; iv: number[] };  // known plaintext under the KEK
  createdAt: number;
  updatedAt: number;
}

// The encrypted parts of a KeyRecord
ct: number[];                                 // AES-GCM ciphertext of the private key
iv: number[];                                 // 12-byte IV
wrappedDek?: { ct: number[]; iv: number[] };  // this record's DEK, under the KEK
```

**Key derivation:** Argon2id by default (`m` 19456 KiB, `t` 2, `p` 1 — the
OWASP-listed configuration). PBKDF2-HMAC-SHA256 is also supported, with a floor
of 600,000 iterations. The parameters are stored on the envelope so the work
factor can be raised later without guessing how an existing record was written,
and a record whose recorded cost is below `KDF_FLOORS` is refused rather than
silently accepted.

**Legacy records:** a record with no `v` predates the envelope — PBKDF2-HMAC-SHA256
at 100,000 iterations, no AAD, one derivation per key. Those are read-only and
lazily migrated on unlock.

**Encryption:** AES-256-GCM, with additional authenticated data binding each
ciphertext to its record (`src/domain/crypto/aad.ts`) so a ciphertext cannot be
moved between entries.

**Storage:** `browser.storage.local` for the encrypted key list and the vault
envelope, `browser.storage.sync` for settings (including `selectedKeyId`), and
`browser.storage.session` for lock state. Not IndexedDB.

**Implementation:** `src/infrastructure/crypto/adapters.ts`.

### Memory Zeroization

Private key bytes and derived keys are overwritten through the shared `zeroize()`
helper rather than by hand. `generateKey` and `importKey` zeroize the secret and
the KEK in a `finally`, so they are wiped even when sealing throws; `deleteKey`
zeroizes the record's unlocked material if it is in the unlocked map.

```typescript
// src/application/services/key-vault.service.ts, deleteKey
const unlockedKey = this.unlocked.get(id);
if (unlockedKey) {
  zeroize(unlockedKey);
  this.unlocked.delete(id);
}
```

This only reaches `Uint8Array` material the service owns. A JavaScript string
cannot be wiped, which is why passwords are held in refs and dropped rather than
stored in component state. `tests/security/memory-zeroization.test.ts` covers
this.

### RPC Security

- **Lock state** is enforced centrally in `rpc-router.ts` against an allowlist, so a method is lock-gated unless it is named as reachable
- **Parameter validation** with Zod schemas at the handler boundary (`KeyIdSchema`, `LabelSchema`, password and key-input schemas)
- **Re-authentication** for irreversible or trust-raising actions, via `requireReauth`. Key deletion is one; renaming is deliberately not
- **Origin isolation**: page-facing provider methods never reach the vault handlers directly

### Audit Logging

**Key management operations are not written to the activity log.** The log
records signing and identity-disclosure decisions (`handlers/nostr-rpc.ts`) and
profile publishes (`handlers/profile-rpc.ts`); `vault-rpc.ts` makes no
`addEntry` call. Creating, importing, selecting, renaming and deleting a key
therefore leave no activity-log entry.

If key-management auditing is added, log it in `VaultRpcHandler` and update this
section.

**Log retention:** ring buffer, bounded by `maxActivityEntries` in settings
(`ActivityLogService.setMaxEntries`)  
**Privacy:** entries carry timestamps, operation type, origin and outcome — never
private keys

## Integration Points

### KeyManagerContext

**Location:** `src/ui/state/KeyManagerContext.tsx`

**Purpose:** Provides reactive state for all key operations.

**Provider Setup:** every surface mounts its own provider — `App` (popup),
`AppPanel` (side panel), `OptionsApp` (options page).

```tsx
<KeyManagerProvider>
  <MainApp />
</KeyManagerProvider>
```

**Consumer Hook:** `useKeyManager`
(`src/ui/features/authentication/hooks/useKeyManager.ts`) is the wrapper
components use. It re-exposes the context as public information only.

```typescript
const {
  keys,                  // All available keys (UIKeyInfo[])
  selectedUnlockedKey,   // Currently active key (context's selectedKeyInfo)
  selectKey,             // Switch active key
  generateKey,           // Create new key -> returns the new key's id
  importKey,             // Import existing key -> returns the new key's id
  lock, unlock,          // Vault session
  refreshKeys,           // Re-read the key list
  isLocked, isLoading,   // Vault state
  lockAt,                // Auto-lock deadline (epoch ms), absent while locked
  hasKeys,               // Has at least one key
} = useKeyManager();
```

`useKeyManagerContext()` is the raw context, and additionally exposes
`isInitialising` — true only until the first lock-state and key-list read
resolves. Gate on that, not `isLoading`, when deciding whether to render a lock
screen: `isLoading` is also true during an unlock attempt, and gating on it
unmounts the lock screen mid-attempt and destroys the error it was about to show.

**`renameKey` and `deleteKey` are not on this context.** Import them from
`@/infrastructure/messaging/client`.

**Lock synchronisation:** the provider re-checks lock state every 5 seconds
(`LOCK_POLL_MS`) and also listens for the `VAULT_LOCKED` broadcast. Both are
needed: the broadcast is immediate but is lost if the worker was evicted, and the
poll is what evaluates the auto-lock deadline. If the background is unreachable
the provider assumes locked.

### ProfileService

**Location:** `src/application/services/profile.service.ts` (class `ProfileService`,
method `getProfile(pubkey, forceFetch?)`)

**Integration:** the UI never touches the service. It uses the hook, which issues
one `profile.get` RPC per pubkey.

```typescript
const { profiles, isLoading, error } = useProfileMetadata(pubkeys);

// profiles: Map<hexPubkey, ProfileMetadata>
// isLoading: boolean
// error: string | null
```

**Cache TTL:** one hour (`DEFAULT_TTL_SECONDS = 3600`)  
**Parallel fetching:** all pubkeys requested concurrently via `Promise.allSettled`; one failure does not sink the rest  
**Offline support:** on relay failure the cached entry is returned even if expired

### Header Component

**Location:** `src/ui/components/layout/Header.tsx`

The header renders the key selector and the lock button, and nothing else — no
mascot, no wordmark. It does **not** own `AddKeyDialog`; it only forwards an
`onAddKey` callback.

```tsx
// Header.tsx
<KeySelector onAddKey={onAddKey} />
```

`MainApp` (`src/ui/components/layout/MainApp.tsx`) owns the dialog state and
passes `onAddKey` down through `AppLayout`:

```tsx
// MainApp.tsx
<AppLayout activeTab={activeTab} onTabChange={setActiveTab} onAddKey={handleAddKey}>
  {tabContent}
</AppLayout>

<AddKeyDialog
  isOpen={isAddKeyDialogOpen}
  onClose={() => setIsAddKeyDialogOpen(false)}
  onSuccess={refreshKeys}
/>
```

### Where key management lives

The popup's Settings tab (`BasicSettings`) is a quick-control surface: theme,
auto-lock and "Lock now". It does not manage keys. It links out to the options
page instead, via `openOptionsTab("keys")`
(`src/ui/lib/open-options.ts`), which opens `#keys` on the options page.

Full key management is the options page's **Keys & Identities** tab
(`src/extension/options/OptionsApp.tsx` → `KeysIdentitiesTab`). The options page
is lock-gated by `OptionsGate`, which renders the lock screen when the vault is
locked and a "create a key in the popup first" message when there is no vault.

## Common Patterns

### Adding a New Key Management Feature

1. **Define RPC method** in `KeyVaultService`
2. **Expose via context** in `KeyManagerContext`
3. **Create UI component** — shared chrome in `src/ui/components/`, settings surfaces in `src/ui/features/settings/components/` (build tabs from `SettingsLayout`, per `docs/design/DESIGN_RULES.md` §7)
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

**Issue:** E2E tests failing  
**Solution:** Ensure the extension is built (`pnpm run build`), check fixture setup in `tests/e2e/fixtures`

**Issue:** Delete does nothing and no error appears  
**Solution:** The re-auth dialog was cancelled, or the password was wrong. The background refuses the deletion without a verified password; check the console for the RPC error code

## Future Enhancements

Potential improvements tracked in openspec:

- **Key export functionality**: Export encrypted backup files
- **Key grouping/tagging**: Organize keys with custom tags
- **Key reordering**: Drag-and-drop to reorder keys in selector
- **Key health indicators**: Show last used date, relay connectivity
- **Multi-device sync**: NIP-46 remote signer integration
- **Keyboard shortcuts**: Global hotkey for quick key switching

The original design notes are archived at
`openspec/changes/archive/2025-12-17-add-multi-key-selector/design.md`. The live
requirements are `openspec/specs/multi-key-selector/spec.md`.
