# multi-key-selector Specification

## Purpose

Defines how Ostrilo presents and manages more than one Nostr identity: the
header key selector that switches the active key, the add-key flow, and the
Keys & Identities tab on the settings page where keys are renamed and deleted.

Implemented by `src/ui/components/layout/KeySelector.tsx` (header),
`src/ui/features/settings/components/shared/KeySelectorCard.tsx` and
`src/ui/features/settings/components/KeysIdentitiesTab.tsx` (settings page), and
`src/ui/components/dialogs/AddKeyDialog.tsx`. Visual rules come from
`docs/design/DESIGN_RULES.md`.
## Requirements
### Requirement: REQ-MKS-001 - Key Selector Component

The system SHALL provide a KeySelector component that displays all available keys and allows switching between them via dropdown/popover interface.

**Priority:** High  
**Category:** UI Component

#### Acceptance Criteria
- Component renders trigger button showing currently selected key
- Clicking trigger opens dropdown with list of all keys
- Each key displays a seal avatar, display name, and truncated npub
- Currently selected key has visual indicator (checkmark)
- Clicking a key item switches to that key and closes dropdown
- Component reads keys from `KeyManagerContext`, via the `useKeyManager` wrapper
- Component calls the `selectKey(id)` RPC wrapper for switching (wire message `vault.select`)
- The trigger is disabled while a switch is in flight, and re-selecting the already-active key is a no-op

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

---

### Requirement: REQ-MKS-002 - Profile-Aware Key Display

The system SHALL integrate profile metadata for each key, displaying the profile
display name when available. The header trigger SHALL show the selected key's own
profile picture from a local copy when one exists. It SHALL NOT load relay-supplied
profile pictures on any key-selection surface.

**Priority:** High  
**Category:** Integration

#### Acceptance Criteria
- KeySelector requests profile metadata for all keys on mount, in parallel, keyed by hex public key
- Display name shown as: `metadata.display_name || metadata.name || key.label || "Unnamed Key"`
- List rows (the dropdown and the settings key list) are ALWAYS the local seal bearing the display name's first letter. `metadata.picture` MUST NOT be used as an image source on any key-selection surface
- The header trigger shows the selected key's local picture copy, a `data:` image at a fixed size with the display name as its alternative text, and the seal when the key has none. It never shows another key's copy, not even while a switch settles
- Npub shown as secondary text, middle-truncated, in mono (`DESIGN_RULES` §7)
- A failed profile fetch degrades to the label with no error UI

#### Scenario: Key with profile metadata
**Given** the user has a key with public key npub1abc...def  
**And** that key has profile metadata with a picture URL and display_name "Alice"  
**When** the KeySelector renders  
**Then** the key shows a seal avatar with the letter "A"  
**And** no request is made to the picture URL's host  
**And** the key shows "Alice" as the primary text  
**And** the key shows the truncated npub as secondary text

#### Scenario: Selected key with a local picture copy
**Given** the selected key has a local copy of its picture  
**When** the KeySelector renders  
**Then** the header trigger shows that image at a fixed size, named for the display name  
**And** the image source is a `data:` URL  
**And** the dropdown rows still show seals  
**When** the user switches to a key with no copy  
**Then** the header shows that key's seal and never the previous key's image

#### Scenario: Key without profile metadata
**Given** the user has a key with label "Work Account"  
**And** that key has no profile metadata  
**When** the KeySelector renders  
**Then** the key shows a seal avatar with the letter "W"  
**And** the key shows "Work Account" as the primary text  
**And** the key shows the truncated npub as secondary text

#### Scenario: Stored public key cannot be decoded
**Given** a stored record whose public key is not valid hex  
**When** the settings key list renders that record  
**Then** the row states that the record is unreadable  
**And** no npub is rendered for it

### Requirement: REQ-MKS-003 - Add Key Action

The system SHALL provide an "Add Key" action within the KeySelector that allows users to create or import additional keys without leaving the current context.

**Priority:** High  
**Category:** User Action

#### Acceptance Criteria
- "Add Key" item displayed at the bottom of the KeySelector dropdown, below a separator, when an `onAddKey` callback is supplied
- Activating it opens the AddKeyDialog modal, whose state is owned by `MainApp`
- Dialog offers a choice between "Create New Key" and "Import Existing Key"
- "Create New Key" uses `CreateKeyForm`; "Import Existing Key" uses `ImportKeyForm` (both in `src/ui/components/dialogs/`). Neither reuses the onboarding screens
- Both forms REQUIRE the vault password, even when the vault is unlocked. The password is held in a ref and the input cleared afterwards; it is never placed in component state that outlives the dialog
- A successfully added key is NOT made active. The vault selects a new key only when it held no keys at all
- Dialog closes after a successful operation and the key list is refreshed
- Errors shown inline in the dialog (invalid input, duplicate key, wrong password)

#### Scenario: User creates new key via selector
**Given** the user is on the Home view  
**And** the user has 1 key currently selected  
**When** the user clicks the KeySelector trigger  
**And** activates "Add Key"  
**Then** the AddKeyDialog modal opens  
**When** the user selects "Create New Key"  
**And** enters the vault password and the key name "New Identity"  
**And** clicks "Create Key"  
**Then** the system creates a new key with label "New Identity"  
**And** the previously active key REMAINS active  
**And** the dialog closes  
**And** the KeySelector lists "New Identity" as an available key

#### Scenario: User imports existing key via selector
**Given** the user is on the Profile view  
**And** the user has 2 keys in their vault  
**When** the user opens the KeySelector and activates "Add Key"  
**Then** the AddKeyDialog opens  
**When** the user selects "Import Existing Key"  
**And** enters the vault password, a valid nsec1... private key, and a key name  
**And** clicks "Import Key"  
**Then** the system imports the key  
**And** the previously active key REMAINS active  
**And** the dialog closes  
**And** the KeySelector lists the imported key

#### Scenario: Add key with the wrong vault password
**Given** the user has a vault with at least one key  
**When** the user submits the create or import form with an incorrect password  
**Then** the system refuses with `invalid_password`  
**And** no key is added to the vault

#### Scenario: Import fails with duplicate key
**Given** the user has a key with public key npub1abc...def  
**When** the user tries to import the same private key again  
**Then** the system refuses with `key_already_exists`  
**And** does not create a duplicate key  
**And** the dialog remains open for correction

---

### Requirement: REQ-MKS-004 - Settings Key Management

The system SHALL provide a "Keys & Identities" tab on the options page that lists
all keys and allows rename, delete and set-active operations.

**Priority:** Medium  
**Category:** Settings UI

#### Acceptance Criteria
- The options page has a "Keys & Identities" tab, reachable at `#keys` and linked from the popup's Settings tab
- Key management is NOT reproduced in the popup, which carries quick controls only
- The tab lists all keys with a seal avatar, display name, label and npub, in one grouped card
- The currently selected key carries a mint `ACTIVE` chip, not a tinted row (`DESIGN_RULES` §2)
- Each row has a rename (pencil) icon button and a delete (trash) icon button; rows that are not active also have a "Set Active" button
- Every icon button carries an `aria-label` naming both the action and the key
- The npub has a copy affordance (`DESIGN_RULES` §7)
- Rename swaps the row into an inline text input; Enter saves, Escape cancels. A saved label SHOULD reach every open surface without a reload — it currently does not; see the defect note below
- Delete requires the vault password, collected in a re-authentication dialog that names the key and states the consequence
- The last remaining key cannot be deleted (button disabled, with a title explaining why)
- Set Active calls `selectKey(id)` to switch keys
- The tab is unreachable while the vault is locked: the options page renders the lock screen instead

#### Scenario: User renames key in settings
**Given** the user has a key with label "Old Label"  
**When** the user opens the Keys & Identities tab  
**And** activates the rename button on that key  
**Then** an inline text input appears with "Old Label" pre-filled  
**When** the user changes it to "New Label" and presses Enter  
**Then** the system persists the key label as "New Label"  
**And** NO password is requested  
**And** the row and the KeySelector continue to show "Old Label" until the surface is reloaded

> Defect, pinned deliberately by `tests/e2e/multi-key-selector.spec.ts`:
> `KeysIdentitiesTab.handleRename` calls the rename RPC and never refreshes the
> key list, and nothing broadcasts key changes. The user's evidence that a
> rename worked is the label they can see, and it says the rename did nothing.
> The intended behaviour is that the new label reaches every open surface
> without a reload; when that lands, this note and the test's two pinned
> assertions go.

#### Scenario: User deletes non-active key
**Given** the user has 3 keys (Alice active, Bob, Charlie)  
**When** the user opens the Keys & Identities tab  
**And** activates the delete button on Bob's key  
**Then** a re-authentication dialog appears naming Bob's key  
**And** it states that if the key is not backed up the identity is gone for good  
**When** the user enters the correct vault password and confirms  
**Then** the system deletes Bob's key from the vault  
**And** the key disappears from the list  
**And** the KeySelector no longer shows Bob's key

#### Scenario: Deletion refused without a verified password
**Given** the user has 3 keys  
**When** the user activates delete and cancels the re-authentication dialog  
**Then** no key is deleted  
**When** the user activates delete and enters an incorrect password  
**Then** the background refuses with `invalid_password`  
**And** the key is still in the vault

#### Scenario: Cannot delete last key
**Given** the user has only 1 key in their vault  
**When** the user opens the Keys & Identities tab  
**Then** the delete button for that key is disabled  
**And** its title reads "The only key in the vault cannot be deleted."  
**And** the background refuses `vault.deleteKey` for it regardless of the UI

---

### Requirement: REQ-MKS-005 - Keyboard Navigation

The system SHALL support full keyboard navigation for the KeySelector component.

**Priority:** High  
**Category:** Accessibility

#### Acceptance Criteria
- Tab key moves focus to the KeySelector trigger
- Enter or Space opens the dropdown when the trigger is focused, placing focus on the first key
- Arrow Up/Down moves through the key list, including the "Add Key" item
- Enter activates the focused item and closes the dropdown
- Escape closes the dropdown without changing the active key, and returns focus to the trigger
- Focus is visible throughout (`focus-visible` ring; `DESIGN_RULES` §11)
- The dropdown is a Radix menu, so focus is contained while it is open and restored to the trigger on close

#### Scenario: Keyboard-only key switching
**Given** the user has 2 keys in their vault  
**And** the KeySelector is closed  
**When** the user presses Tab to focus the trigger  
**And** presses Enter to open the dropdown  
**Then** the dropdown opens with the first key focused  
**When** the user presses Arrow Down  
**Then** the second key is focused (visible focus ring)  
**When** the user presses Enter  
**Then** the second key becomes active  
**And** the dropdown closes

#### Scenario: Escape does not commit the highlighted key
**Given** the dropdown is open with a key other than the active one focused  
**When** the user presses Escape  
**Then** the dropdown closes  
**And** the active key is unchanged  
**And** focus returns to the trigger

---

### Requirement: REQ-MKS-006 - ARIA Attributes

The system SHALL provide proper ARIA attributes for screen reader accessibility. The key selector SHALL be a menu, not a listbox, because it holds an action ("Add Key") beside the keys and a listbox may contain only options.

**Priority:** High  
**Category:** Accessibility

#### Acceptance Criteria
- KeySelector dropdown has `role="menu"` and `aria-label="Available keys"`
- Each key item has `role="menuitemradio"`
- Active key has `aria-checked="true"` and every other key `aria-checked="false"`
- Trigger has `aria-label="Select active key"` and `aria-haspopup="menu"`
- "Add Key" item has `role="menuitem"` and `aria-label="Add new key"`
- Each key item carries ONE composed `aria-label` — display name, truncated npub, and "(currently selected)" on the active key. `aria-describedby` is NOT used for the npub
- Dropdown state communicated via `aria-expanded`
- The trigger is wrapped in an `<h2>` that points `aria-labelledby` at the key's name, so the screen's heading is the active key's name rather than "Select active key"
- Decorative icons (chevron, check, plus) are `aria-hidden`

#### Scenario: Screen reader announces key selection
- **GIVEN** a screen reader user navigates to KeySelector
- **WHEN** the trigger receives focus
- **THEN** the screen reader announces "Select active key, button, collapsed"
- **WHEN** the user activates the trigger
- **THEN** the menu is announced as expanded
- **WHEN** the user navigates to the second key
- **THEN** that item is announced with its display name and truncated npub, as a radio menu item that is not checked

#### Scenario: Every child of the menu is a legal menu child
- **GIVEN** the dropdown is open and the host supplies an "Add Key" action
- **WHEN** the page is checked with axe
- **THEN** no `aria-required-children` or `aria-required-parent` violation SHALL be reported for the dropdown

### Requirement: REQ-MKS-007 - Loading and Error States

The system SHALL provide clear loading and error states for async operations.

**Priority:** Medium  
**Category:** UX

#### Acceptance Criteria
- While a key switch is in flight the trigger is disabled and shows a wait cursor at reduced opacity, and a second switch cannot be started
- Seal avatars render synchronously, so there is no avatar loading state
- A failed profile fetch degrades to the key's label with no error UI
- Add-key errors are shown inline in the dialog
- A failed key switch is written to the console only. The extension ships no toast system, so there is no user-visible error for it

> Known gap: a failed switch is silent to the user beyond the key not changing.
> Any fix needs a notification surface, which does not exist yet.

#### Scenario: Key switching with slow RPC
**Given** the user clicks a different key in the selector  
**And** the `selectKey` RPC call is slow  
**Then** the trigger is disabled and shows a wait cursor  
**And** a further switch cannot be started until it settles  
**When** the RPC completes successfully  
**Then** the new key is active  
**And** the dropdown closes

#### Scenario: Key switch fails
**Given** the `selectKey` RPC rejects  
**When** the switch settles  
**Then** the active key is unchanged  
**And** the dropdown remains open  
**And** the trigger is re-enabled

#### Scenario: Profile fetch failure
**Given** the user has 3 keys  
**And** one key's profile metadata fetch fails (network error)  
**When** the KeySelector renders  
**Then** the failed key shows its seal avatar as usual  
**And** the failed key shows its label as primary text  
**And** no error message is displayed (graceful degradation)  
**And** the user can still select that key normally

---

### Requirement: REQ-MKS-008 - Visual Design and Theming

The system SHALL provide consistent visual design that works in both light and dark themes.

**Priority:** Medium  
**Category:** UI/UX

`docs/design/DESIGN_RULES.md` is binding here; where it and this requirement
disagree, DESIGN_RULES wins.

#### Acceptance Criteria
- Hover states for all interactive elements
- Visible focus indicators, drawn with the ring token — violet, not blue (`DESIGN_RULES` §7)
- Colors come from the CSS variables in `src/assets/tailwind.css`. NO hex values in components (`DESIGN_RULES` §3, §12)
- Color contrast meets WCAG AA (4.5:1 for text, 3:1 for UI). `--ink-3` is held to 3:1 and is never used for information (`DESIGN_RULES` §11)
- Transitions are 120–160ms with `--ease-out`; no bounce, shimmer or infinite loops (`DESIGN_RULES` §11)
- The dropdown is an overlay, so it is one of the few surfaces allowed a shadow (`DESIGN_RULES` §2, §7)
- Active key has a checkmark icon in the violet accent
- Avatars use the seal shape (`DESIGN_RULES` §5)
- Both themes are supported: light, and the dark "Deep Ink" variant. Dark is not an inversion — it is its own token set

#### Scenario: Dark theme rendering
**Given** the user has the dark ("Deep Ink") theme applied  
**When** the KeySelector renders  
**Then** every surface, text and accent colour resolves from the theme's tokens  
**And** no component supplies a literal colour value  
**And** all text the user must read meets 4.5:1 contrast

---

### Requirement: REQ-MKS-009 - Performance Requirements

The system SHALL render the key list and handle interactions with minimal latency.

**Priority:** Medium  
**Category:** Performance

#### Acceptance Criteria
- Key list renders in <100ms for up to 10 keys
- Key switching completes in <500ms (excluding network)
- Profile metadata for all keys is requested in parallel, and one failure does not sink the rest
- `KeySelector` is wrapped in `React.memo` to prevent unnecessary re-renders
- The header image is a stored `data:` copy read from the background, so no remote image is loaded and no image lazy-loading is required
- Dropdown open/close animation is smooth

#### Scenario: Fast rendering with multiple keys
**Given** the user has 10 keys in their vault  
**When** the user opens the KeySelector dropdown  
**Then** all 10 keys render within 100ms  
**And** no jank or lag is visible  
**And** scrolling is smooth (60fps)

### Requirement: REQ-MKS-010 - Delete Key Safety

The system SHALL protect users from accidental or unauthorised key deletion by
re-verifying the vault password and by refusing to delete the last key.

**Priority:** High  
**Category:** Security/UX

#### Acceptance Criteria
- Deletion requires the vault password, re-verified in the BACKGROUND. An unlocked vault is not sufficient authority
- The re-authentication dialog names the key and states the consequence: if the key is not backed up, the identity is gone for good
- There is no separate native confirmation in front of the password dialog; the password prompt IS the confirmation step
- The last remaining key cannot be deleted — the button is disabled AND the background refuses the request
- If the active key is deleted, the first remaining key is selected afterwards
- The key's unlocked in-memory material is zeroized
- Deletion is NOT recorded in the activity log; that log covers signing and identity-disclosure decisions only

#### Scenario: Delete with re-authentication
**Given** the user has 2 keys (Alice active, Bob)  
**When** the user activates delete on Bob's key on the Keys & Identities tab  
**Then** a re-authentication dialog appears naming Bob's key and its consequence  
**When** the user cancels  
**Then** the dialog closes and Bob's key is not deleted  
**When** the user activates delete again and enters the correct vault password  
**Then** Bob's key is permanently deleted  
**And** the response does not echo the password  
**And** the password is not remembered for the next action

#### Scenario: Delete active key promotes another
**Given** the user has 2 keys (Alice active, Bob)  
**When** the user deletes Alice's key with a verified password  
**Then** Alice's record is removed first  
**And** the first remaining key (Bob) is then selected  
**And** the response reports Bob's id as the new selected key

#### Scenario: Deleting the session's only unlocked key
**Given** a key was added during this session, so the vault holds two records but only one key's unlocked material  
**When** the user deletes the key whose material is unlocked  
**Then** the deletion succeeds  
**And** the vault locks, requiring the user to unlock again

> Defect, pinned deliberately by `tests/e2e/multi-key-selector.spec.ts`: emptying
> the unlocked map reads to `getLockState` as an evicted worker. The deletion is
> not lost, but the lock is not intended behaviour.

