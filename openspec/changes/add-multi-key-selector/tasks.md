# Implementation Tasks: Multi-Key Selector

**Change ID:** `add-multi-key-selector`  
**Status:** Pending Approval

> **Note**: Do not begin implementation until proposal is approved. These tasks represent the planned work.

## Phase 1: Core Selector Component

### 1.1 Create KeySelector Component
- [ ] Create `src/ui/components/layout/KeySelector.tsx` component
- [ ] Implement dropdown/popover UI using Radix DropdownMenu
- [ ] Display list of all keys from KeyManagerContext
- [ ] Show currently selected key with visual indicator (checkmark, highlight)
- [ ] Handle key selection via `selectKey` RPC method
- [ ] Add loading states for key switching operation
- [ ] Add error handling for failed key selection

### 1.2 Integrate Profile Metadata
- [ ] Import ProfileCacheService in KeySelector
- [ ] Fetch profile metadata for each key's public key
- [ ] Display profile avatar if available, else fallback avatar
- [ ] Display profile displayName/name if available, else key label
- [ ] Show npub as secondary text (truncated)
- [ ] Add loading skeleton for avatar images
- [ ] Handle missing/failed profile data gracefully

### 1.3 Update Header Component
- [ ] Replace current key display in Header.tsx with KeySelector component
- [ ] Remove standalone avatar display (now part of KeySelector)
- [ ] Maintain copy button functionality
- [ ] Maintain lock button functionality
- [ ] Test Header layout with new KeySelector
- [ ] Verify responsive behavior on small screens

## Phase 2: Add Key Action

### 2.1 Add Key Modal Dialog
- [ ] Create `src/ui/components/dialogs/AddKeyDialog.tsx` component
- [ ] Use Radix Dialog primitive with shadcn/ui styling
- [ ] Add two-step flow: Choose "Create" or "Import"
- [ ] Integrate OnboardingCreateKey component for create flow
- [ ] Integrate OnboardingImportKey component for import flow
- [ ] Handle dialog open/close state management
- [ ] Add success/error notifications

### 2.2 Integrate Add Key into Selector
- [ ] Add "Add Key" button at bottom of KeySelector dropdown
- [ ] Wire up to open AddKeyDialog modal
- [ ] Auto-select newly created/imported key after success
- [ ] Close selector dropdown after successful add
- [ ] Add keyboard shortcut for "Add Key" (e.g., Cmd/Ctrl+K)

## Phase 3: Settings Page Key Management

### 3.1 Keys & Identities Section
- [ ] Add new section to SettingsView.tsx
- [ ] List all keys with avatar, display name, label, and npub
- [ ] Show "Active" badge for currently selected key
- [ ] Add "Rename" button per key
- [ ] Add "Delete" button per key (disabled if last key)
- [ ] Add "Set Active" button per key (if not already active)

### 3.2 Key Rename Flow
- [ ] Create inline edit mode for key labels
- [ ] Validate label input (max length, non-empty)
- [ ] Add RPC method `renameKey(keyId, newLabel)` if not exists
- [ ] Update KeyVaultService to persist label changes
- [ ] Refresh KeyManagerContext after rename
- [ ] Show success notification

### 3.3 Key Delete Flow
- [ ] Create confirmation dialog for key deletion
- [ ] Show warning text about data loss (cannot be undone)
- [ ] Disable delete if it's the last remaining key
- [ ] Add RPC method `deleteKey(keyId)` if not exists
- [ ] Update KeyVaultService to remove key from vault
- [ ] If deleting active key, auto-select another key
- [ ] Show success notification
- [ ] Add error handling (key in use, etc.)

## Phase 4: Accessibility & Polish

### 4.1 Keyboard Navigation
- [ ] Test keyboard navigation through key list (Arrow Up/Down)
- [ ] Test Enter key for key selection
- [ ] Test Escape key to close selector
- [ ] Test Tab key to navigate to Add Key button
- [ ] Add keyboard shortcuts documentation

### 4.2 ARIA Attributes
- [ ] Add role="listbox" to key list container
- [ ] Add role="option" to each key item
- [ ] Add aria-selected for active key
- [ ] Add aria-label for Add Key button
- [ ] Add aria-describedby for key descriptions
- [ ] Test with screen reader (NVDA/JAWS on Windows)

### 4.3 Visual Design
- [ ] Add hover states for key items
- [ ] Add focus indicators (visible focus ring)
- [ ] Ensure color contrast meets WCAG AA (4.5:1 for text)
- [ ] Add smooth transitions for dropdown open/close
- [ ] Test in light and dark themes
- [ ] Add placeholder avatar for keys without profiles

### 4.4 Performance Optimization
- [ ] Memoize key list rendering with React.memo
- [ ] Optimize profile metadata fetching (batch requests)
- [ ] Add virtualization if key count exceeds threshold (e.g., >20)
- [ ] Lazy load key avatars with IntersectionObserver
- [ ] Test render performance with 1, 5, 10 keys

## Phase 5: Testing & Validation

### 5.1 Unit Tests
- [ ] Test KeySelector component renders all keys
- [ ] Test key selection updates context state
- [ ] Test Add Key dialog open/close
- [ ] Test profile metadata integration
- [ ] Test error handling (failed RPC, network errors)

### 5.2 Integration Tests
- [ ] Test key switching updates all UI components
- [ ] Test add key flow creates and selects new key
- [ ] Test delete key flow removes key and updates UI
- [ ] Test rename key flow updates label everywhere
- [ ] Test last key cannot be deleted

### 5.3 E2E Tests
- [ ] Test user can switch between multiple keys
- [ ] Test user can add new key via selector
- [ ] Test user can rename key in settings
- [ ] Test user can delete non-active key
- [ ] Test keyboard-only navigation works

### 5.4 Accessibility Audit
- [ ] Run axe-core accessibility scanner
- [ ] Test with keyboard-only navigation
- [ ] Test with screen reader (NVDA on Windows)
- [ ] Verify WCAG 2.1 AA compliance
- [ ] Fix any identified a11y issues

## Phase 6: Documentation

### 6.1 User Documentation
- [ ] Add "Managing Multiple Keys" section to docs
- [ ] Document how to add additional keys
- [ ] Document how to switch between keys
- [ ] Document how to rename/delete keys
- [ ] Add screenshots/GIFs of key selector in action

### 6.2 Developer Documentation
- [ ] Document KeySelector component props and API
- [ ] Document AddKeyDialog component usage
- [ ] Document RPC methods for key management
- [ ] Update architecture diagram with new components
- [ ] Add JSDoc comments to all new components

## Completion Criteria

All tasks above must be:
- [x] Implemented with passing tests
- [x] Code reviewed and approved
- [x] Accessibility audit passed
- [x] Documentation updated
- [x] Deployed to production
