## Why

Phase 0.10 (UX-011) runs axe over every surface. It reports the header key selector as two `critical` violations: a `role="listbox"` may contain only options, and this one also holds a separator and the "Add Key" action (`aria-required-children`), and that action is a `menuitem` with no menu around it (`aria-required-parent`). The selector is a menu in all but name: it ends in an action, and Radix already gives its content `role="menu"`. REQ-MKS-006 specified a listbox, so the code cannot be brought in line without changing the requirement.

## What Changes

- **The key selector is a menu.** The dropdown keeps Radix's `role="menu"` and its `aria-label="Available keys"`; each key row is `role="menuitemradio"` with `aria-checked`, and "Add Key" stays a `menuitem`. The trigger carries Radix's `aria-haspopup="menu"` and `aria-expanded`, and no `aria-controls` to a fixed id.
- **Nothing else about the selector changes**: the composed `aria-label` on each row (display name, truncated npub, "(currently selected)"), the `<h2>` around the trigger, keyboard navigation, and the decorative icons stay as specified.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `multi-key-selector`: REQ-MKS-006 (ARIA Attributes) names menu semantics instead of listbox semantics.

## Impact

**Code:** `src/ui/components/layout/KeySelector.tsx`.

**Tests:** `tests/unit/ui/components/key-selector.test.tsx`, `tests/e2e/multi-key-selector.spec.ts`, `tests/e2e/profile-avatar.spec.ts`, `tests/e2e/profile-view.spec.ts` (role names), and `tests/e2e/accessibility.spec.ts`, which would fail on the old markup.

**Docs:** `docs/multi-key-management-developer-guide.md`, `docs/design-review/capture-screenshots.mjs`.

**Behaviour users will notice:** none visually. Screen readers announce a menu with one checked item instead of a list box with one selected option.
