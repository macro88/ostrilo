# Design: Profile Metadata Management

## Architecture Overview

This design follows Ostrilo's Hexagonal Architecture, introducing a new `ProfileService` in the application layer with clean port boundaries for relay communication.

### Layer Responsibilities

```
┌─────────────────────────────────────────────────────────────┐
│                        UI Layer                             │
│  ProfileView, ProfileEditForm, ProfileSelector             │
│  useProfile hook, useProfileCache hook                     │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ↓ (RPC calls)
┌─────────────────────────────────────────────────────────────┐
│                   Application Layer                         │
│  ProfileService (fetch, cache, publish, validate)          │
│  Port: INostrRelay (subscribe, publish, close)             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ↓ (implements ports)
┌─────────────────────────────────────────────────────────────┐
│                  Infrastructure Layer                       │
│  NostrRelayAdapter (WebSocket client)                      │
│  ProfileCacheAdapter (storage.local wrapper)               │
└─────────────────────────────────────────────────────────────┘
```

## Domain Model

### ProfileMetadata Type
Per NIP-01 kind:0 event content:

```typescript
export interface ProfileMetadata {
  name?: string;           // Display name
  about?: string;          // Bio/description
  picture?: string;        // Avatar URL
  banner?: string;         // Header image URL
  website?: string;        // Personal website
  nip05?: string;          // NIP-05 identifier (user@domain.com)
  lud16?: string;          // Lightning address (user@domain.com)
  lud06?: string;          // LNURL (deprecated, for backward compat)
  display_name?: string;   // Alternative to 'name'
}

export interface ProfileCacheEntry {
  pubkey: string;                    // Hex public key
  metadata: ProfileMetadata;         // Parsed profile content
  fetchedAt: number;                 // Epoch seconds
  ttl: number;                       // Seconds until expiration
  eventId?: string;                  // Most recent kind:0 event ID
  createdAt?: number;                // Event created_at timestamp
}
```

### Validation Rules
- All profile fields are optional
- URLs (picture, banner, website) must pass basic URL validation
- `nip05` and `lud16` must follow email-like format
- Max field lengths:
  - `name`: 50 characters
  - `about`: 500 characters
  - URLs: 2048 characters

## ProfileService Design

### Responsibilities
1. **Fetch** - Query relays for kind:0 events by pubkey
2. **Cache** - Store and retrieve profiles from local storage
3. **Validate** - Ensure profile data meets schema requirements
4. **Publish** - Sign and broadcast profile updates to relays
5. **Expire** - Honor TTL and refresh stale cache entries

### Key Methods

```typescript
class ProfileService {
  constructor(
    private storage: StorageSuite,
    private relay: INostrRelay,
    private vault: KeyVaultService
  ) {}

  // Fetch profile for a pubkey (uses cache if valid)
  async getProfile(pubkey: string, forceFetch = false): Promise<ProfileMetadata | null>

  // Get all cached profiles for managed keys
  async getAllProfiles(): Promise<Map<string, ProfileMetadata>>

  // Update and publish profile for current key
  async updateProfile(metadata: ProfileMetadata): Promise<void>

  // Manually refresh profile from relays
  async refreshProfile(pubkey: string): Promise<ProfileMetadata | null>

  // Clear cache for a specific pubkey
  async clearCache(pubkey: string): Promise<void>

  // Clear all cached profiles
  async clearAllCache(): Promise<void>
}
```

### Caching Strategy

**Cache Key:** `profileCache:{pubkey}`

**Cache Flow:**
```
getProfile(pubkey)
  ├─→ Check cache for pubkey
  ├─→ If exists and not expired → return cached
  ├─→ If missing or expired:
  │     ├─→ Query relay with filter {kinds: [0], authors: [pubkey]}
  │     ├─→ Wait for EOSE or timeout (5s)
  │     ├─→ Select most recent event by created_at
  │     ├─→ Parse JSON content, validate with Zod
  │     ├─→ Store in cache with fetchedAt + TTL
  │     └─→ Return metadata
  └─→ On error → return cached (even if expired) or null
```

**Cache Eviction:**
- TTL-based: Default 3600s (1 hour)
- LRU-based: Keep max 50 profiles, evict oldest by `fetchedAt`
- Manual: User can force refresh

## INostrRelay Port

Abstract interface for Nostr relay communication:

```typescript
export interface NostrRelayFilter {
  kinds?: number[];
  authors?: string[];
  ids?: string[];
  since?: number;
  until?: number;
  limit?: number;
  [key: string]: any;  // Allow custom filters
}

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface INostrRelay {
  // Subscribe to events matching filter
  subscribe(
    filter: NostrRelayFilter,
    onEvent: (event: NostrEvent) => void,
    onEOSE?: () => void
  ): Promise<string>; // Returns subscription ID

  // Publish an event
  publish(event: NostrEvent): Promise<void>;

  // Close a subscription
  close(subId: string): Promise<void>;

  // Disconnect from relay
  disconnect(): Promise<void>;
}
```

## NostrRelayAdapter Implementation

WebSocket-based relay client:

```typescript
class NostrRelayAdapter implements INostrRelay {
  private ws: WebSocket | null = null;
  private subscriptions = new Map<string, {
    filter: NostrRelayFilter;
    onEvent: (event: NostrEvent) => void;
    onEOSE?: () => void;
  }>();

  constructor(private relayUrl: string) {}

  async connect(): Promise<void> {
    // Establish WebSocket connection
    // Handle reconnection logic
    // Register message handlers
  }

  async subscribe(filter, onEvent, onEOSE): Promise<string> {
    const subId = crypto.randomUUID();
    this.subscriptions.set(subId, { filter, onEvent, onEOSE });
    
    // Send REQ message: ["REQ", subId, filter]
    this.send(["REQ", subId, filter]);
    
    return subId;
  }

  async publish(event): Promise<void> {
    // Send EVENT message: ["EVENT", event]
    // Wait for OK response or timeout
  }

  // Handle incoming messages
  private onMessage(data: string): void {
    const msg = JSON.parse(data);
    if (msg[0] === "EVENT") {
      const [_, subId, event] = msg;
      const sub = this.subscriptions.get(subId);
      if (sub) sub.onEvent(event);
    } else if (msg[0] === "EOSE") {
      const [_, subId] = msg;
      const sub = this.subscriptions.get(subId);
      if (sub?.onEOSE) sub.onEOSE();
    }
    // Handle OK, NOTICE, etc.
  }
}
```

## Relay Connection Management

### Strategy: Connection Pooling
- Maintain single WebSocket per relay URL
- Reuse connection across multiple subscriptions
- Auto-reconnect on disconnect with exponential backoff
- Lazy connect: Only establish WS when needed

### Service Worker Considerations
Chrome MV3 service workers can be terminated:
- Store active subscriptions in memory
- On service worker restart, re-establish connections
- Use persistent alarms to keep SW alive during long-running fetches

### Timeout Handling
- Profile fetch timeout: 5 seconds after subscription
- If EOSE not received, treat as complete and use events received so far
- On timeout, still cache partial results to avoid repeated failures

## Profile Publishing Flow

```
User edits profile in ProfileView
  ↓
ProfileService.updateProfile(metadata)
  ↓
1. Validate metadata with Zod schema
2. Get current selected key from KeyVaultService
3. Construct unsigned kind:0 event:
   {
     kind: 0,
     content: JSON.stringify(metadata),
     tags: [],
     created_at: Math.floor(Date.now() / 1000)
   }
4. Sign event via KeyVaultService.signEvent()
5. Publish to all configured relays via INostrRelay.publish()
6. Update local cache optimistically
7. Emit success/error to UI
```

## Multi-Identity Support

### Current Implementation
- `KeyVaultService` already supports multiple keys
- `AppSettingsV1.selectedKeyId` tracks active key
- Each key has unique `pubkey` identifier

### Profile Integration
- Cache profiles keyed by `pubkey`
- ProfileView shows profile for `selectedKeyId`
- Future: Add key switcher dropdown
  - On switch, update `selectedKeyId` in settings
  - Reload ProfileView with new key's profile
  - Sign events with new key

### UI Indicators
- Display current key's pubkey (truncated) in ProfileView header
- Show avatar from profile metadata next to key selector
- Highlight active key in future multi-key list

## Error Handling

### Relay Errors
- **Connection failed:** Fallback to cache, show offline indicator
- **Timeout:** Use partial results, show warning
- **Invalid event:** Log error, skip event, continue processing
- **Publish failed:** Retry once, then surface error to user

### Validation Errors
- **Invalid JSON in kind:0 content:** Treat as empty profile
- **Schema mismatch:** Use partial data, log warning
- **Invalid URLs:** Sanitize or omit field

### Cache Errors
- **Storage quota exceeded:** Evict oldest profiles, log warning
- **Corrupted cache:** Clear cache, refetch

## Performance Considerations

### Bundle Size
- Add `nostr-tools` or similar (if needed): ~50KB gzipped
- Alternative: Minimal WebSocket implementation: ~5KB
- Recommendation: Custom minimal implementation to avoid bloat

### Network Efficiency
- Batch profile fetches for multiple keys (single REQ with multiple authors)
- Limit relay queries: Only query on first load or manual refresh
- Use EOSE to close subscriptions promptly

### Storage Efficiency
- Profiles are small (~1-2KB each)
- Max 50 cached profiles = ~100KB total
- Use compression for large `about` fields if needed

## Testing Strategy

### Unit Tests
- `ProfileService` logic (fetch, cache, validate, publish)
- Cache expiration and eviction
- Profile metadata schema validation
- Edge cases: empty profiles, missing fields

### Integration Tests
- `NostrRelayAdapter` WebSocket communication
- End-to-end profile fetch and cache flow
- Multi-relay handling (parallel queries)

### E2E Tests (Playwright)
- User views profile (cached and fresh fetch)
- User edits and publishes profile
- Profile updates appear correctly
- Offline mode with cached profiles

## Security Considerations

### Profile Content
- Sanitize URLs to prevent XSS (use URL constructor validation)
- Limit field lengths to prevent DoS
- Do not trust profile content for auth/security decisions

### Relay Communication
- Use WSS (secure WebSocket) for relay connections
- Validate all incoming events against Zod schemas
- Never expose private keys in relay messages

### Privacy
- Profile fetches reveal which pubkeys user manages (to relays)
- Consider option to disable auto-fetch for privacy-sensitive users
- Cache reduces relay queries, improving privacy

## Migration Path

### Phase 1: Core Infrastructure
No breaking changes. Adds new services and types.

### Phase 2: UI Integration
Replace static ProfileView with dynamic version. Backward compatible.

### Phase 3: Multi-Identity
Future enhancement. Requires key switcher UI (separate proposal).

## Alternative Approaches Considered

### 1. Use nostr-tools Library
**Pros:** Battle-tested, full NIP support  
**Cons:** Large bundle size (~50KB), overkill for just kind:0  
**Decision:** Custom minimal implementation for profile-only use case

### 2. Fetch Profiles on Every Load
**Pros:** Always fresh data  
**Cons:** Slow, wastes bandwidth, poor offline support  
**Decision:** Smart caching with TTL

### 3. Store Profiles in Sync Storage
**Pros:** Cross-device sync  
**Cons:** Size limits, sync conflicts, slower  
**Decision:** Local storage with future sync option

## Open Design Questions

1. **Should we support profile history?** (Store previous versions)
   - **Recommendation:** No, only store most recent. Future enhancement if needed.

2. **Handle multiple kind:0 events from different relays?**
   - **Recommendation:** Use most recent by `created_at`, regardless of relay.

3. **Relay selection strategy?** (Query all or just first responsive)
   - **Recommendation:** Query all configured relays in parallel, merge results, use newest.

4. **Cache invalidation on publish?**
   - **Recommendation:** Yes, optimistically update cache after successful publish.

5. **Support editing profile for non-selected keys?**
   - **Recommendation:** Phase 4 feature. Initially only edit selected key's profile.
