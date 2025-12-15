# Proposal: Multi-Key Selector Component

**Change ID:** `add-multi-key-selector`  
**Author:** GitHub Copilot  
**Date:** 2025-01-23  
**Status:** Draft

## Why

Users managing multiple Nostr identities currently face friction when switching between keys or adding new ones. While the backend vault supports multiple keys, the UI provides no intuitive way to:
- Switch between keys without navigating to settings
- Add additional keys after initial onboarding
- Identify keys visually (profile avatars, display names)

This limitation reduces the value of Ostrilo for power users who maintain separate identities for different contexts (work, personal, pseudonymous). By providing a prominent, accessible key selector, we enable seamless multi-identity workflows and better leverage existing profile metadata capabilities.

## Problem Statement

Ostrilo currently supports managing multiple Nostr keys in the vault, but the UI only presents a single active key at a time without an intuitive way to switch between them. Key limitations:

1. **No visual key switcher**: The Header component displays the currently selected key but provides no mechanism to switch to another key without navigating to settings
2. **Single-key onboarding flow**: Onboarding (create/import) only allows one key to be added, forcing users to restart the process or manually navigate settings to add additional keys
3. **Limited key management discoverability**: Users cannot easily add additional keys from within the main UI - must navigate to settings and find the appropriate action
4. **No profile-aware key display**: The Header shows truncated public keys without leveraging available profile metadata (avatar, display name) from the add-profile-metadata-management capability

This creates friction for users who manage multiple Nostr identities (e.g., personal, work, pseudonymous) and limits the value of the existing multi-key infrastructure.

## Proposed Solution

Transform the Header component's key display into a **reusable Multi-Key Selector component** that provides:

1. **Dropdown/Popover Key Switcher**
   - Click current key to reveal list of all available keys
   - Display each key with avatar (profile picture if available, else placeholder) and display name/label
   - Switch active key with single click
   - Persist selection via existing `selectKey` RPC method

2. **Inline Add Key Action**
   - "Add Key" button/option within the selector dropdown
   - Opens modal/dialog for Create or Import flow (reusing existing components)
   - After successful creation/import, automatically selects the new key

3. **Profile-Aware Key Presentation**
   - Integrate profile metadata from add-profile-metadata-management
   - Show profile avatar when available, else fallback to generated avatar or icon
   - Display profile displayName/name when available, else key label, else truncated npub

4. **Settings Page Integration**
   - Add dedicated "Keys & Identities" section to SettingsView
   - List all keys with ability to rename labels, delete keys (with confirmation)
   - Link to selector component for consistent UX

## Scope

### In Scope
- Multi-key selector UI component with dropdown/popover pattern
- Profile metadata integration (avatar, display name) for key display
- Inline "Add Key" action within selector
- Modal/dialog flows for Create Key and Import Key (reuse existing onboarding components)
- Settings page "Keys & Identities" management section
- Key rename/delete operations
- Automatic selection of newly created/imported keys
- Accessibility: keyboard navigation, ARIA labels, screen reader support

### Out of Scope
- Changes to vault encryption or key storage (use existing KeyVaultService)
- Changes to RPC protocol (use existing selectKey, generateKey, importKey, deleteKey methods)
- NIP-07 provider modifications (selector only affects UI state)
- Backup/restore flows for keys (separate future capability)
- Key export functionality (security-sensitive, requires separate proposal)
- Multi-device key sync (requires relay/NIP-46, future enhancement)

## Success Criteria

1. **Key Switching**: Users can switch between multiple keys with ≤2 clicks from any page
2. **Add Key Flow**: Users can add additional keys without leaving the main UI context
3. **Profile Display**: All key presentations show profile avatars/names when available
4. **Settings Management**: Users can view all keys, rename labels, and delete keys from settings
5. **Accessibility**: Component passes WCAG 2.1 AA compliance (keyboard nav, focus management, ARIA)
6. **Performance**: Key list renders with <100ms latency for up to 10 keys
7. **Zero Breaking Changes**: No changes to existing RPC contracts or storage schemas

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Key deletion without backup destroys data | **High** | Require explicit confirmation modal with warning text; future: backup flow before delete |
| Profile metadata fetch delays selector rendering | **Medium** | Use cached metadata from add-profile-metadata-management; show key label immediately while avatar loads |
| Dropdown z-index conflicts with modals | **Low** | Use Radix UI Popover/DropdownMenu with portal pattern; test against existing modals |
| Keyboard navigation complexity | **Medium** | Use Radix UI primitives (built-in a11y); test with screen readers |
| Too many keys degrades UX | **Low** | Initially support 1-10 keys; add search/filter if >10 becomes common; document recommended limits |

## Dependencies

- **add-profile-metadata-management**: Uses ProfileCacheService for avatar/displayName
- **Existing RPC methods**: selectKey, generateKey, importKey, deleteKey (all implemented)
- **Radix UI Primitives**: DropdownMenu or Popover for selector, Dialog for add/delete modals
- **shadcn/ui components**: Button, Avatar, Label, Input (already available)

## Open Questions

1. **Should the selector show key count badge?** (e.g., "3 keys" indicator) No.
2. **How should we handle key deletion if it's the last key?**  force logout, return to the onboarding flow
3. **Should "Add Key" action be always visible or only when <N keys?** in the settings page yes.
4. **Should Settings page allow reordering keys?** (for display order in selector) Yes
5. **Should we support key grouping/tagging?** (e.g., "Work", "Personal" labels) Tagging.

## Next Steps

1. Review and approve this proposal
2. Create `tasks.md` with implementation checklist
3. Create `design.md` with component architecture and wire frames
4. Create spec deltas for new requirements
5. Validate with `openspec validate add-multi-key-selector --strict`
6. Begin implementation after approval
