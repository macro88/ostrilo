# Privacy Policy

**Effective:** 3 November 2026 · **Applies to:** Ostrilo 0.10.0 and later

Ostrilo is a browser extension that stores Nostr keys and signs Nostr events on
your device. This policy covers what the extension stores, what it sends and
where it sends it.

## The short version

- Ostrilo has no server. The developer receives no data from the extension: no
  analytics, no telemetry, no crash reports, no usage statistics.
- Your private keys are encrypted with your master password and stay on your
  device. Websites receive your public key and signed events, never a private key.
- The extension makes network connections to Nostr relays, which you choose. The
  defaults are `wss://relay.primal.net`, `wss://relay.damus.io` and `wss://nos.lol`.
- It contacts an image host only when you upload a picture or banner, and only
  after you choose the host and confirm. The hosts are named under "Images and
  uploads" below.
- Your settings, including the list of sites you have given permissions to,
  stay on this device. Browser sync copies only one preference: whether Ostrilo
  opens in the side panel. Your keys never leave the device.

## What stays on your device

Ostrilo keeps these records in browser extension storage on this device. The session caches expire when the browser closes.

| Data | What it is |
|---|---|
| Encrypted vault | Your private keys, each encrypted with a key derived from your master password (Argon2id, AES-256-GCM). Without the password, the vault cannot be read. |
| Public keys and key labels | Stored beside the encrypted keys so the vault can list them while locked. |
| Activity log | For each request a site made: the time, the site's origin, the event kind, whether it was allowed or denied and, for a denial, why (you denied it, a saved rule, no answer in time, too many requests, a locked vault or an unreadable key), the key used, and the first 100 characters of the event's content. It keeps 50 entries by default, and at most 500. |
| Session caches | The browser session holds public profiles and per-key relay lists, including read/write markers and event IDs. Each cache holds up to 50 keys and 256 KiB. Relay lists expire after an hour. |
| Backup status | For each key you made in Ostrilo, whether you have backed it up: the key's internal ID, `pending` or `verified`, and the time. It holds no key material and no backup file, and it is stored apart from the vault. |
| Profile picture copy | A 96 by 96 pixel copy of your own profile picture, at most 64 KB, kept for each key you made one for, with the address it came from and the time. The header shows it. See [Images and uploads](#images-and-uploads). |
| Relay partition salt | A random value that decides which relay is asked about which of your keys. See [Relays](#what-is-sent-to-nostr-relays). |
| Settings | Site permissions (each site's origin, trust level, per-event-kind rules and, for each of your keys, whether the site may read that key's public key), your relay addresses, the image upload endpoint, auto-lock and session-grant durations, the activity log size, theme, which key is active (an internal ID, not the key), and whether onboarding is complete. |

Unlocked keys are held only in the extension's memory and are erased when the
vault locks. Session storage, which the browser clears when it closes, holds the
lock state and why the vault last locked, any time-limited permissions you granted
a site, short counters of recent requests per site (so a site cannot reset its
limit by waiting for the background to restart) and which "no backup" reminders
you dismissed. While the vault is unlocked Ostrilo makes a harmless call to the
browser about every 20 seconds to keep its background running until the auto-lock
time; it sends nothing anywhere.

## What your browser may sync

One preference: whether Ostrilo opens in the browser's side panel. If you have
turned on sync in your browser, for example Chrome Sync, your browser copies
that single on/off value to your browser account and your other signed-in
devices. The sync service is run by the browser vendor, not by Ostrilo, and is
subject to its privacy policy.

The browser keeps your other settings on this device, including site permissions and discovery relay preferences.
They used to be synced too; they are not, because a permission you grant with
this vault's password should not take effect on another browser without it. The
copy an earlier version kept in browser sync is deleted when you update. If you
use Ostrilo in more than one browser, you now set up each one separately.

Private keys, public keys, the master password and the activity log have never
been put in sync storage.

## What is sent to Nostr relays

Relays are servers on the public Nostr network, run by third parties. Ostrilo
connects to them over secure WebSockets (`wss://` only) for the following operations:

- **Looking up your profile.** To show your name and bio, Ostrilo asks relays
  for the public profile of each key in your vault. The request contains that
  key's public key. When you configure more than one relay, the lookups are
  split across them so that no single relay is asked about every key you hold;
  with one relay configured, that relay sees them all.
- **Publishing your profile.** When you edit and save your profile, Ostrilo
  looks up the selected key’s public relay list and sends a signed kind 0 event to its write relays and the discovery relays. That event is public and
  permanent by the design of Nostr, and contains only the profile fields you
  filled in.

- **Looking up your relay list.** Opening or refreshing the Relays tab and publishing for a key can ask discovery relays and cached write relays about that single public key. Routine profile lookups use discovery relays only.
- **Publishing your relay list.** New keys publish a starter list to your discovery relays by default. Clear the checkbox before creating the key to skip this. Imports never trigger publication. Settings lets you publish a public list of read and write relay URLs. Updates go to discovery relays and old and new write relays. Relays can keep copies indefinitely.
- **Local networks.** Ostrilo filters private IP literals and local hostnames from public lists before connecting, except addresses you explicitly configured for discovery. Public DNS names can still resolve to private addresses.

Like any server, a relay can see your IP address when you connect. What a relay
does with what it receives is governed by that relay's operator. Ostrilo does
not send events that websites ask it to sign to any relay; it returns the signed
event to the website, which decides where to publish it.

## What websites receive

Ostrilo makes `window.nostr` (NIP-07) available on HTTPS pages. Its content
script does not read page content; it only passes a page's `window.nostr`
requests, and the page's origin, to the extension. A website receives:

- your **public key**, only after you approve the site to see it;
- **signed events**, only for requests you approve, or that match rules you set
  for that site.

A website never receives a private key or your master password.

## Files and clipboard

- **Backup files** are written to your device only when you choose to save one.
  They are encrypted with a passphrase you choose.
- **Copying a new private key** during onboarding puts it on your system
  clipboard, which other applications on your device can read. Ostrilo clears
  it after 45 seconds, or as soon as you finish.

## Images and uploads

Ostrilo does not load remote images in its windows, with one exception that you
start: your own profile picture.

When you save your profile with a picture address, or press **Refresh picture**
on the Profile screen, Ostrilo loads that address once to make a small copy for
the header. The request goes to the host named in the address, from your browser,
so that host can see your IP address and the time. It carries no referrer and no
cookies. Ostrilo shrinks the image to 96 by 96 pixels, keeps the copy on your
device, and the header shows only that copy. It will not load images larger than
4096 by 4096 pixels or addresses that do not start with `https://`, and it gives
up after 10 seconds.

Apart from an upload, which only you can start and which is described below,
that is the only time Ostrilo asks an image host for anything. Opening the popup
or the side panel, unlocking, switching keys and approval windows make no image
request, and nothing refreshes the copy in the background. If the picture cannot
be loaded or kept, the header keeps the local seal and the Profile screen says so.
Saving a profile with no picture removes that key's copy. Deleting a key removes its copy too, as the last step of the deletion; if that step fails, the leftover copy is removed the next time any copy is saved.

### Uploading a picture or banner

You can upload an image from **Edit Profile**, or paste an `https://` address
instead. Nothing is sent until you choose a file, pick one of three hosts, and
confirm. The hosts are Primal (`blossom.primal.net`), nostr.build
(`blossom.nostr.build`) and nostrcheck.me (`cdn.nostrcheck.me`). Ostrilo has no
default host, asks every time, and does not read a list of hosts from the
network: the three are part of the extension.

Before the confirmation window opens, Ostrilo reads up to 4 KiB from the start
of the file to check that it is a JPEG, PNG, GIF or WebP. It decodes nothing and
sends nothing. After you confirm, a still image is re-encoded on your device,
which removes embedded details such as the place a photo was taken, and its
longest side is capped at 2048 pixels. An animated image is sent as it is, so
details embedded in it stay in it, and the window says so. A file over 5 MB is
refused.

The host you choose sees the image, your IP address and your public key. It also
receives a signed token: an event your key signs for that one image and that one
host, valid for five minutes. The request carries no cookies and no referrer,
and Ostrilo does not follow a redirect. The image becomes public at an address
anyone can open, and a host may remove files or refuse to delete them, so keep
the original. Each signed token is recorded in the activity log.

An upload publishes nothing. It fills in the address field, and your profile
changes only when you save it. Ostrilo checks that the host's reply names the
same hash and size it sent, and it does not request the address the host
returns; the one request for it is the picture copy made when you save, described
above. Those checks show that the reply agrees with what was sent. They do not
show that the host stored the image or will keep serving it. Nothing is uploaded
in the background.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Holds the encrypted vault, settings, activity log and profile cache described above. |
| `windows` | Opens the approval window where you review a site's request. |
| `alarms` | Locks the vault when the auto-lock time runs out. |
| `idle` | Reads only whether the computer is active, idle or locked, to decide when to lock. |
| `sidePanel` (Chrome) | Lets Ostrilo open in the browser side panel if you choose. |
| Access to `https://` pages | Provides `window.nostr` so Nostr websites can request signatures. |

## Sharing, selling and advertising

The developer does not collect your data, so there is none to sell, share,
transfer or use for advertising, credit decisions or any purpose other than the
extension's single purpose of managing Nostr keys and signing. Ostrilo's use of
information complies with the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
including the Limited Use requirements.

## Deleting your data

Uninstalling Ostrilo removes its local and session storage from your browser.
The synced side-panel preference is removed from your browser account according
to your browser's sync behaviour. Anything published to Nostr relays, such as your
profile, is outside Ostrilo's control and cannot be deleted by uninstalling.

Make sure you have a backup of every key before you uninstall: Ostrilo holds the
only copy that it knows of. See [Key backup](docs/key-backup.md).

## Children

Ostrilo is not directed at children under 13 and does not knowingly collect
information from anyone.

## Changes to this policy

Changes are made in this file, and its history is public in this repository. A
change that affects what data leaves your device is noted in the
[changelog](CHANGELOG.md) for the release that makes it.

## Contact

Ask a question or report a problem on
[GitHub Issues](https://github.com/macro88/ostrilo/issues). Report a security
issue privately as described in [SECURITY.md](SECURITY.md).
