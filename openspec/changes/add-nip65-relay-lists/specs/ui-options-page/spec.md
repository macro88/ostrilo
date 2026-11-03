## MODIFIED Requirements

### Requirement: Relays Tab

The Options Page SHALL provide a Relays tab for Nostr relay management. The tab SHALL show two lists with distinct roles: the selected key's published relay list, which the user edits and publishes, and the discovery relays, which are device-local settings.

**Acceptance Criteria:**

- Tab shows the selected key's relay list with a read and write marker for each entry
- User can add and remove relay-list entries and change each entry's marker
- Relay-list edits are not saved automatically; they are published only by an explicit publish action, and unpublished edits are indicated
- Tab offers a starter relay list when the selected key has none
- Tab explains, without publishing, when the relay list is unreadable, unreachable, or has changed elsewhere since editing began
- Relay-list entries the extension will not contact are visible and marked as not used
- Tab displays the configured discovery relays in a separate section
- User can add and remove discovery relays
- Add relay input validates secure WebSocket URLs beginning with `wss://`
- Invalid relay input shows an inline error and does not add the relay
- The tab has at most one primary action

#### Scenario: User adds invalid relay URL

**Given** Options Page Relays tab is active  
**When** user enters `http://relay.example.com`  
**And** clicks Add Relay  
**Then** error message displays that relay URLs must start with `wss://`  
**And** relay is not added to the list

#### Scenario: User edits and publishes the relay list

**Given** Options Page Relays tab is active  
**And** the selected key's relay list was found  
**When** user changes `wss://relay.damus.io` from Read and write to Read only  
**Then** the tab indicates that the change is not published  
**When** user clicks Publish relay list  
**Then** the tab reports how many relays accepted the published list  
**And** the change is no longer indicated as unpublished

#### Scenario: Key without a relay list is offered a starter list

**Given** Options Page Relays tab is active  
**And** a fresh lookup for the selected key found no relay list  
**Then** the primary action is Publish starter list  
**And** the tab lists the discovery relays the starter list will contain  
**And** the tab states that publishing replaces any relay list held on relays the extension did not ask

#### Scenario: Relay list changed elsewhere

**Given** the user has unpublished edits to the selected key's relay list  
**And** another client has published a newer relay list for that key  
**When** user clicks Publish relay list  
**Then** nothing is published  
**And** a warning explains that the list changed elsewhere and shows the newer list
