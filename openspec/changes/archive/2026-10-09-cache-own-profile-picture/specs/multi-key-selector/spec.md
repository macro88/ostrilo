## MODIFIED Requirements

### Requirement: REQ-MKS-002 - Profile-Aware Key Display

The system SHALL integrate profile metadata for each key, displaying the profile
display name when available. The header trigger SHALL show the selected key's own
profile picture from a local copy when one exists. It SHALL NOT load relay-supplied
profile pictures on any key-selection surface.

**Priority:** High  
**Category:** Integration

#### Acceptance Criteria
- KeySelector requests profile metadata for all keys on mount, in parallel, keyed by hex public key
- Display name shown as: `metadata.display_name || metadata.name || key.label || "Unnamed Key"`
- List rows (the dropdown and the settings key list) are ALWAYS the local seal bearing the display name's first letter. `metadata.picture` MUST NOT be used as an image source on any key-selection surface
- The header trigger shows the selected key's local picture copy, a `data:` image at a fixed size with the display name as its alternative text, and the seal when the key has none. It never shows another key's copy, not even while a switch settles
- Npub shown as secondary text, middle-truncated, in mono (`DESIGN_RULES` §7)
- A failed profile fetch degrades to the label with no error UI

#### Scenario: Key with profile metadata
**Given** the user has a key with public key npub1abc...def  
**And** that key has profile metadata with a picture URL and display_name "Alice"  
**When** the KeySelector renders  
**Then** the key shows a seal avatar with the letter "A"  
**And** no request is made to the picture URL's host  
**And** the key shows "Alice" as the primary text  
**And** the key shows the truncated npub as secondary text

#### Scenario: Selected key with a local picture copy
**Given** the selected key has a local copy of its picture  
**When** the KeySelector renders  
**Then** the header trigger shows that image at a fixed size, named for the display name  
**And** the image source is a `data:` URL  
**And** the dropdown rows still show seals  
**When** the user switches to a key with no copy  
**Then** the header shows that key's seal and never the previous key's image

#### Scenario: Key without profile metadata
**Given** the user has a key with label "Work Account"  
**And** that key has no profile metadata  
**When** the KeySelector renders  
**Then** the key shows a seal avatar with the letter "W"  
**And** the key shows "Work Account" as the primary text  
**And** the key shows the truncated npub as secondary text

#### Scenario: Stored public key cannot be decoded
**Given** a stored record whose public key is not valid hex  
**When** the settings key list renders that record  
**Then** the row states that the record is unreadable  
**And** no npub is rendered for it

### Requirement: REQ-MKS-009 - Performance Requirements

The system SHALL render the key list and handle interactions with minimal latency.

**Priority:** Medium  
**Category:** Performance

#### Acceptance Criteria
- Key list renders in <100ms for up to 10 keys
- Key switching completes in <500ms (excluding network)
- Profile metadata for all keys is requested in parallel, and one failure does not sink the rest
- `KeySelector` is wrapped in `React.memo` to prevent unnecessary re-renders
- The header image is a stored `data:` copy read from the background, so no remote image is loaded and no image lazy-loading is required
- Dropdown open/close animation is smooth

#### Scenario: Fast rendering with multiple keys
**Given** the user has 10 keys in their vault  
**When** the user opens the KeySelector dropdown  
**Then** all 10 keys render within 100ms  
**And** no jank or lag is visible  
**And** scrolling is smooth (60fps)
