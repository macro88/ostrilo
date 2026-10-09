# Managing Multiple Keys

Ostrilo supports managing multiple Nostr identities within a single extension. This guide explains how to use the multi-key features to switch between keys, add new keys, and manage your identities.

## Overview

The multi-key selector allows you to:
- Switch between different Nostr identities with a single click
- Add additional keys without leaving your current context
- Rename, delete and re-activate keys from the **Keys & Identities** tab on the settings page
- See the display name from each key's Nostr profile

Two surfaces are involved. The **key selector** in the extension header switches
the active key and adds new ones. The **settings page** (a full browser tab, not
the popup) is where keys are renamed and deleted.

## Switching Between Keys

The key selector is located in the extension header and displays your currently active key with its picture (or a seal avatar) and display name.

**To switch to a different key:**

1. Click on the key selector in the header (shows current key's picture and name)
2. A dropdown menu will appear showing all your available keys
3. Each key displays:
   - A seal avatar showing the first letter of its name
   - Display name or key label
   - Truncated npub (public key)
   - Checkmark (✓) next to the currently selected key
4. Click any key to switch to it
5. The dropdown closes automatically and all UI components update to reflect the new key

**Where does the header picture come from?** From a small copy Ostrilo keeps on
your device. When you save your profile with a picture address, or press
**Refresh picture** on the Profile screen, Ostrilo loads that address once and
stores a 96 by 96 pixel copy for that key. The header shows only the copy. It
never loads the picture when you open the popup, switch keys or approve a
request: a picture address points at a host someone chose, and this is the
screen where you confirm which identity is about to sign, so fetching it every
time would tell that host your IP address each time you looked. A key with no
copy, or whose picture cannot be loaded, shows a local seal with its
first letter. The rows in the dropdown are always seals.

**Keyboard shortcuts:**
- Press `Enter` or `Space` to open the dropdown
- Use `↑` and `↓` arrow keys to navigate between keys
- Press `Enter` to select the highlighted key
- Press `Escape` to close the dropdown without changing selection

## Adding Additional Keys

You can add new keys at any time, even after initial onboarding.

### From the Key Selector

1. Click the key selector to open the dropdown
2. At the bottom of the list, click **"Add Key"**
3. Choose between:
   - **Create New Key**: Generate a fresh Nostr identity
   - **Import Existing Key**: Import a key from nsec1 or hex format

4. For **Create New Key**:
   - Enter your **vault password**
   - Enter a **key name**
   - Click **Create Key**

5. For **Import Existing Key**:
   - Enter your **vault password**
   - Paste your private key (nsec1... or hex format)
   - Enter a **key name**
   - Click **Import Key**

**The new key is not made active.** It is added to your vault and appears in the
selector, but whichever key was signing before carries on signing. Open the
selector and click the new key when you want to use it. This is deliberate:
adding a key should never quietly change which identity signs your next request.

### From the settings page

1. Open the **Settings** tab in the popup and click **Keys & identities** (or right-click the Ostrilo toolbar icon and choose Options)
2. The settings page opens on the **Keys & Identities** tab
3. Click the **"Add Key"** button
4. Follow the same create or import flow as above

**Note:** You must enter your vault password to add a key, even when the vault is
already unlocked. Ostrilo keeps no copy of your password in memory to reuse, so
there is nothing to fall back on — the password you type is used to encrypt the
new key and is then discarded.

## Managing Keys on the Settings Page

Key management lives on the settings page, which opens in its own browser tab.
The popup's Settings tab is for quick controls only — theme, auto-lock and
**Lock now** — and links out to the full page.

### Viewing All Keys

1. Open the extension popup and click the **Settings** tab
2. Click **Keys & identities** (or right-click the Ostrilo toolbar icon and choose Options, then pick the **Keys & Identities** tab)

The settings page asks for your password if the vault is locked, and tells you to
create a key in the popup first if you have no vault yet.

Each key is displayed with:
- A seal avatar showing the first letter of its name
- Display name (from Nostr profile metadata if available)
- Key label (your custom identifier)
- Truncated npub, with a copy button beside it
- **ACTIVE** chip on the currently selected key
- A **Set Active** button (on keys that are not already active), a rename (pencil) button and a delete (trash) button

If a stored key's public key cannot be read, that row says **"Unreadable record:
stored public key is not valid"** instead of showing an npub. Ostrilo will not
display a guess: a made-up npub that looked real would be indistinguishable from
your own identity.

### Renaming a Key

Key labels help you identify different identities (e.g., "Work", "Personal", "Anonymous").

**To rename a key:**

1. On the **Keys & Identities** tab, find the key you want to rename
2. Click the pencil (rename) button on that row
3. The label becomes an editable text box
4. Type your new label (e.g., "Work Account")
5. Press `Enter`, or click the check button. Press `Escape` or click the ✕ to cancel
6. Reload the page to see the new label

Renaming does not ask for your password. It changes a label you chose and
destroys nothing.

**Known issue:** the new label is saved straight away, but the row you just
edited keeps showing the old one, and so does the key selector in the popup.
Nothing tells the open screens that the name changed. Reload the settings page
(and reopen the popup) and the new label is there. The rename did work — you
just cannot see it yet. This is a defect, and it is pinned by a test so it
cannot be lost.

**Label requirements:**
- Maximum 100 characters
- Any Unicode characters allowed

### Setting a Key as Active

If you're viewing settings and want to switch to a different key:

1. Find the key you want to activate
2. Click **"Set Active"** button
3. The key becomes your active identity immediately
4. The **ACTIVE** chip moves to this key

This is equivalent to switching keys via the header dropdown.

### Deleting a Key

**⚠️ Warning:** Key deletion is permanent and cannot be undone. If the key was
never backed up, the identity is gone for good — see the FAQ below on backing up,
because Ostrilo can only back up a key during onboarding.

**To delete a key:**

1. On the **Keys & Identities** tab, find the key to delete
2. Click the trash (delete) button on that row
3. A dialog appears naming the key and stating the consequence, and asks for your **vault password**
4. Type your vault password and click **Confirm**, or **Cancel** to abort

Deleting a key needs your password even though the vault is already unlocked.
Ostrilo refuses the deletion in the background without one, so cancelling the
dialog — or getting the password wrong — leaves the key exactly where it was.

**Important notes:**
- You cannot delete your last remaining key. Its delete button is disabled, and hovering it explains why
- If you delete the currently active key, the first remaining key becomes active
- The deleted key's private key material is overwritten in memory
- Per-site permissions are stored per origin, not per key, so they are **not** removed when a key is deleted

**Known issue:** if you delete a key that was added during the current session,
the vault may lock itself immediately and ask you to unlock again. The deletion
still happened. This is a defect, and it is pinned by a test so it cannot be
lost.

## Profile Metadata Integration

Ostrilo automatically fetches profile metadata for all your keys from Nostr relays.

**What's displayed:**
- **Display Name**: Your preferred name (the `display_name` or `name` field from your kind:0 profile event)
- **Fallback**: If no profile is found, shows your key label, or "Unnamed Key" if there is no label

**Not displayed:** profile pictures in key lists. The dropdown and the settings
list always use the local seal avatar. Only the header shows your own picture,
from the local copy — see "Where does the header picture come from?" above.

**Caching:**
- Profile data is cached for one hour to reduce relay queries
- Profiles are refreshed automatically when stale
- If the relays cannot be reached, the cached profile is shown even if it has expired

**Privacy note:** Profile fetching queries Nostr relays for your public key. This is a standard Nostr operation and does not expose your private keys.

## Best Practices

### Organizing Multiple Identities

- **Use descriptive labels**: "Work - Alice", "Personal", "Anon Blogger"
- **Back up what you create**: a key you create in Settings is marked **No backup** until you choose **Back up** on its row, enter your password, save the encrypted file and check it. If you import a key, keep your own copy of the nsec

### Security Considerations

- **All keys share the same vault password**: Any key can be accessed when vault is unlocked
- **Lock the vault** when stepping away to protect all keys
- **Never share private keys**: Only share npub (public key) with others
- **Use separate keys for different trust levels**: Keep work and personal identities separate

### Performance Tips

- **Profile loading**: Key names, seal avatars and the header's stored picture copy render without any image request. Display names from Nostr profiles arrive when the relay query resolves, and are cached for an hour afterwards
- **Key switching**: Switching is instant; no network requests required

## Keyboard Accessibility

All multi-key features are fully accessible via keyboard:

- **Tab**: Navigate between interactive elements
- **Enter/Space**: Activate buttons, and open the key selector. Opening it with the keyboard puts focus on the first key
- **Arrow keys**: Navigate within the key dropdown
- **Escape**: Close the dropdown without changing the active key, or cancel a dialog. Focus returns to the selector

On the settings page, the left/right and up/down arrow keys move between settings
tabs, except when focus is inside a control that uses the arrows itself (such as
the auto-lock slider).

## Troubleshooting

### Key selector is empty
- Ensure you've completed onboarding and created/imported at least one key
- Try unlocking the vault if it's locked

### Display name not showing
- Check your internet connection
- Profile metadata may not exist on relays yet
- The key label (or "Unnamed Key") is shown instead
- Dropdown and settings rows are always the local seal, so a missing picture there is not a fault. The header shows your picture only after you save or refresh your profile, and only if the picture can be loaded

### Can't delete a key
- Verify it's not your last remaining key (the last key cannot be deleted, and its delete button is disabled)
- The deletion needs your vault password: if you cancelled the dialog or typed the wrong password, nothing was deleted
- Deleting is only available on the settings page, not in the popup

### Switched key but UI hasn't updated
- This is rare; try closing and reopening the popup
- If persists, file a bug report with reproduction steps

## FAQ

**Q: How many keys can I have?**  
A: There's no enforced limit, but we recommend 1-10 keys. More keys means
scrolling in the dropdown, and every extra key is one more identity to keep
track of before you sign.

**Q: Do I need to re-enter my password when adding keys?**  
A: Yes. Every add-key form asks for your vault password, even when the vault is
unlocked. Ostrilo does not keep your password in memory to reuse — the one you
type encrypts the new key and is then discarded.

**Q: What happens if I delete all my keys?**  
A: You cannot. The delete button is disabled when only one key remains, and the
background refuses the request even if something else tries to send it.

**Q: Can I export a key before deleting it?**  
A: You can save an encrypted backup. Choose **Back up** on the key's row, enter
your password, save the file, then select it again to check it opens. There is no
plaintext export. Keep your own copy of any key you import, and treat deletion
of a key with no backup as permanent loss of that identity.

**Q: Does adding a key switch me to it?**  
A: No. A new key is added to your vault but the key that was signing before keeps
signing. Open the key selector and click the new key to switch.

**Q: Is key management in the popup?**  
A: No. The popup's Settings tab holds quick controls (theme, auto-lock, Lock
now). Renaming and deleting keys is on the settings page, which opens in its own
browser tab — the popup links to it.

**Q: Will my keys sync across devices?**  
A: No, keys are stored locally in the browser extension. Multi-device sync via NIP-46 is planned for a future release.

**Q: What is the difference between "label" and "display name"?**  
A: 
- **Label**: Your local identifier for the key within Ostrilo (only you see it)
- **Display Name**: Your public profile name fetched from Nostr relays (everyone sees it)

## Related Documentation

- [Key backup](./key-backup.md) - Saving and restoring an encrypted backup
- [Onboarding requirements](./ostrilo-onboarding-requirements.md) - What first-run setup must do
- [Settings & permissions requirements](./ostrilo-settings-permissions-v1.md) - Per-origin policies and settings
- [Signer requirements](./ostrilo-signer-requirements.md) - Security requirements and threat model boundaries

## Reporting a problem

Open a bug report from the repository's issue templates. Never paste an `nsec`,
a vault file or a backup file into an issue. Report anything security-sensitive
privately, as described in [SECURITY.md](../SECURITY.md).
