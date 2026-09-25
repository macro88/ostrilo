# Proposal: Add Profile Metadata Management

## Change ID
`add-profile-metadata-management`

## Status
🔄 **Proposal** - Awaiting approval

## Overview
Implement comprehensive profile metadata management for Ostrilo, enabling users to fetch, cache, display, and publish Nostr profile metadata (NIP-01 kind:0 events) for each of their managed identities. This lays the foundation for a multi-identity user experience where users can manage multiple Nostr keys with distinct profiles and easily switch between them.

## Problem Statement
Currently, Ostrilo provides secure key management and signing capabilities but lacks profile awareness:
- Users cannot view or edit their Nostr profile metadata (name, about, picture, website)
- The ProfileView component is a static placeholder with no real data
- Multiple keys are supported internally but there's no UI distinction between identities
- Profile information must be managed outside Ostrilo, creating friction
- No local caching of profile data from relays leads to repeated fetches

This creates a disconnected experience where users manage their identity in Ostrilo but must use other clients to set or view their profile.

## Proposed Solution
Add a complete profile metadata subsystem that:

1. **Fetches profiles from relays** - Query configured relays for kind:0 events matching managed public keys
2. **Caches locally with TTL** - Store profile metadata in local storage with configurable expiration (default 1 hour)
3. **Displays in ProfileView** - Show name, picture, about, website with fallback for missing data
4. **Enables profile editing** - Allow users to edit and publish profile updates directly from the extension
5. **Supports multi-identity UX** - Display which profile belongs to which key, enabling future key-switching features

### Key Components

**Domain Layer:**
- `ProfileMetadata` type (name, about, picture, website, nip05, lud16, etc.)
- `ProfileCache` type (metadata + pubkey + timestamp + TTL)

**Application Layer:**
- `ProfileService` - Core business logic for fetching, caching, and publishing profiles
- Port interface `INostrRelay` for relay communication (WebSocket abstraction)

**Infrastructure Layer:**
- `NostrRelayAdapter` - WebSocket-based relay client implementing filter subscriptions
- Storage adapter integration for profile cache persistence

**UI Layer:**
- Enhanced `ProfileView` with real metadata display and edit mode
- Profile editing form with validation
- Multi-key profile selector (foundation for future identity switching)

## Benefits
- **Unified identity management** - All identity operations in one place
- **Offline-first UX** - Cached profiles work without network
- **Multi-identity foundation** - Sets up infrastructure for key switching
- **Reduced relay traffic** - Smart caching minimizes redundant queries
- **User empowerment** - Direct profile control without external clients

## Scope
**In Scope:**
- NIP-01 kind:0 metadata fetch and publish
- Local cache with TTL-based invalidation
- ProfileView UI with display and edit modes
- Integration with existing relay configuration
- Basic multi-key profile awareness

**Out of Scope (Future Work):**
- NIP-05 verification display (separate feature)
- Advanced profile fields (banner, badges, etc.)
- Profile sync between devices
- Automated profile backup
- Key switching UI (foundation only)

## Dependencies
- Existing relay configuration in `AppSettingsV1.relays`
- Existing key management via `KeyVaultService`
- WebSocket support in browser extension environment

## Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Relay unavailability | Medium | Graceful degradation to cached data, timeout handling |
| Invalid profile JSON | Low | Zod schema validation, fallback to empty profile |
| Cache staleness | Low | Configurable TTL, manual refresh option |
| Storage quota | Low | Limit cache size, LRU eviction for old profiles |
| WebSocket in service worker | High | Use persistent connections, handle SW lifecycle properly |

## Success Criteria
- [ ] Users can view their profile metadata in ProfileView for any managed key
- [ ] Profile data is fetched from relays on first load and cached locally
- [ ] Cache TTL is respected and stale profiles are refetched
- [ ] Users can edit and publish profile updates that appear on other clients
- [ ] Multiple keys show distinct profile data (no cross-contamination)
- [ ] Offline mode works with cached profiles
- [ ] Relay failures degrade gracefully without breaking the UI

## Implementation Phases
**Phase 1: Core Infrastructure** (Week 1)
- Domain types and validation schemas
- `ProfileService` with fetch/cache logic
- `INostrRelay` port and `NostrRelayAdapter`

**Phase 2: UI Integration** (Week 2)
- ProfileView display mode with real data
- Loading and error states
- Manual refresh functionality

**Phase 3: Profile Editing** (Week 3)
- Edit mode with form validation
- Profile publish flow
- Optimistic UI updates

**Phase 4: Multi-Identity Foundation** (Week 4)
- Per-key profile display
- Profile cache per pubkey
- UI indicators for which key's profile is active

## Related Work
- **UX-002** in v2-prd.md (directly implements this requirement)
- **add-activity-log-persistence** (similar caching pattern)
- **nip07-provider** (relay integration pattern)

## Open Questions
1. Should profile cache be in `local` or `sync` storage? (Recommendation: `local` for performance)
2. Default TTL value? (Recommendation: 3600s / 1 hour)
3. Max cached profiles? (Recommendation: 50, LRU eviction)
4. Handle multiple kind:0 events per pubkey? (Recommendation: use most recent by `created_at`)

## Approval Requirements
- [ ] Architecture review (Hexagonal boundaries respected)
- [ ] Security review (no private key exposure in profile operations)
- [ ] UX review (ProfileView mockups/wireframes)
- [ ] Performance review (cache strategy, relay connection pooling)
