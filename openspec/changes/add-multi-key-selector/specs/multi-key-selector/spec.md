# Spec Delta: Multi-Key Selector

**Change ID:** `add-multi-key-selector`  
**Capability:** `multi-key-selector` (NEW)  
**Type:** New Capability

## ADDED Requirements

### Requirement: REQ-MKS-001 - Key Selector Component

The system SHALL provide a KeySelector component that displays all available keys and allows switching between them via dropdown/popover interface.

**Priority:** High  
**Category:** UI Component

#### Acceptance Criteria
- Component renders trigger button showing currently selected key
- Clicking trigger opens dropdown with list of all keys
- Each key displays avatar, display name, and truncated npub
- Currently selected key has visual indicator (checkmark)
- Clicking a key item switches to that key and closes dropdown
- Component reads keys from KeyManagerContext
- Component calls `selectKey(keyId)` RPC method for switching

#### Scenario: User switches active key
**Given** the user has 3 keys in their vault (Alice, Bob, Charlie)  
**And** Alice's key is currently selected  
**When** the user clicks the KeySelector trigger  
**Then** the dropdown opens showing all 3 keys  
**When** the user clicks Bob's key  
**Then** the system calls `selectKey(bobKeyId)`  
**And** the dropdown closes  
**And** the UI updates to show Bob's key as active  
**And** all components using the selected key see Bob's key
**And** the browser window refreshes if the signer is connected to an app/site

---

### Requirement: REQ-MKS-002 - Profile-Aware Key Display

The system SHALL integrate profile metadata for each key, displaying profile avatars and display names when available.

**Priority:** High  
**Category:** Integration

#### Acceptance Criteria
- KeySelector fetches profile metadata for all keys on mount
- Profile avatar displayed if metadata.picture exists
- Fallback avatar displayed if no profile picture available
- Display name shown as: metadata.display_name || metadata.name || key.label
- Npub shown as secondary text (truncated to 16 chars)
- Avatar images load asynchronously without blocking UI
- Failed avatar loads fall back to generated avatar

#### Scenario: Key with profile metadata
**Given** the user has a key with public key npub1abc...def  
**And** that key has profile metadata with picture URL and display_name "Alice"  
**When** the KeySelector renders  
**Then** the key shows Alice's profile picture as avatar  
**And** the key shows "Alice" as the primary text  
**And** the key shows "npub1abc...def" as secondary text

#### Scenario: Key without profile metadata
**Given** the user has a key with label "Work Account"  
**And** that key has no profile metadata  
**When** the KeySelector renders  
**Then** the key shows a fallback avatar icon  
**And** the key shows "Work Account" as the primary text  
**And** the key shows the truncated npub as secondary text

---

### Requirement: REQ-MKS-003 - Add Key Action

The system SHALL provide an "Add Key" action within the KeySelector that allows users to create or import additional keys without leaving the current context.

**Priority:** High  
**Category:** User Action

#### Acceptance Criteria
- "Add Key" button displayed at bottom of KeySelector dropdown
- Clicking "Add Key" opens AddKeyDialog modal
- Dialog offers choice between "Create Key" and "Import Key"
- "Create Key" flow reuses OnboardingCreateKey component
- "Import Key" flow reuses OnboardingImportKey component
- Successful key creation/import automatically selects the new key
- Dialog closes after successful operation
- Errors shown inline in dialog (invalid input, duplicate key, etc.)

#### Scenario: User creates new key via selector
**Given** the user is on the Home view  
**And** the user has 1 key currently selected  
**When** the user clicks the KeySelector trigger  
**And** clicks "Add Key"  
**Then** the AddKeyDialog modal opens  
**When** the user selects "Create Key"  
**And** enters password "test123" and label "New Identity"  
**And** clicks "Generate"  
**Then** the system creates a new key with label "New Identity"  
**And** automatically selects the new key as active  
**And** the dialog closes  
**And** the KeySelector shows "New Identity" as the selected key

#### Scenario: User imports existing key via selector
**Given** the user is on the Profile view  
**And** the user has 2 keys in their vault  
**When** the user opens the KeySelector and clicks "Add Key"  
**Then** the AddKeyDialog opens  
**When** the user selects "Import Key"  
**And** enters valid nsec1... private key, password, and label  
**And** clicks "Import"  
**Then** the system imports the key  
**And** automatically selects the imported key as active  
**And** the dialog closes  
**And** the KeySelector shows the imported key

#### Scenario: Import fails with duplicate key
**Given** the user has a key with public key npub1abc...def  
**When** the user tries to import the same private key again  
**Then** the system shows error "This key already exists in your vault"  
**And** does not create a duplicate key  
**And** the dialog remains open for correction

---

### Requirement: REQ-MKS-004 - Settings Key Management

The system SHALL provide a "Keys & Identities" section in Settings that lists all keys and allows rename/delete operations.

**Priority:** Medium  
**Category:** Settings UI

#### Acceptance Criteria
- Settings page has new "Keys & Identities" section
- Section lists all keys with avatar, display name, label, and npub
- Currently selected key has "Active" badge
- Each key has "Rename", "Delete", and "Set Active" buttons
- Rename opens inline text input for label editing
- Delete shows confirmation dialog with warning text
- Last remaining key cannot be deleted (button disabled)
- Set Active calls `selectKey(keyId)` to switch keys

#### Scenario: User renames key in settings
**Given** the user has a key with label "Old Label"  
**When** the user navigates to Settings  
**And** clicks "Rename" on that key  
**Then** an inline text input appears with "Old Label" pre-filled  
**When** the user changes it to "New Label" and presses Enter  
**Then** the system updates the key label to "New Label"  
**And** the change is reflected in KeySelector immediately  
**And** a success notification is shown

#### Scenario: User deletes non-active key
**Given** the user has 3 keys (Alice active, Bob, Charlie)  
**When** the user navigates to Settings  
**And** clicks "Delete" on Bob's key  
**Then** a confirmation dialog appears with warning "This action cannot be undone"  
**When** the user confirms deletion  
**Then** the system deletes Bob's key from the vault  
**And** the key disappears from the list  
**And** the KeySelector no longer shows Bob's key  
**And** a success notification is shown

#### Scenario: Cannot delete last key
**Given** the user has only 1 key in their vault  
**When** the user navigates to Settings Keys section  
**Then** the "Delete" button for that key is disabled  
**And** hovering shows tooltip "Cannot delete last key"

---

### Requirement: REQ-MKS-005 - Keyboard Navigation

The system SHALL support full keyboard navigation for the KeySelector component.

**Priority:** High  
**Category:** Accessibility

#### Acceptance Criteria
- Tab key moves focus to KeySelector trigger
- Enter or Space opens dropdown when trigger focused
- Arrow Up/Down navigates through key list
- Enter selects focused key and closes dropdown
- Escape closes dropdown without changing selection
- Tab moves to "Add Key" button at bottom of list
- Focus visible with clear focus indicators (ring)
- Focus trap active when dropdown is open

#### Scenario: Keyboard-only key switching
**Given** the user has 3 keys in their vault  
**And** the KeySelector is closed  
**When** the user presses Tab to focus the trigger  
**And** presses Enter to open the dropdown  
**Then** the dropdown opens with first key focused  
**When** the user presses Arrow Down twice  
**Then** the third key is focused (visible focus ring)  
**When** the user presses Enter  
**Then** the third key becomes active  
**And** the dropdown closes  
**And** focus returns to the trigger

---

### Requirement: REQ-MKS-006 - ARIA Attributes

The system SHALL provide proper ARIA attributes for screen reader accessibility.

**Priority:** High  
**Category:** Accessibility

#### Acceptance Criteria
- KeySelector dropdown has `role="listbox"`
- Each key item has `role="option"`
- Active key has `aria-selected="true"`
- Trigger has `aria-label="Select active key"`
- "Add Key" button has `aria-label="Add new key"`
- Key descriptions use `aria-describedby` for npub
- Dropdown state communicated via `aria-expanded`

#### Scenario: Screen reader announces key selection
**Given** a screen reader user navigates to KeySelector  
**When** the trigger receives focus  
**Then** screen reader announces "Select active key, button, collapsed"  
**When** the user activates the trigger  
**Then** screen reader announces "Select active key, expanded, listbox with 3 items"  
**When** the user navigates to second key  
**Then** screen reader announces "Bob, Work Account, npub1xyz...123, option 2 of 3"

---

### Requirement: REQ-MKS-007 - Loading and Error States

The system SHALL provide clear loading and error states for async operations.

**Priority:** Medium  
**Category:** UX

#### Acceptance Criteria
- Key switching shows loading spinner on trigger during RPC call
- Profile avatars show skeleton loader while fetching
- Failed profile fetch shows fallback avatar (no error UI)
- Add key errors shown inline in dialog
- RPC timeout shows toast notification "Failed to switch key"
- Key list remains usable during profile metadata loading

#### Scenario: Key switching with slow RPC
**Given** the user clicks a different key in the selector  
**And** the `selectKey` RPC call takes 2 seconds  
**When** the user clicks the key  
**Then** the dropdown shows loading spinner immediately  
**And** the clicked key is visually marked as "switching"  
**And** other keys are disabled during the switch  
**When** the RPC completes successfully  
**Then** the loading spinner disappears  
**And** the new key is active  
**And** the dropdown closes

#### Scenario: Profile fetch failure
**Given** the user has 3 keys  
**And** one key's profile metadata fetch fails (network error)  
**When** the KeySelector renders  
**Then** the failed key shows a fallback avatar (icon)  
**And** the failed key shows its label as primary text  
**And** no error message is displayed (graceful degradation)  
**And** the user can still select that key normally

---

### Requirement: REQ-MKS-008 - Visual Design and Theming

The system SHALL provide consistent visual design that works in both light and dark themes.

**Priority:** Medium  
**Category:** UI/UX

#### Acceptance Criteria
- Hover states for all interactive elements
- Visible focus indicators (4px blue ring, WCAG 2.1 AA)
- Color contrast meets WCAG AA (4.5:1 for text, 3:1 for UI)
- Smooth transitions for dropdown open/close (200ms)
- Dropdown has subtle shadow and border
- Active key has checkmark icon in brand color
- All colors adapt to light/dark theme

#### Scenario: Dark theme rendering
**Given** the user has dark theme enabled  
**When** the KeySelector renders  
**Then** the trigger background is dark gray (#1a1a1a)  
**And** text is light gray (#e0e0e0)  
**And** dropdown background is dark gray with subtle border  
**And** hover states use lighter gray (#2a2a2a)  
**And** focus ring is visible blue (#3b82f6)  
**And** all text meets 4.5:1 contrast ratio

---

### Requirement: REQ-MKS-009 - Performance Requirements

The system SHALL render the key list and handle interactions with minimal latency.

**Priority:** Medium  
**Category:** Performance

#### Acceptance Criteria
- Key list renders in <100ms for up to 10 keys
- Key switching completes in <500ms (excluding network)
- Profile metadata fetched in parallel (not sequential)
- Component uses React.memo to prevent unnecessary re-renders
- Avatar images lazy-loaded with IntersectionObserver
- Dropdown open/close animation is 60fps smooth

#### Scenario: Fast rendering with multiple keys
**Given** the user has 10 keys in their vault  
**When** the user opens the KeySelector dropdown  
**Then** all 10 keys render within 100ms  
**And** no jank or lag is visible  
**And** scrolling is smooth (60fps)

---

### Requirement: REQ-MKS-010 - Delete Key Safety

The system SHALL protect users from accidental key deletion with confirmation and restrictions.

**Priority:** High  
**Category:** Security/UX

#### Acceptance Criteria
- Delete button requires confirmation dialog
- Confirmation shows warning "This action cannot be undone. Your key will be permanently deleted."
- Last remaining key cannot be deleted (button disabled)
- Deleting active key auto-selects another key first
- Deleted key material is zeroized from memory
- Deletion logged in ActivityLog with timestamp

#### Scenario: Delete with confirmation
**Given** the user has 2 keys (Alice active, Bob)  
**When** the user clicks "Delete" on Bob's key in Settings  
**Then** a confirmation dialog appears  
**And** dialog shows warning text about permanent deletion  
**When** the user clicks "Cancel"  
**Then** the dialog closes and Bob's key is not deleted  
**When** the user clicks "Delete" again and confirms  
**Then** Bob's key is permanently deleted  
**And** the deletion is logged in ActivityLog  
**And** a success notification appears

#### Scenario: Delete active key auto-switches
**Given** the user has 2 keys (Alice active, Bob)  
**When** the user deletes Alice's key  
**Then** the system automatically selects Bob's key first  
**And** then deletes Alice's key  
**And** Bob remains active after deletion
