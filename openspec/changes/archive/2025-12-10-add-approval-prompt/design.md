## Context

When a dApp requests signing and policy evaluates to `ask`, the user needs to make a real-time decision. This requires showing a prompt with request details, capturing user input, and returning the result to the waiting dApp.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  dApp calls window.nostr.signEvent(event)                       │
└─────────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Content Script → Background (nostr.signEvent RPC)              │
│  policy.evaluate() returns { mode: "ask" }                      │
└─────────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Background Script                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  PendingRequestQueue                                     │   │
│  │  - Stores request with unique ID                         │   │
│  │  - Opens approval popup with request ID                  │   │
│  │  - Waits for user decision (Promise)                     │   │
│  │  - Timeout after 60s → auto-deny                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                     │ browser.windows.create / browser.action.openPopup
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Approval Popup (approval.html)                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ApprovalPrompt Component                                │   │
│  │  - Fetches pending request via RPC                       │   │
│  │  - Displays: origin, event kind, content preview         │   │
│  │  - Actions: Allow, Allow Once, Deny, Deny + Remember     │   │
│  │  - Sends decision via RPC → background resolves Promise  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Request Flow

1. **dApp calls `signEvent`** → content script → background
2. **Policy evaluates to `ask`** → create PendingRequest with unique ID
3. **Open approval popup** with request ID in URL/query param
4. **Popup loads**, fetches request details via `approval.getRequest` RPC
5. **User sees details**: origin favicon, domain, event kind name, content preview
6. **User clicks action button**:
   - "Allow" → sign and return event, no policy change
   - "Allow Once" → same as Allow (alias for clarity)
   - "Deny" → reject with "denied", no policy change
   - "Deny + Remember" → reject with "denied", add deny rule for origin+kind
7. **Background receives decision** via `approval.resolve` RPC
8. **Promise resolves/rejects** → response flows back to dApp
9. **Popup closes**

## Goals / Non-Goals

### Goals
- Show approval prompt when policy evaluates to `ask`
- Display origin, event kind (with name), and content preview
- Provide Allow, Allow Once, Deny, Deny + Remember actions
- Update policy rules when "Remember" actions are used
- Timeout with auto-deny after 60 seconds
- Support multiple queued requests (show oldest first)

### Non-Goals
- Batch approval of multiple events (each requires individual decision)
- Rich content rendering (markdown, images) in preview
- Customizable timeout duration (hardcoded for now)
- Approval history/audit log (covered by activity log feature)
- Allow + Remember (creates `allow` rule) - too risky for auto-sign

## Decisions

### Decision 1: Separate approval popup window
Use `browser.windows.create` to open a small popup window rather than injecting UI into the page or using the extension popup.

**Rationale:**
- Isolated from page context (security)
- Can't be hidden or obscured by page
- Consistent UI regardless of dApp styling
- Works even if user closes main popup

**Alternatives considered:**
- In-page overlay: Security risk, can be obscured
- Extension popup: Conflicts with existing popup, can be closed accidentally
- Browser notification: Limited interactivity, can't show event details

### Decision 2: Allow Once vs Allow (same behavior)
Both "Allow" and "Allow Once" perform the same action (sign without policy change). Two buttons provide clarity for users expecting "remember" behavior.

**Rationale:**
- Users from other signers expect "Allow Once" option
- Prevents confusion about what "Allow" does
- Future flexibility to add "Allow + Remember" if desired

### Decision 3: No "Allow + Remember"
We intentionally omit an "Allow + Remember" option that would create a permanent `allow` rule.

**Rationale:**
- Creating permanent allow rules from a popup is risky
- Users should consciously visit settings to enable auto-signing
- "Session Grant" feature already exists for temporary allow-all

### Decision 4: Request queue with FIFO processing
Multiple pending requests are queued and shown one at a time (oldest first).

**Rationale:**
- Prevents overwhelming users with multiple popups
- Clear mental model: one decision at a time
- Queue visible in popup if multiple pending

### Decision 5: 60-second timeout with auto-deny
Requests automatically denied after 60 seconds without user action.

**Rationale:**
- Prevents indefinite hangs in dApps
- Reasonable time for user to read and decide
- Standard timeout used by other signers

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| User closes popup without deciding | Timeout auto-denies; dApp gets clear error |
| Popup blocked by browser | Fall back to extension badge/notification prompting user to click |
| Multiple rapid requests overwhelm user | Queue with single popup; show count in header |
| Content preview reveals sensitive data | Truncate long content; no image rendering |
| Window creation fails on Firefox | Test cross-browser; use browser.action.openPopup fallback |

## Open Questions

None - design is straightforward and follows established patterns from other Nostr signers.
