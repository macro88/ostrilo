## Why

Users who trust a Nostr client such as `primal.net` should not be repeatedly prompted for the same low-risk event kinds after they choose to remember that decision. Today the approval UI can imply "always allow this kind for this site", but the allow decision is not persisted as a per-origin kind rule, so users keep seeing repeat signing prompts and the saved policy does not clearly appear in settings.

This change turns remembered approval into a real user-facing permission workflow: one deliberate decision creates a visible, durable site policy for unprotected event kinds, and future matching requests sign without another prompt.

## What Changes

- Persist remembered allow decisions from the approval flow as per-origin, per-kind `allow` rules.
- Keep protected kinds, currently kind `1` and kind `9734`, excluded from remembered auto-allow.
- Preserve remembered deny behavior and make allow/deny remembered decisions symmetrical where the policy model permits it.
- Make approval copy explicit about the scope of the remember choice: this site, this event kind, future matching requests.
- Ensure remembered policies appear in the settings permissions surface immediately after the decision.
- Expand common event-kind labels and quick policy controls for settings/profile/app-data kinds that Nostr clients commonly request.
- Add E2E coverage for the actual user value loop: first request prompts, remember allow is chosen, second matching request auto-signs, and settings shows the saved rule.

No remote trust directory, global trust override, official badges, or NIP-78 sync ships in this change.

## Capabilities

### New Capabilities

- `site-signing-policies`: Durable per-site signing permissions created from approval decisions and managed in settings.

### Modified Capabilities

- None.

## Impact

- Approval RPC handling: `approval.resolve` must persist remembered allow rules before resolving eligible requests.
- Approval UI: copy and action mapping must make the remember scope unambiguous and prevent protected-kind allow persistence.
- Policy evaluation: existing explicit per-kind allow rules should continue to auto-sign only unprotected kinds.
- Settings UI: origin policies should show remembered rules without requiring a reload and should include common client event kinds beyond the current small quick-rule set.
- Tests: update unit/integration coverage for remembered allow, protected-kind exclusion, settings sync, and E2E repeat-signing behavior.
- PRD: add a first-class Durable Per-Site Signing Permissions requirement so this user value is tracked directly.
