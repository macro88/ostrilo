# Managing Multiple Keys

Ostrilo supports managing multiple Nostr identities within a single extension. This guide explains how to use the multi-key features to switch between keys, add new keys, and manage your identities.

## Overview

The multi-key selector allows you to:
- Switch between different Nostr identities with a single click
- Add additional keys without leaving your current context
- Manage key labels, rename, and delete keys from settings
- View profile metadata (avatars and display names) for each key

## Switching Between Keys

The key selector is located in the extension header and displays your currently active key with its profile avatar and display name.

**To switch to a different key:**

1. Click on the key selector in the header (shows current key's avatar and name)
2. A dropdown menu will appear showing all your available keys
3. Each key displays:
   - Profile avatar (if available)
   - Display name or key label
   - Truncated npub (public key)
   - Checkmark (✓) next to the currently selected key
4. Click any key to switch to it
5. The dropdown closes automatically and all UI components update to reflect the new key

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
   - Enter a label (optional) to identify this key
   - The extension will generate a new keypair
   - The new key is automatically selected

5. For **Import Existing Key**:
   - Paste your private key (nsec1... or hex format)
   - Enter a label (optional)
   - The imported key is automatically selected

### From Settings

1. Navigate to the **Settings** tab
2. Scroll to the **Keys & Identities** section
3. Click the **"Add Key"** button
4. Follow the same create or import flow as above

**Note:** When the vault is unlocked, you don't need to re-enter your password to add keys. The current session password is reused automatically for security and convenience.

## Managing Keys in Settings

The Settings page provides comprehensive key management features.

### Viewing All Keys

1. Open the extension popup or sidepanel
2. Click the **Settings** tab
3. Navigate to the **Keys & Identities** section

Each key is displayed with:
- Profile avatar
- Display name (from Nostr profile metadata if available)
- Key label (your custom identifier)
- Truncated npub (public key)
- "Active" badge for the currently selected key
- Management buttons (Set Active, Rename, Delete)

### Renaming a Key

Key labels help you identify different identities (e.g., "Work", "Personal", "Anonymous").

**To rename a key:**

1. In the **Keys & Identities** section, find the key you want to rename
2. Click the **"Rename"** button next to that key
3. The label becomes editable inline
4. Type your new label (e.g., "Work Account")
5. Click **"Save"** or press `Enter`
6. The new label appears immediately throughout the UI

**Label requirements:**
- Maximum 64 characters
- Cannot be empty
- Any Unicode characters allowed

### Setting a Key as Active

If you're viewing settings and want to switch to a different key:

1. Find the key you want to activate
2. Click **"Set Active"** button
3. The key becomes your active identity immediately
4. The "Active" badge moves to this key

This is equivalent to switching keys via the header dropdown.

### Deleting a Key

**⚠️ Warning:** Key deletion is permanent and cannot be undone. Make sure you have backed up your key before deleting it.

**To delete a key:**

1. In the **Keys & Identities** section, find the key to delete
2. Click the **"Delete"** button
3. A confirmation dialog appears with a warning about data loss
4. Read the warning carefully
5. Click **"Delete"** to confirm, or **"Cancel"** to abort

**Important notes:**
- You cannot delete your last remaining key
- If you delete the currently active key, another key is automatically selected
- The deleted key's private key material is securely overwritten in memory
- All associated settings and policies for that key are removed

## Profile Metadata Integration

Ostrilo automatically fetches profile metadata for all your keys from Nostr relays.

**What's displayed:**
- **Profile Avatar**: Your profile picture from kind:0 events
- **Display Name**: Your preferred name (display_name or name field)
- **Fallback**: If no profile is found, shows your key label or "Unnamed Key"

**Caching:**
- Profile data is cached for 5 minutes to reduce relay queries
- Profiles are refreshed automatically when stale
- Works offline by showing cached data

**Privacy note:** Profile fetching queries Nostr relays for your public key. This is a standard Nostr operation and does not expose your private keys.

## Best Practices

### Organizing Multiple Identities

- **Use descriptive labels**: "Work - Alice", "Personal", "Anon Blogger"
- **Limit key count**: Recommended maximum of 10 keys for best UX
- **Back up before deleting**: Export or write down private keys before removal

### Security Considerations

- **All keys share the same vault password**: Any key can be accessed when vault is unlocked
- **Lock the vault** when stepping away to protect all keys
- **Never share private keys**: Only share npub (public key) with others
- **Use separate keys for different trust levels**: Keep work and personal identities separate

### Performance Tips

- **Profile loading**: First time loading shows key labels immediately, avatars load asynchronously
- **Key switching**: Switching is instant; no network requests required
- **Many keys**: If you have many keys, consider using fewer active ones

## Keyboard Accessibility

All multi-key features are fully accessible via keyboard:

- **Tab**: Navigate between interactive elements
- **Enter/Space**: Activate buttons and select keys
- **Arrow keys**: Navigate within the key dropdown
- **Escape**: Close dropdown or cancel dialogs

## Troubleshooting

### Key selector is empty
- Ensure you've completed onboarding and created/imported at least one key
- Try unlocking the vault if it's locked

### Profile avatar not showing
- Check your internet connection
- Profile metadata may not exist on relays yet
- Fallback avatar (first letter of name) is shown automatically

### Can't delete a key
- Verify it's not your last remaining key (last key cannot be deleted)
- Check if delete button is enabled (should not be disabled)
- Try refreshing the extension

### Switched key but UI hasn't updated
- This is rare; try closing and reopening the popup
- If persists, file a bug report with reproduction steps

## FAQ

**Q: How many keys can I have?**  
A: There's no hard limit, but we recommend 1-10 keys for optimal UX. More keys may require scrolling in the dropdown.

**Q: Do I need to re-enter my password when adding keys?**  
A: No, when the vault is unlocked, new keys are encrypted with your current session password automatically.

**Q: What happens if I delete all my keys?**  
A: You cannot delete your last key. The delete button is disabled when only one key remains.

**Q: Can I export a key before deleting it?**  
A: Currently, key export is not supported. Make sure you've saved your private key elsewhere before importing it into Ostrilo if you need a backup. Future versions will add explicit export functionality.

**Q: Will my keys sync across devices?**  
A: No, keys are stored locally in the browser extension. Multi-device sync via NIP-46 is planned for a future release.

**Q: What is the difference between "label" and "display name"?**  
A: 
- **Label**: Your local identifier for the key within Ostrilo (only you see it)
- **Display Name**: Your public profile name fetched from Nostr relays (everyone sees it)

## Related Documentation

- [Onboarding Guide](./ostrilo-onboarding-requirements.md) - Initial setup and first key creation
- [Settings & Permissions](./ostrilo-settings-permissions-v1.md) - Per-origin policies and settings
- [Signer Requirements](./ostrilo-signer-requirements.md) - Security requirements and threat model boundaries

## Support

If you encounter issues or have questions:
1. Check the troubleshooting section above
2. Review the FAQ
3. File an issue on GitHub with detailed reproduction steps
4. Include your Ostrilo version and browser information
