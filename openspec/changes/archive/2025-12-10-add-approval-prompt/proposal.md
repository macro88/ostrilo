# Change: Add Approval Prompt for NIP-07 Signing Requests

## Why

The `add-nip07-provider` proposal returns an error when policy evaluates to `ask`, forcing users to pre-configure trust settings before signing works. This creates friction: users must navigate to settings, find the origin, and adjust trust levels before interacting with dApps. A real-time approval prompt lets users make decisions in context, improving both UX and security by showing exactly what's being signed.

## What Changes

- **Pending request queue**: Background maintains queue of requests awaiting user approval
- **Approval prompt UI**: New popup/notification window showing signing request details
- **Request details display**: Show origin, event kind, content preview, key being used
- **User actions**: Allow, Allow Once, Deny, Deny + Remember
- **Policy updates**: "Remember" actions update per-origin per-kind rules automatically
- **Timeout handling**: Auto-deny after configurable timeout (default 60s)
- **MODIFIED behavior**: Policy `ask` now shows prompt instead of returning error

## Impact

- **Depends on**: `add-nip07-provider` (must be implemented first)
- **Affected specs**: Modifies `nip07-provider/spec.md` requirement "Sign Event"
- **Affected code**:
  - `src/extension/background.ts` - Pending request queue, prompt trigger
  - `src/infrastructure/messaging/handlers/nostr-rpc.ts` - Queue integration
  - `src/ui/features/approval/` - New feature folder with prompt UI
  - `src/extension/approval.html` + `approval.tsx` - New popup entrypoint
  - `src/domain/types.ts` - PendingRequest type
  - `wxt.config.ts` - Register approval popup

## Security Considerations

- Prompt shows complete event details to prevent blind signing
- Origin verified from content script, not page-provided
- Request timeout prevents indefinite pending states
- "Deny + Remember" creates explicit deny rule for protection
