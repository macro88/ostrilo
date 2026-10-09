## Context

`remote-media-policy` says privileged extension pages never load a relay-chosen image, and `KeySelector` renders a local seal "by design", with tests that fail on any `<img>` or `AvatarImage` in the identity surfaces. OSTR 02 asks for the saved avatar in the top bar and says the exact fetch, refresh, storage and consent policy needs a product and security decision before implementation. That decision was made.

### The owner's decision (2026-10-09)

Local copy on save. When the user saves or explicitly refreshes their profile, Ostrilo loads their own picture URL once, downsizes it to a small local image and stores it per public key. The header renders only that local copy: no network request on popup open, approval surfaces, or key switch. Hosts that block cross-origin reads fall back to the existing seal.

### What is changed, and what stands

| Recorded position | This change |
| --- | --- |
| No extension page makes a request to a relay-chosen host while rendering. | **Narrowed to one exception.** The Profile page makes one request when the user saves a profile with a picture or presses Refresh picture. Rendering anything still makes none. |
| The header and key lists show the seal, never a picture. | **Header changed.** The header trigger shows the selected key's local copy. The dropdown rows and the settings key list stay seals. |
| A picture URL is shown as text and opened only in an ordinary tab. | **Stands.** |
| `https:` is the only accepted scheme, checked at validation and again at the render boundary. | **Stands**, and is checked a third time before the load. |
| `connect-src` carries no image host. | **Stands.** The load is an image element, covered by `img-src https:`, which was already declared. |

## Goals / Non-Goals

**Goals**

- The user's saved picture appears in the header, in both themes, in a fixed box, without reloading the extension.
- The only remote image load is the Profile page's, and it is explicit and once.
- The header never shows another identity's picture, not even for one frame.
- A bounded, validated, non-secret record that cannot grow past the vault.

**Non-Goals**

- Showing other people's pictures anywhere. This is the user's own picture only.
- Showing the picture on the dropdown rows, the settings key list or the approval windows.
- Refreshing the copy automatically, on a timer, on unlock or when the profile changes elsewhere.
- Previewing a URL in the editor, or an upload flow. The upload rules are unchanged.

## Decisions

### Decision 1: Not "load the picture every time"

The alternative is to point the header's `<img>` at `profile.picture` and let the browser cache it. Rejected, for reasons that are the policy's own:

- **It is a request on every surface.** The popup, the side panel and the approval window each render the header. An approval window opens because a site asked to sign, so each signing request would send a request to the image host, at a moment a third party chose. A page cannot make the extension fetch anything today; this would give it a timing signal.
- **The host learns when the user is active.** Each request carries the user's IP address and, with the browser cache cold or revalidating, a time. The user can reasonably accept that once, when they press Save, and not on every unlock.
- **The URL is data from a relay.** For the user's own profile it is signature-checked, but a cached profile written before verification existed, or a value that failed the allowlist, can still sit in storage. A load-every-time header turns any such value into a request.
- **It cannot be bounded.** The page decides the size, the type and the time a remote image takes. A local copy is fixed at 96 by 96, 64 KiB and a type the extension chose, whatever the host sent.

A local copy turns a standing exposure into a single, user-initiated one, and makes the header's rendering a pure function of stored data.

### Decision 2: The Profile page loads; the background stores

Decoding an image and drawing a canvas need a DOM. A service worker has `createImageBitmap` and `OffscreenCanvas`, but it would then be a network client for a host named in profile data, with a keepalive that already runs while unlocked. The page does the load, the background does the storing, and the background has no code that fetches a picture (asserted: the handler and service make no request, and there is no `avatar.fetch`).

The page hands the background an encoded `data:` URL through `avatar.save`. The background does not trust the page: it re-checks the public key (64 lowercase hex, and a key the vault holds), the source URL (`https:`) and the image (type, size, and the first bytes against the declared format). A compromised extension page could already do more through other RPCs; the checks are there so a bug in the capture code cannot store something the header would then render.

### Decision 3: A separate, non-secret `storage.local` item, keyed by public key

Not in the profile cache. The profile cache is relay-derived, expires after an hour, lives in `storage.session` and is bounded to 256 KB for 50 entries; a picture the user chose to keep must not expire with it or count against that budget. Not in the vault envelope or key records: it is not secret, and writing it must never rewrite a key. The same reasoning as `keyBackupStatus`, whose service and record shape this follows (versioned record, validating reader that drops malformed entries, serialised read-modify-write).

Keyed by public key rather than key id because the picture belongs to the identity the profile is published under, and it is what the header's lookup has in hand. The vault refuses two keys with one public key, so the two are one-to-one. `avatar.save` refuses a public key the vault does not hold and prunes entries for keys it no longer holds, so the record is bounded by the vault: at most one entry per vault key.

### Decision 4: What "explicit" means, and failure

"Saving the profile with a picture URL" is a successful `profile.update` whose `picture` is non-empty. It runs on every such save, including a save that changed only the bio: the user pressed Save, and the picture may have changed on the host. A save that clears the picture removes the copy. The load is started from the save handler and the Refresh control only, never from an effect, a timer or a broadcast; a source scan in `remote-media-policy.test.tsx` pins the call sites.

A failure keeps the seal and says so on the Profile view, in the place the user acted. It is never retried. The one judgement call is a copy that already exists: a failure to refresh the same URL keeps the old copy (a transient failure is not evidence the old copy is wrong), and a failure for a different URL removes it (it would show a picture the user has replaced).

Notes: a host that blocks cross-origin reads gets the owner's sentence, "This image host doesn't allow Ostrilo to keep a copy." A browser reports a CORS refusal on a `crossorigin` image as a plain load error, and a 404 or a DNS failure is the same event, so the page cannot tell them apart and the sentence covers both. A second, uncredentialed load to find out would be a second request, which the policy forbids. Timeout, oversize, a non-`https:` URL and an encoding failure each have their own short note.

### Decision 5: The header cannot show the wrong identity

`useOwnAvatar(pubkey)` remembers which key its last read was for and returns a copy only when that key is the one asked about, and only when the row's own public key matches. A switch therefore renders the seal until the new key's read lands, never the previous image. A late answer for a key that is no longer selected is ignored. The element that renders the image re-checks that its source is a stored `data:` URL, and sits over the seal fallback, so a copy that fails to decode leaves the seal showing. A broadcast (`PROFILE_AVATAR_CHANGED`) from the background after a save or removal makes every open surface read again; this is the same shared-invalidation pattern as `KEY_BACKUP_CHANGED`.

### Decision 6: The platform may be more permissive than the fallback assumes

In the Chromium the e2e suite runs, an extension page whose manifest declares `https://*/*` content-script matches loaded an image from a host that sent no CORS headers and read it back, so a canvas was not tainted. That is the platform being generous, not the extension: the code still requests the image anonymously and still handles both a load error and a tainted canvas, and the tainted path is covered by unit tests with a forced `SecurityError`. It is recorded here because it means the "host blocks cross-origin reads" fallback is, today, mostly exercised by hosts that fail to load at all, and because a browser that does not extend content-script patterns to extension pages (Firefox) will exercise it for real.

### Decision 7: Alternatives considered

- **Fetch the image in the background with `fetch`.** Rejected: needs `connect-src` widened to every `https:` host, which the manifest policy forbids and which would let the worker, not a page element, reach arbitrary hosts.
- **Let the user pick a local file instead.** Out of scope; a good future option that would need no network.
- **Store the original bytes.** Rejected: unbounded size and type; the 96 by 96 re-encode is what makes the stored image safe to render.
- **Show the picture on every key row.** Rejected for this change: it multiplies loads (one per key) and the header is what OSTR 02 asks for.

## Risks / Trade-offs

- **One request still reveals the user's IP and a time to the image host**, at their own action. This is disclosed in the Profile view, in `PRIVACY.md` and in the README.
- **A save closed before the load finishes makes no copy.** The popup closing cancels the page's work. The user can press Refresh picture; nothing is half-written, because the store happens only after a complete encode.
- **A host that serves different content later is not noticed.** The copy is a snapshot until the next save or refresh.
- **Re-encoding discards animation and colour profile.** Intended: a still 96 by 96 mark is what the header needs.
