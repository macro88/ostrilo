# Proposal: Add Options Page UI

## Status

- **Created:** 2025-12-18
- **Status:** Draft
- **Author:** AI Assistant
- **Approver:** TBD

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
6. **Enable Settings Sync:** Allow non-sensitive settings to sync across devices via Nostr events (NIP-78)
7. **Security by Design:** Follow hexagonal architecture, never sync sensitive data (keys, passwords, origins)

## Non-Goals

1. **Not** removing settings from popup entirely (keep basic settings accessible)
2. **Not** creating multiple options pages (single page with tabs only)
3. **Not** syncing sensitive data (private keys, passwords, per-origin policies)
4. **Not** implementing automatic conflict resolution (last-write-wins only)
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
- New SettingsSyncService following hexagonal architecture
- NIP-78 (Arbitrary Custom App Data) for settings publishing
- Relay access for settings fetch/publish (non-blocking)

## Risks and Mitigations

| Risk                                        | Impact   | Mitigation                                                                |
| ------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| Code duplication between popup and options  | Medium   | Extract shared components to `src/ui/features/settings/components/`       |
| State sync issues between popup and options | High     | Use shared hooks and chrome.storage.onChanged events                      |
| Broken settings mutations                   | Critical | Comprehensive E2E tests for all settings changes                          |
| Popup becomes too minimal                   | Low      | Iterate based on user feedback; keep essentials                           |
| Options page too complex                    | Medium   | Use clear tab navigation and grouping                                     |
| Accidental sync of sensitive data           | Critical | Strict allowlist of syncable fields, never include keys/origins/passwords |
| Relay fetch failures blocking UI            | Medium   | Non-blocking sync with timeout, graceful degradation                      |
| Settings conflict across devices            | Medium   | Last-write-wins with timestamp, show conflict indicator in UI             |

## Open Questions

1. Should we add a settings search feature in the options page? **Yes** - Defer to Phase 2
2. Should the popup have a "Quick Settings" mode with only 3-4 most common settings? **Yes** - BasicSettings component
3. Should we add keyboard shortcuts to open options page? **No** - Not in v1
4. Should the options page have a "Restore Defaults" button per tab or only global? **Global** - Single reset action
5. Should sync be opt-in or automatic? **Opt-in** - User must explicitly enable sync in Settings
6. Should we show sync status (last synced timestamp)? **Yes** - Display in Options page footer
7. Should we allow manual "Sync Now" action? **Yes** - Button in General tab

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
