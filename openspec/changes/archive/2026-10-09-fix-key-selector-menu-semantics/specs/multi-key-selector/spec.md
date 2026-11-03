## MODIFIED Requirements

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
