# Blossom server vetting

Task group 1 of `add-blossom-profile-image-upload`. Measured on 2026-11-13 from a machine in the US (Apple M4, Node 24.20, Playwright 1.63.0 with its Chromium). Every request used a fresh ephemeral key generated for the probe, never a key from a vault, and a generated 16 by 16 PNG with random colour and a small random text chunk. The probe made no use of the user's identity.

The gate: a server is listed only if it answers over `https:` with CORS headers a page `fetch` can use, accepts an anonymous upload with a kind 24242 token and returns a valid descriptor, takes 5 MiB, and returns a URL that loads as the image. At least two independent operators must qualify.

## Verdict

**Proceed.** Three independent operators qualify.

| Order | `id` | Name | Origin | Operator |
|---|---|---|---|---|
| 1 | `primal` | Primal | `https://blossom.primal.net` | Primal |
| 2 | `nostr-build` | nostr.build | `https://blossom.nostr.build` | nostr.build |
| 3 | `nostrcheck` | nostrcheck.me | `https://cdn.nostrcheck.me` | nostrcheck.me |

Not listed, with the reason:

- **24242.io** passes every technical check below. It is left out because its stated terms make it a weak default: it describes itself as free and unrestricted "for now" and as deleting files that are not accessed for 60 days. That description came from a search result, not from the operator's own page, which I did not read. The owner can add it to the list without any other change.
- **nostr.download** fails. For a blob it considers identical to one it holds, it answers `409` with an `X-Reason` and an empty body, where BUD-02 says a server answers `200` with the existing descriptor. With no descriptor there is nothing to check or use, and re-uploading the same picture would always fail.
- **blossom.band** is the same service as `blossom.nostr.build`: both answered with descriptors on the same `npub…blossom.band` host. One entry covers it.

## What was measured

### Protocol, from Node, with the token policy as first drafted (`created_at` = now − 60)

| Host | Preflight | `HEAD /upload` for 5 MiB | `PUT /upload` |
|---|---|---|---|
| blossom.primal.net | 200 | 200 | 200, descriptor valid |
| blossom.band | 204 | 200 | 201, descriptor valid |
| 24242.io | 200 | 200 | **400** `too small, need some bytes` (79-byte image) |
| cdn.nostrcheck.me | 204 | **401** | **401** `Auth header event is not valid` |
| nostr.download | 200 | 200 | **409** (see above) |

### The backdate finding

nostrcheck.me refused the token at a 60-second backdate. The same token with `created_at` equal to now was accepted. A sweep of the backdate, each with a fresh blob:

| Backdate (s) | 0 | 5 | 10 | 20 | 30 | 45 | 55 | 58 | 60 |
|---|---|---|---|---|---|---|---|---|---|
| nostrcheck.me | 200 | 200 | 200 | 200 | 200 | 200 | **401** | 200 | **401** |

That is a freshness window of about 60 seconds, measured at the server. A backdate of 60 sits on it, and a slow upload would cross it. The standard base64 form, a missing `server` tag and a `server` tag naming the bare domain were also tried; they did not change the result at a 60-second backdate, so they were not the cause. The policy constant was revised to **10 seconds** (design decision 2). Everything else in this file was measured under the revised policy.

### Revised policy (`created_at` = now − 10, `expiration` = now + 300)

| Host | Preflight | `HEAD` 5 MiB | `PUT` | `sha256` and `size` match | URL has the hash, `https:`, under 512 chars | `GET` of the URL |
|---|---|---|---|---|---|---|
| blossom.primal.net | 200 | 200 | 200 | yes | yes (95 chars) | 200 `image/png`, identical bytes |
| blossom.nostr.build | 204 | 200 | 201 | yes | yes (153 chars) | 200 `image/png`, identical bytes |
| 24242.io | 200 | 200 | 200 | yes | yes (85 chars) | 200 `image/png`, identical bytes |
| cdn.nostrcheck.me | 204 | 200 | 200 | yes | yes (94 chars) | 200 `image/png`, identical bytes |

Descriptors carry extra fields (`nip94`, `uploaded`); the loose schema in design decision 8 ignores them.

### Size

- A real upload of 5,200,099 bytes (just under 5 MiB) succeeded on `blossom.primal.net` and `cdn.nostrcheck.me`, the two with no stated limit, and the stored bytes came back identical.
- `HEAD /upload` declaring 5 MiB returned 200 on all four.
- nostr.build and 24242.io state per-file limits of 20 MiB and 100 MiB. Those figures came from search results, not from their own pages.

### Minimum size

24242.io rejects very small blobs: 79 bytes got `400`, while 4,099 and 40,099 bytes were accepted. The threshold is somewhere between. A re-encoded photo is far above it. A tiny flat image could still hit a floor like this on some host, which is why the status copy table gained a `400` row ("The host did not accept this image.") rather than reporting it as unreachable.

### From a real extension page

A throwaway Manifest V3 extension whose CSP `connect-src` listed exactly the four origins above ran the `PUT` with the options the product will use: `credentials: "omit"`, `referrerPolicy: "no-referrer"`, `cache: "no-store"`, `redirect: "error"`, and `Authorization`, `Content-Type` and `X-SHA-256` headers.

- All four returned a descriptor the page could read (`responseType: "cors"`) with matching `sha256` and `size` and a URL containing the hash. The `PUT` was never redirected.
- `blossom.primal.net` and `24242.io` answer the preflight with `Access-Control-Allow-Headers: Authorization, *`. The wildcard worked for a request without credentials, as designed.
- A `fetch` to an origin not in the policy (`https://example.com/`) was blocked with a `connect-src` violation.

### Hashing

`NobleSha256` over 5 MiB: median 17.0 ms (minimum 16.6, maximum 17.6) on an Apple M4. No worker is needed.

## Not measured

- **Task 1.4, the file picker in the toolbar popup.** Playwright intercepts the file chooser and never opens the native dialog, so it cannot show whether a surface survives it. This needs a person at real Chrome on macOS and real Firefox, and it is best done against the real Upload button once task 6.5 lands. It decides only task 6.7, the fallback for a surface that fails, and does not affect the server list. Checked by hand afterwards in Chrome and Firefox: no surface needed the fallback.
- **Retention and longevity.** A single test at a single time. Free terms can change, and nothing here shows how long a blob stays.
- **A real browser's behaviour in Firefox.** The probe ran in Chromium only.
