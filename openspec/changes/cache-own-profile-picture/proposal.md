## Why

The Profile view shows a picture URL as text and the header shows a local seal, so a user who sets a profile picture never sees it in Ostrilo (OSTR 02). The seal was deliberate: a profile `picture` URL is chosen by whoever wrote the profile, and the header is the surface on which the user confirms which identity is about to sign, so loading the image there would tell that host the user's IP address every time the popup opened, an approval window appeared, or a key was selected. The recorded policy is that extension pages never load a remote image.

The owner decided on 2026-10-09 to honour the user's expectation without giving that up: Ostrilo loads the user's own picture once, when they save or explicitly refresh their profile, keeps a small local copy per public key, and the header renders only that copy.

## What Changes

- **The Profile page loads the picture, once, on an explicit action.** After a successful profile save with a non-empty `picture`, and when the user presses a new **Refresh picture** control, the page loads the URL in an `<img>` with `crossOrigin="anonymous"` and `referrerPolicy="no-referrer"`. Only `https:` URLs (the existing allowlist), a 10 second timeout, and no image over 4096 by 4096 pixels. It draws a centre-cropped square to a 96 by 96 canvas and encodes it as `image/webp`, falling back to `image/png`.
- **A failure keeps the seal.** A host that blocks cross-origin reads, a failed or slow load, an oversize image or an encoding failure leaves the header on the seal and puts a short note on the Profile view. Nothing retries in the background.
- **The background stores the copy and never fetches.** A new UI-only, lock-gated `avatar` RPC namespace (`avatar.get`, `avatar.save`, `avatar.remove`) validates the request and keeps a non-secret `storage.local` record keyed by public key: the `data:` image (webp or png, at most 64 KiB, bytes checked against the declared type), the source URL and a timestamp. At most one entry per key; a save drops entries for keys the vault no longer holds.
- **Clearing or deleting.** A profile save with no picture removes the copy. Deleting a key removes its copy, last and best effort, after the key is zeroized and the selection repaired.
- **The header shows the selected key's copy.** The trigger renders the `data:` image at a fixed 28px with the display name as alternative text, and the seal when there is no copy. It never shows another key's copy, not even for a render. Dropdown rows and the settings key list stay seals. Saving or refreshing updates the header through a broadcast, without reloading the extension.
- **Policy and docs.** `remote-media-policy`, `profile-metadata` and `multi-key-selector` change from "no image is ever loaded" to "the only remote image load is the Profile page's explicit save or refresh". `PRIVACY.md`, the README privacy paragraph and the key-selector guide say the same.

Not changed: the `https:` allowlist, `connect-src` (no widening), the CSP's `img-src` (`'self' data: https:` already), the profile cache and relay trust model, the outbound upload rules, and the rule that no image request happens on popup open, side panel open, approval surfaces, unlock or key switch.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `remote-media-policy`: the "no relay-chosen media" requirement gains its one exception; adds the own-picture local copy requirement.
- `profile-metadata`: ProfileView offers Refresh picture and makes the copy on save; the URL-sanitization scenario names the same exception.
- `multi-key-selector`: the header shows the selected key's local copy; list rows stay seals; the performance note no longer says no avatar images are loaded.

## Impact

**Code**
- `src/domain/profile/avatar.ts`: the limits, the data-URL check and the validating reader of the stored record.
- `src/application/services/profile-avatar.service.ts`: the record's owner. `KeyVaultService` exposes it as `profileAvatar` and removes a deleted key's copy in `deleteKeyNow`.
- `src/infrastructure/messaging/handlers/avatar-rpc.ts`, `rpc.ts`, `client.ts`, `events.ts`, `validation/schemas.ts`, `src/extension/background.ts`: `avatar.get`, `avatar.save`, `avatar.remove` and the `PROFILE_AVATAR_CHANGED` broadcast.
- `src/ui/lib/avatar-capture.ts` (the one place a remote image is loaded), `src/ui/features/profile/hooks/useProfilePicture.ts`, `ProfileView.tsx`, `ProfileSummary.tsx`.
- `src/ui/hooks/useOwnAvatar.ts`, `src/ui/components/common/OwnAvatarImage.tsx`, `src/ui/components/layout/KeySelector.tsx`.

**Storage:** one new `storage.local` item, `profileAvatar`, holding images, source URLs and times. No secret, no new permission, no dependency.

**Network:** one image request per profile save that carries a picture and one per press of Refresh picture, from the Profile page, to the host named in the user's own profile. No request from the background, the header, the approval surfaces, unlock or key switch.

**Behaviour users will notice:** the header shows their picture after they save or refresh it; the Profile view has a Refresh picture control and a note explaining when the picture loads.
