# Proposal: Add Options Page UI

## Status

- **Created:** 2025-12-18
- **Status:** Implemented core UI; hardening and documentation remaining
- **Author:** AI Assistant
- **Approver:** TBD

## 2026-06-11 Review Status

Current code already includes the options page entrypoint, `OptionsApp`, `BasicSettings`, shared settings components, Inkline-era styling, and popup-to-options navigation. This proposal is no longer a greenfield feature proposal.

Development readiness: ready only for the remaining hardening slice: tests, accessibility review, documentation, cleanup of the legacy `SettingsView`, and Chrome/Firefox validation. Do not use this change to implement NIP-78 cross-device settings sync; that work should be split into its own proposal because it adds relay/network behavior, signing semantics, and privacy review beyond the options page UI.

Current implementation anchors:

- `src/extension/options/OptionsApp.tsx`
- `src/ui/features/settings/components/BasicSettings.tsx`
- `src/ui/features/settings/components/*Tab.tsx`
- `src/ui/features/settings/components/shared/`
- `wxt.config.ts` options page manifest configuration

## Problem Statement

The current Settings UI is embedded within the popup/sidepanel and contains an increasingly large number of configuration options across multiple sections:

- Keys & Identities management (multi-key selector with profile metadata)
- Display settings (theme, side panel)
- Security settings (auto-lock, session TTL, biometric unlock)
- Activity log configuration
- Relay management
- Medium trust auto-allow kind toggles
- Per-origin policy management
- About/debug information

**Current Pain Points:**

1. **Limited Screen Real Estate:** Popup has constrained dimensions (typically 400x600px max), making long scrollable lists cumbersome
2. **Poor Information Hierarchy:** All settings sections have equal visual weight, making it hard to find specific settings
3. **Growing Complexity:** As new features are added (trust level system, profile metadata, multi-key management), the settings become overwhelming
4. **No Grouping by Importance:** Basic settings (theme, auto-lock) are mixed with advanced settings (per-origin policies, medium trust kinds)
5. **Difficult Navigation:** Users must scroll through entire settings page to reach advanced options

## Proposed Solution

Implement a dedicated **Options Page** that opens in a new browser tab using `browser.runtime.openOptionsPage()`. This is a standard browser extension pattern that provides:

- **Full-page UI** with more space for complex settings layouts
- **Multi-tab navigation** for logical grouping of settings
- **Better UX** for power users configuring advanced features
- **Separation of concerns** between basic (popup) and advanced (options) settings

### User Experience

**Popup Settings (Basic):**

- Active Key selector
- Theme toggle
- Auto-lock slider
- "Advanced Settings" button → opens Options page

**Options Page (Advanced):**

- **General Tab:** Theme, side panel, language (future)
- **Keys & Identities Tab:** Multi-key management, rename/delete, import/export
- **Security Tab:** Auto-lock, session TTL, biometric unlock, password change
- **Permissions Tab:** Per-origin policies, trust levels, per-kind rules
- **Activity Tab:** Log retention, export/clear functionality
- **Relays Tab:** Relay list management, connection status
- **Advanced Tab:** Medium trust kinds, experimental features, debug info

### Technical Approach

1. Create new WXT entrypoint at `src/extension/options/`
2. Build full-page React app with tabbed navigation
3. Reuse existing hooks (`useAppSettings`, `useKeyManager`)
4. Extract SettingsView sections into reusable components
5. Add "Advanced Settings" button to popup that calls `browser.runtime.openOptionsPage()`
6. Keep basic settings in popup for quick access

## Goals

1. **Improve UX:** Provide spacious, organized interface for settings management
2. **Maintain Quick Access:** Keep basic settings in popup for convenience
3. **Enable Scalability:** Support future settings additions without popup bloat
4. **Follow Standards:** Use browser.runtime.openOptionsPage() per WebExtension best practices
5. **Code Reusability:** Extract shared components between popup and options page
6. **Security by Design:** Follow hexagonal architecture and keep sensitive data local

## Non-Goals

1. **Not** removing settings from popup entirely (keep basic settings accessible)
2. **Not** creating multiple options pages (single page with tabs only)
3. **Not** syncing sensitive data (private keys, passwords, per-origin policies)
4. **Not** implementing NIP-78 cross-device settings sync in this change
5. **Not** requiring relay connection for local-only usage

## Success Metrics

1. Users can access advanced settings in < 2 clicks from popup
2. Options page loads within 500ms on first open
3. All existing settings functionality preserved
4. Options page responsive across common desktop resolutions (1280x720 to 4K)
5. Zero regression in existing settings mutations/persistence

## Dependencies

- WXT entrypoint configuration for options page
- Shared UI components between popup and options
- SettingsService (existing) for local storage operations
- Current Inkline design rules in `docs/design/DESIGN_RULES.md`
- Existing WXT options page support and shared settings hooks

## Risks and Mitigations

| Risk                                        | Impact   | Mitigation                                                                |
| ------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| Code duplication between popup and options  | Medium   | Extract shared components to `src/ui/features/settings/components/`       |
| State sync issues between popup and options | High     | Use shared hooks and chrome.storage.onChanged events                      |
| Broken settings mutations                   | Critical | Comprehensive E2E tests for all settings changes                          |
| Popup becomes too minimal                   | Low      | Iterate based on user feedback; keep essentials                           |
| Options page too complex                    | Medium   | Use clear tab navigation and grouping                                     |
| Legacy SettingsView drift                   | Medium   | Delete it or mark as deprecated once Options/BasicSettings coverage is complete |
| Missing E2E coverage for options workflows  | Medium   | Add Playwright coverage for popup -> options, tab navigation, and settings persistence |

## Open Questions

1. Should we add a settings search feature in the options page? **Yes** - Defer to Phase 2
2. Should the popup have a "Quick Settings" mode with only 3-4 most common settings? **Yes** - BasicSettings component
3. Should we add keyboard shortcuts to open options page? **No** - Not in v1
4. Should the options page have a "Restore Defaults" button per tab or only global? **Global** - Single reset action
5. Should NIP-78 settings sync be included here? **No** - Split into a future proposal
6. Should the legacy `SettingsView.tsx` be removed? **Yes, after tests prove no active references remain**
7. Should Playwright cover cross-context settings updates? **Yes** - Add targeted coverage before archiving

## Alternatives Considered

1. **Expand Popup Size:** Rejected - violates browser extension UX conventions
2. **Modal Overlays in Popup:** Rejected - still limited by popup constraints
3. **Accordion/Collapsible Sections:** Rejected - doesn't scale, still cluttered
4. **Settings Wizard:** Rejected - adds unnecessary steps for power users
5. **Multiple Side Panels:** Rejected - not supported in all browsers

## Related Changes

- May inform future settings features in other proposals
- Complements trust-level-policy-system proposal (provides better UI for trust management)

## References

- Chrome Extensions Options Page: https://developer.chrome.com/docs/extensions/develop/ui/options-page
- Firefox Options Page: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/user_interface/Options_pages
- WXT Entrypoints Documentation: https://wxt.dev/guide/entrypoints.html
- Existing SettingsView: `src/ui/features/settings/components/SettingsView.tsx`
