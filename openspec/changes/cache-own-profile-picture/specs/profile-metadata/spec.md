## MODIFIED Requirements

### Requirement: ProfileView UI Integration

The extension SHALL enhance ProfileView component to display real profile metadata. ProfileView SHALL NOT load an image from a relay-supplied URL, except the one load of the user's own picture that a save or Refresh picture starts.

#### Scenario: Display mode shows profile fields
- **GIVEN** ProfileView is mounted
- **AND** user has unlocked key selected
- **WHEN** component loads
- **THEN** it SHALL fetch profile via ProfileService.getProfile(selectedPubkey)
- **AND** it SHALL display profile.name or "Unnamed" fallback
- **AND** it SHALL display the local seal avatar with the profile initial
- **AND** it SHALL NOT set profile.picture as an image source
- **AND** it SHALL display profile.picture, when present, as monospace text with a copy affordance
- **AND** it SHALL offer Refresh picture when profile.picture is an `https:` URL
- **AND** it SHALL NOT load the picture when it opens
- **AND** it SHALL display profile.about or "No bio" fallback
- **AND** it SHALL display profile.website as a link opening in a new tab with `rel="noopener noreferrer"`, or "No website"
- **AND** it SHALL show loading state while fetching
- **AND** it SHALL show error state if fetch fails

#### Scenario: Edit mode allows profile updates
- **GIVEN** ProfileView is in display mode
- **WHEN** user clicks "Edit Profile" button
- **THEN** it SHALL switch to edit mode
- **AND** it SHALL render editable form fields for name, about, picture URL, website
- **AND** it SHALL pre-populate fields with current profile values
- **AND** it SHALL validate inputs on blur, requiring `https:` URLs and enforcing length limits
- **AND** it SHALL show validation errors inline
- **AND** it SHALL NOT preview an entered image URL by loading it in the extension page

#### Scenario: Publishing profile updates
- **GIVEN** ProfileView is in edit mode
- **AND** user has modified profile fields
- **WHEN** user clicks "Save" button
- **THEN** it SHALL validate all fields
- **AND** if validation passes, it SHALL call ProfileService.updateProfile(metadata)
- **AND** it SHALL show saving indicator
- **AND** on success, it SHALL switch back to display mode with updated profile
- **AND** on success with a non-empty picture, it SHALL load that URL once to make the local copy the header shows, and on success with no picture it SHALL remove the copy
- **AND** on error, it SHALL show error message and remain in edit mode

#### Scenario: Manual refresh
- **GIVEN** ProfileView is in display mode
- **WHEN** user clicks refresh icon/button
- **THEN** it SHALL call ProfileService.getProfile(pubkey, forceFetch=true)
- **AND** it SHALL show loading indicator
- **AND** it SHALL update display with fresh verified profile data
- **AND** it SHALL update cache timestamp

### Requirement: Security Considerations

The extension SHALL maintain security boundaries during profile operations. A relay SHALL be treated as an untrusted remote party whose output is verified before it can change extension state or appear in an extension page.

#### Scenario: No private key exposure
- **GIVEN** ProfileService publishes profile update
- **WHEN** constructing and signing event
- **THEN** private key SHALL remain in KeyVaultService only
- **AND** signing SHALL occur via RPC boundary
- **AND** signed event SHALL be returned without exposing private key
- **AND** relay SHALL receive only signed event, not key material

#### Scenario: URL sanitization
- **GIVEN** profile contains picture, banner, or website URLs
- **WHEN** validating and rendering the profile
- **THEN** URLs SHALL be parsed using the URL constructor
- **AND** only the `https:` scheme SHALL be accepted; `http:`, `javascript:`, `data:`, `blob:`, and `file:` SHALL be rejected
- **AND** invalid URLs SHALL be omitted from validated metadata
- **AND** URLs SHALL NOT be executed as JavaScript (no javascript: protocol)
- **AND** picture and banner URLs SHALL NOT be used as an image source in an extension page, other than the Profile page's one explicit load of the user's own picture
- **AND** external links SHALL open in new tab with noopener noreferrer

#### Scenario: Profile content not trusted
- **GIVEN** profile metadata is fetched from relays
- **WHEN** the extension processes the event
- **THEN** the event's ID SHALL be recomputed and compared before the content is read
- **AND** the event's Schnorr signature SHALL be verified with `verifyEventSignature`
- **AND** the event's `pubkey` SHALL equal the requested pubkey and its `kind` SHALL equal `0`
- **AND** content SHALL be treated as untrusted user input even after verification
- **AND** SHALL NOT be used for authentication or authorization
- **AND** SHALL be sanitized before rendering (React auto-escapes)
- **AND** SHALL NOT execute embedded scripts or HTML
- **AND** React escaping alone SHALL NOT be treated as sufficient protection for relay-supplied data

#### Scenario: Relay cannot poison the displayed identity
- **GIVEN** the user manages pubkey `P`
- **WHEN** a relay returns a kind:0 event for `P` that it did not obtain from `P`'s key holder
- **THEN** the event SHALL fail signature verification and be discarded
- **AND** the name and avatar shown for `P` in the key selector, profile surface, and approval window SHALL be unaffected
- **AND** the user's view of which identity is about to sign SHALL remain accurate

#### Scenario: Relay data is isolated from key storage
- **GIVEN** relay-derived profile data is cached
- **WHEN** the cache is written
- **THEN** the write SHALL target a storage area that does not contain `encryptedKeys`
- **AND** relay-derived data volume SHALL NOT contribute to the quota of the area holding key records
- **AND** a key creation or import write SHALL NOT fail because of cached relay data
