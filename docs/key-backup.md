# Key backup

How to keep a copy of a key Ostrilo holds, how to restore it, and what to do if
you used a development build that wrote keys to disk in plaintext.

A Nostr key cannot be rotated. There is no revocation, no reset, and nobody who
can restore it for you. The copy you keep is the only recovery path there is.

## Saving an encrypted backup

While you create your first key, onboarding offers **Save encrypted backup**. It
writes a versioned `ostrilo-key-backup` file sealed with the same Argon2id key
derivation and AES-GCM encryption the vault itself uses. There is no plaintext
option.

The file has **its own passphrase**, which you supply when you save it. It is
separate from your master password on purpose: if the backup were sealed with the
master password, forgetting that one password would lose the vault and its backup
together. Ostrilo cannot recover the backup passphrase, and the file is useless
without it.

Changing the master password (Settings → Security) does not touch backup files.
Each one keeps the passphrase it was saved with, before and after the change.

The encrypted backup is offered only during first-key onboarding. There is no
export on the settings page, so a key you add later cannot be backed up from
within Ostrilo. If you import a key, keep your own copy of the `nsec`.

## Copying the key instead

The reveal step can copy your `nsec` to the clipboard. The copy control says it
will expire before you click, a 45-second countdown runs, and **Clear now** ends
it early. The clear also runs immediately if you leave or close the window.

Ostrilo overwrites the clipboard without reading it, so it needs no clipboard
permission. That also means anything else you copy during those 45 seconds is
replaced. If the copy fails, the key is shown in grouped blocks you can write
down instead.

## Proving you recorded it

Finish stays disabled until you re-enter the last 8 characters of your `nsec`, or
re-open the encrypted backup file with its passphrase. The checkbox beside it is
a statement of understanding, not evidence. This defeats accidental
click-through; it cannot prove a key was written on paper, and it does not claim
to.

## Restoring

Import an encrypted backup from the onboarding import step: choose the file,
enter its passphrase, and the key is re-encrypted under the master password you
set. Older plaintext export files still import, so you can move one into an
encrypted backup and then delete it.

## If you used an earlier development build

**If you ever clicked "Download Backup", find that file and delete it.** It was
written as unencrypted JSON containing your `nsec` and its hex twin, under a
filename that included the name you gave the key. Anyone who reads that file
controls the identity.

Deleting it is not always enough. Downloads folders are routinely synced to
iCloud Drive, OneDrive or Dropbox, captured by Time Machine or File History, and
indexed by Spotlight, and all of those keep copies you did not ask for. **If the
file reached a synced folder, a backup, or a machine you do not fully control,
treat that identity as exposed.** The only remedy is to create a new identity and
tell the people who follow the old one.

## Not supported

BIP-39 / NIP-06 seed phrases. A 12-word mnemonic is easier to transcribe
correctly than a 63-character `nsec`, but it changes how keys are generated
rather than how they are backed up, and it carries its own migration and
cross-client compatibility questions. It is tracked as `SYNC-004` in
[the roadmap](roadmap.md).
