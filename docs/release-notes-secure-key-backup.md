# Release note — secure key backup flow

> **Where this belongs.** These entries are written for the `## Unreleased` →
> `### Security` section of `/CHANGELOG.md`. They live here instead because
> `CHANGELOG.md` is being written concurrently by another change in the same
> remediation programme and a root-file edit would have collided. Fold them in
> when that lands; nothing else depends on this file's path.

---

## Act on this if you used an earlier build

**If you ever clicked "Download Backup", find that file and delete it.** It was
written as unencrypted JSON containing your `nsec` and its hex twin, under a
filename that included the name you gave the key. Anyone who reads that file
controls the identity.

Deleting it is not always enough. Downloads folders are routinely synced to
iCloud Drive, OneDrive or Dropbox, captured by Time Machine or File History, and
indexed by Spotlight — and all of those keep copies you did not ask for. **If the
file reached a synced folder, a backup, or a machine you do not fully control,
treat that identity as exposed.** A Nostr key cannot be rotated: there is no
revocation, no reset, and nobody who can restore it for you. The only remedy is
to create a new identity and tell the people who follow the old one.

---

## Changed

- **The plaintext key download is gone.** "Download Backup" wrote
  `{name, privateKey, privateKeyHex, createdAt}` to disk in the clear, with no
  passphrase and no warning. It has been replaced by **Save encrypted backup**,
  which writes a versioned `ostrilo-key-backup` file sealed with the same
  Argon2id key derivation and AES-GCM encryption the vault itself uses. There is
  no plaintext option, not behind a confirmation: a key file you cannot take back
  is not a choice worth offering.
- **The backup file has its own passphrase**, supplied when you save it and
  separate from your master password on purpose. If the backup were sealed with
  the master password, forgetting that one password would lose the vault and its
  backup together. Ostrilo cannot recover the backup passphrase, and the file is
  useless without it — that is the trade, and it is stated at the prompt.
- **Copying your key to the clipboard now expires.** The copy control says so
  before you click, a countdown runs for 45 seconds, and there is a "Clear now"
  button. The clear also runs immediately if you leave or close the window.
  Ostrilo overwrites the clipboard without reading it, so it needs no clipboard
  permission — which means anything else you copy during those 45 seconds is
  replaced too. If the copy fails, the key is shown in grouped blocks you can
  write down instead of the previous silent failure.
- **Finishing onboarding now requires proof you recorded the key.** The single
  "I have safely backed up my private key" checkbox was not evidence of anything.
  Finish stays disabled until you re-enter the last 8 characters of your `nsec`,
  or re-open the encrypted backup file with its passphrase. The checkbox remains
  as a statement of understanding. This defeats accidental click-through; it
  cannot prove a key was written on paper, and it does not claim to.
- **The master password no longer lingers after onboarding.** It and its
  confirmation are cleared on every exit from the create-key flow — finishing,
  stepping back, a failed reveal, and closing the window — not only on Finish.
  JavaScript strings cannot be erased from memory; what changed is that Ostrilo
  no longer holds a reference to yours for the life of the page.
- **Your key is kept away from browser autofill and password managers.** The
  revealed `nsec` is no longer displayed in a `type="password"` field, which is
  the signal managers capture on, and every key and password input now carries
  the opt-out attributes the major managers respect.
- **No document that can hold a key also loads a 3D engine.** An 892 KB WebGL
  library was reachable from every extension page, including the one that reveals
  your private key and the one that asks you to approve a signature. The mascot
  now loads on demand and is refused outright on those pages. A build check fails
  if it ever comes back.

## Restoring

Encrypted backups written by this version can be imported from the onboarding
import step: choose the file, enter its passphrase, and the key is re-encrypted
under the master password you set. Older plaintext export files still import, so
you can move one into an encrypted backup and then delete it.

## Not in this release

BIP-39 / NIP-06 seed phrases. A 12-word mnemonic is genuinely easier to
transcribe correctly than a 63-character `nsec`, but it changes how keys are
generated rather than how they are backed up, and it carries its own migration
and cross-client compatibility questions. It is tracked as `SYNC-004`.
