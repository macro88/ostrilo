# Architecture Alignment Summary

## Hexagonal Architecture Compliance

This proposal strictly follows Ostrilo's hexagonal architecture principles established by Alistair Cockburn.

### Layer Separation

```
┌─────────────────────────────────────────────────────────────┐
│                      Extension UI                            │
│  (React Components: OptionsApp, Tabs, BasicSettings)        │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                 Application Layer                            │
│  ╔═══════════════════════════════════════════════════════╗  │
│  ║         SettingsSyncService (NEW)                     ║  │
│  ║  - filterSyncableSettings()                           ║  │
│  ║  - publishSettings()                                  ║  │
│  ║  - fetchSettings()                                    ║  │
│  ║  - mergeRemoteSettings()                              ║  │
│  ╚═══════════════════════════════════════════════════════╝  │
│                                                              │
│  Existing Services:                                          │
│  - SettingsService (local storage)                          │
│  - PolicyService (permissions)                              │
│  - KeyVaultService (key management)                         │
└─────────────────────────┬───────────────────────────────────┘
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
┌─────────────────────┐     ┌─────────────────────────┐
│  Domain Layer       │     │  Application Ports      │
│  ╔═══════════════╗  │     │  ╔════════════════════╗ │
│  ║ SyncableSettings║ │     │  ║ IRelayAdapter     ║ │
│  ║ (NEW Type)      ║ │     │  ║  - publish()      ║ │
│  ╚═══════════════╝  │     │  ║  - query()        ║ │
│                     │     │  ╚════════════════════╝ │
│  - AppSettingsV1    │     │                         │
│  - OriginPolicy     │     │  ║ IStorage          ║  │
│  - KeyRecord        │     │  ║ ICrypto           ║  │
└─────────────────────┘     └─────────────────────────┘
                                        │
                                        ▼
                          ┌─────────────────────────────┐
                          │  Infrastructure Layer       │
                          │  ╔════════════════════════╗ │
                          │  ║ SimpleRelayAdapter    ║ │
                          │  ║  (implements IRelay)  ║ │
                          │  ║  - uses nostr-tools   ║ │
                          │  ╚════════════════════════╝ │
                          │                             │
                          │  - ChromeStorageAdapter     │
                          │  - NobleCryptoAdapter       │
                          └─────────────────────────────┘
```

## Security Architecture

### Data Classification

**Tier 1: Never Leave Extension (Encrypted at Rest)**

- Private keys (AES-GCM encrypted in chrome.storage.local)
- Passwords (never stored, only used for PBKDF2)
- Encryption salts and IVs

**Tier 2: Local Only (Not Synced)**

- `selectedKeyId` - Device-specific key selection
- `origins` - Per-origin policies (privacy-sensitive)
- `onboardingCompleted` - Local state flags

**Tier 3: Syncable (Published to Nostr)**

- `theme`, `sidePanel` - UI preferences
- `autoLockMinutes`, `sessionTTLMinutes` - Security timeouts
- `mediumAllowKinds` - Trust level defaults
- `relays` - Relay list (public information)
- `maxActivityEntries` - Log retention

### Sync Security Guarantees

```typescript
// Strict allowlist enforcement
function filterSyncableSettings(settings: AppSettingsV1): SyncableSettings {
  // SECURITY: Explicitly list safe fields, reject all others
  return {
    theme: settings.theme,
    sidePanel: settings.sidePanel,
    autoLockMinutes: settings.autoLockMinutes,
    sessionTTLMinutes: settings.sessionTTLMinutes,
    maxActivityEntries: settings.maxActivityEntries,
    mediumAllowKinds: settings.mediumAllowKinds,
    relays: settings.relays,
    // Explicitly excluded:
    // - selectedKeyId (device-specific)
    // - origins (privacy leak)
    // - onboardingCompleted (local state)
  };
}
```

## Dependency Injection Pattern

Following hexagonal architecture, all services use constructor injection:

```typescript
// Application Service (Hexagon Core)
class SettingsSyncService {
  constructor(
    private storage: StorageSuite, // Port interface
    private relay: IRelayAdapter, // Port interface
    private crypto: ICryptoAdapter // Port interface
  ) {}
  // Service logic depends only on port interfaces, not concrete implementations
}

// Infrastructure Wiring (Adapters)
const storage = new ChromeStorageAdapter();
const relay = new SimpleRelayAdapter(["wss://relay.damus.io"]);
const crypto = new NobleCryptoAdapter();

const syncService = new SettingsSyncService(storage, relay, crypto);
```

Benefits:

- **Testability:** Mock adapters for unit tests
- **Flexibility:** Swap relay implementation without changing service
- **Isolation:** Business logic unaware of infrastructure details

## RPC Communication Pattern

Follows existing RPC architecture for background-to-UI communication:

```typescript
// UI sends RPC request
await browser.runtime.sendMessage({
  type: "settings.sync.enable",
});

// Background handles RPC
rpcRouter.handle("settings.sync.enable", async () => {
  await settingsSyncService.publishSettings(activePubkey);
  return { success: true };
});
```

## Testing Strategy by Layer

### Domain Layer Tests

- `filterSyncableSettings()` excludes sensitive fields
- `SyncableSettings` type validation

### Application Layer Tests

- `SettingsSyncService.publishSettings()` creates valid NIP-78 event
- `fetchSettings()` handles timeout
- `mergeRemoteSettings()` preserves local-only fields

### Infrastructure Layer Tests

- `SimpleRelayAdapter.publish()` sends to relays
- `query()` times out after 5 seconds
- Connection error handling

### E2E Tests

- Enable sync → publish → fetch on another device → merge
- Verify sensitive fields never in published event
- UI sync status updates correctly

## NIP-78 Event Format

```json
{
  "kind": 30078,
  "tags": [
    ["d", "ostrilo-settings-v1"],
    ["t", "ostrilo"]
  ],
  "content": "{\"theme\":\"dark\",\"autoLockMinutes\":15,...}",
  "created_at": 1703001234,
  "pubkey": "user-pubkey-hex",
  "sig": "schnorr-signature"
}
```

- **Addressable Event:** `d` tag allows replacement (only latest matters)
- **Public Content:** Settings safely publishable without privacy risk
- **Signed by User:** Verifies authenticity, prevents tampering
- **Time-Ordered:** Last-write-wins conflict resolution

## Privacy by Design

1. **Local-First:** Extension works fully offline, sync is optional
2. **Opt-In Only:** User must explicitly enable sync
3. **Transparent:** UI clearly shows what is synced
4. **Public-Safe:** Published events contain no private information
5. **Device Independence:** Each device maintains own key selection and policies

## Performance Characteristics

- **Non-Blocking Sync:** Relay operations timeout after 5 seconds, never block UI
- **Lazy Loading:** Options page tabs rendered on demand
- **Cross-Context Sync:** chrome.storage.onChanged provides instant updates
- **Debounced Mutations:** Slider changes debounced to prevent spam

## Compliance Checklist

✅ Follows hexagonal architecture (ports & adapters)  
✅ Domain layer has no infrastructure dependencies  
✅ Application services use dependency injection  
✅ Infrastructure adapters implement port interfaces  
✅ Sensitive data never synced (keys, passwords, origins)  
✅ Security boundaries enforced by strict allowlist  
✅ RPC pattern consistent with existing codebase  
✅ TypeScript strict mode compliance  
✅ Testing strategy covers all layers  
✅ NIP-78 event format validated  
✅ Privacy-safe by design (public event content)  
✅ Performance targets defined (timeouts, debouncing)
