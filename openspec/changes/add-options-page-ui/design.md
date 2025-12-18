# Design: Options Page UI

## Architecture Overview

The Options Page follows a **multi-tab layout pattern** with shared state management. It reuses existing hooks and components from the popup while providing a full-page interface for complex settings.

```
┌─────────────────────────────────────────────────────────┐
│                    Options Page (Tab)                    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Header: Logo, Version, Close Button              │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Tab Navigation                                    │  │
│  │ [General] [Keys] [Security] [Permissions] ...    │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │                                                   │  │
│  │         Tab Content Area (Scrollable)            │  │
│  │                                                   │  │
│  │  - Reuses existing SettingsView components       │  │
│  │  - Full-width layouts with proper spacing        │  │
│  │  - Organized by logical sections                 │  │
│  │                                                   │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Footer: Save Status, Reset, Help                 │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Component Hierarchy

### New Components

```
src/extension/options/
├── index.html           # Options page HTML entrypoint
├── main.tsx            # React root for options page
├── OptionsApp.tsx      # Main options page component
└── style.css           # Options-specific styles

src/ui/features/settings/
├── components/
│   ├── SettingsView.tsx              # Existing (will be refactored)
│   ├── BasicSettings.tsx             # NEW: Minimal settings for popup
│   ├── GeneralSettingsTab.tsx        # NEW: Theme, side panel, etc.
│   ├── KeysIdentitiesTab.tsx         # NEW: Multi-key management
│   ├── SecuritySettingsTab.tsx       # NEW: Auto-lock, session TTL
│   ├── PermissionsTab.tsx            # NEW: Per-origin policies
│   ├── ActivityLogTab.tsx            # NEW: Log config
│   ├── RelaysTab.tsx                 # NEW: Relay management
│   └── AdvancedTab.tsx               # NEW: Medium kinds, debug
└── hooks/
    └── useSettingsTabs.ts            # NEW: Tab navigation state
```

### Refactored Popup

```tsx
// src/extension/popup/App.tsx
function PopupApp() {
  return (
    <MainApp>
      {/* Other views: Home, Profile, Activity */}
      {currentView === "settings" && <BasicSettings />}
    </MainApp>
  );
}
```

```tsx
// src/ui/features/settings/components/BasicSettings.tsx
export function BasicSettings() {
  return (
    <div className="p-4 space-y-4">
      {/* Active Key Selector */}
      <KeySelectorCard />

      {/* Theme Toggle */}
      <ThemeSelector />

      {/* Auto-lock Slider */}
      <AutoLockSlider />

      {/* Advanced Settings Button */}
      <Button onClick={() => browser.runtime.openOptionsPage()}>
        <Settings className="mr-2" />
        Advanced Settings
      </Button>
    </div>
  );
}
```

## Options Page Layout

### Tab Structure

```tsx
// src/extension/options/OptionsApp.tsx
export function OptionsApp() {
  const [activeTab, setActiveTab] = useState("general");

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/icon/128.png" alt="Ostrilo" className="w-8 h-8" />
            <h1 className="text-2xl font-bold">Ostrilo Settings</h1>
          </div>
          <div className="text-sm text-muted-foreground">v1.0.0</div>
        </div>
      </header>

      {/* Tab Navigation */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="border-b bg-card">
          <div className="container mx-auto px-6">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="keys">Keys & Identities</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
              <TabsTrigger value="permissions">Permissions</TabsTrigger>
              <TabsTrigger value="activity">Activity Log</TabsTrigger>
              <TabsTrigger value="relays">Relays</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>
          </div>
        </div>

        {/* Tab Content */}
        <div className="container mx-auto px-6 py-8 max-w-4xl">
          <TabsContent value="general">
            <GeneralSettingsTab />
          </TabsContent>
          <TabsContent value="keys">
            <KeysIdentitiesTab />
          </TabsContent>
          <TabsContent value="security">
            <SecuritySettingsTab />
          </TabsContent>
          <TabsContent value="permissions">
            <PermissionsTab />
          </TabsContent>
          <TabsContent value="activity">
            <ActivityLogTab />
          </TabsContent>
          <TabsContent value="relays">
            <RelaysTab />
          </TabsContent>
          <TabsContent value="advanced">
            <AdvancedTab />
          </TabsContent>
        </div>
      </Tabs>

      {/* Footer */}
      <footer className="border-t bg-card mt-auto">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Changes are saved automatically
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={resetSettings}>
                Reset All
              </Button>
              <Button variant="outline" onClick={exportSettings}>
                Export Settings
              </Button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
```

### Tab Content Breakdown

**1. General Tab**

- Theme selector (light/dark/system)
- Side panel toggle
- Language selector (future)
- Notification preferences (future)

**2. Keys & Identities Tab**

- Multi-key list with avatars and metadata
- Active key indicator
- Rename/delete actions
- Import key button
- Export key button (password-protected)
- Create new key button

**3. Security Tab**

- Auto-lock timer slider
- Session grant TTL slider
- Biometric unlock toggle (if available)
- Change password button
- Export private key (with warnings)
- Clear session grants button

**4. Permissions Tab**

- Per-origin policy table (sortable, filterable)
- Trust level dropdowns per origin
- Source badge (Official vs User)
- Per-kind rules inline editor
- Session grant toggles
- Remove origin actions

**5. Activity Log Tab**

- Max entries slider
- Export log button (JSON/CSV)
- Clear log button
- Log level filter (if implemented)
- Activity preview (last 10 entries)

**6. Relays Tab**

- Relay list with status indicators (connected/disconnected)
- Add relay input
- Remove relay buttons
- Test connection button per relay
- Relay stats (events sent/received)

**7. Advanced Tab**

- Medium trust auto-allow kinds toggles
- Experimental features flags
- Developer debug info
- Cache management
- Raw settings JSON viewer (dev mode)

## State Management

### Shared Hooks

Both popup BasicSettings and options page tabs use the same hooks:

```typescript
// src/ui/hooks/useAppSettings.ts
export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettingsV1>();

  // Auto-reload settings when changed in other contexts
  useEffect(() => {
    const listener = (changes: any) => {
      if (changes.appSettings) {
        setSettings(changes.appSettings.newValue);
      }
    };

    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  // ... mutation methods
}
```

### Cross-Context Sync

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│   Popup     │         │ chrome.storage   │         │   Options   │
│             │         │                  │         │    Page     │
│ BasicSettings├────────►│  sync/local     │◄────────┤  Full UI    │
│             │ mutate  │                  │ mutate  │             │
│             │         │                  │         │             │
│             │◄────────┤  onChanged       ├────────►│             │
│             │ listen  │  events          │ listen  │             │
└─────────────┘         └──────────────────┘         └─────────────┘
```

When settings change in either context:

1. Mutation updates chrome.storage
2. chrome.storage.onChanged fires
3. Both popup and options page receive update
4. UI re-renders with new values

## Settings Sync Architecture (Hexagonal)

### Service Layer

Following Ostrilo's hexagonal architecture, settings sync is implemented as an application service that orchestrates domain logic and infrastructure adapters.

```typescript
// src/application/services/settings-sync.service.ts
export class SettingsSyncService {
  constructor(
    private storage: StorageSuite,
    private relay: IRelayAdapter,
    private crypto: ICryptoAdapter
  ) {}

  async publishSettings(pubkey: string): Promise<NostrEvent | null> {
    const settings = await this.storage.sync.get<AppSettingsV1>("appSettings");
    const syncable = this.filterSyncableSettings(settings);

    // Create NIP-78 event
    const event = {
      kind: 30078,
      tags: [
        ["d", "ostrilo-settings-v1"],
        ["t", "ostrilo"],
      ],
      content: JSON.stringify(syncable),
      created_at: Math.floor(Date.now() / 1000),
    };

    const signed = await this.crypto.signEvent(event);
    await this.relay.publish(signed, { timeout: 5000 });

    return signed;
  }

  async fetchSettings(pubkey: string): Promise<SyncableSettings | null> {
    const filter = {
      kinds: [30078],
      authors: [pubkey],
      "#d": ["ostrilo-settings-v1"],
      limit: 1,
    };

    const events = await this.relay.query(filter, { timeout: 5000 });
    if (!events.length) return null;

    const latest = events[0];
    return JSON.parse(latest.content) as SyncableSettings;
  }

  private filterSyncableSettings(settings: AppSettingsV1): SyncableSettings {
    // SECURITY: Only sync non-sensitive fields
    return {
      theme: settings.theme,
      sidePanel: settings.sidePanel,
      autoLockMinutes: settings.autoLockMinutes,
      sessionTTLMinutes: settings.sessionTTLMinutes,
      maxActivityEntries: settings.maxActivityEntries,
      mediumAllowKinds: settings.mediumAllowKinds,
      relays: settings.relays,
      // NEVER sync: selectedKeyId, origins (per-origin policies)
    };
  }

  async mergeRemoteSettings(remote: SyncableSettings): Promise<void> {
    const local = await this.storage.sync.get<AppSettingsV1>("appSettings");

    // Last-write-wins: use remote if newer
    const merged: AppSettingsV1 = {
      ...local!,
      ...remote,
      // Preserve local-only fields
      selectedKeyId: local!.selectedKeyId,
      origins: local!.origins,
      __version: "settings.v1",
    };

    await this.storage.sync.set("appSettings", merged);
  }
}
```

### Domain Types

```typescript
// src/domain/types.ts
export interface SyncableSettings {
  theme: Theme;
  sidePanel: boolean;
  autoLockMinutes: number;
  sessionTTLMinutes: number;
  maxActivityEntries: number;
  mediumAllowKinds: number[];
  relays: string[];
  // Explicitly excludes: selectedKeyId, origins, onboarding flags
}

export interface SettingsSyncState {
  enabled: boolean;
  lastSyncedAt?: number; // epoch seconds
  lastPublishedAt?: number;
  syncInProgress: boolean;
  syncError?: string;
}
```

### Relay Port Interface

```typescript
// src/application/ports/relay.ts
export interface IRelayAdapter {
  publish(event: NostrEvent, options?: RelayOptions): Promise<void>;
  query(filter: NostrFilter, options?: RelayOptions): Promise<NostrEvent[]>;
  connect(urls: string[]): Promise<void>;
  disconnect(): Promise<void>;
}

export interface RelayOptions {
  timeout?: number; // milliseconds
  requiredRelays?: number; // min relays that must succeed
}
```

### Infrastructure Adapter

```typescript
// src/infrastructure/relay/simple-relay-adapter.ts
export class SimpleRelayAdapter implements IRelayAdapter {
  private pool: SimplePool;

  constructor(relayUrls: string[]) {
    this.pool = new SimplePool();
  }

  async publish(event: NostrEvent, options?: RelayOptions): Promise<void> {
    const timeout = options?.timeout ?? 5000;
    const pubs = this.pool.publish(this.relayUrls, event);

    await Promise.race([
      Promise.all(pubs),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Publish timeout")), timeout)
      ),
    ]);
  }

  async query(
    filter: NostrFilter,
    options?: RelayOptions
  ): Promise<NostrEvent[]> {
    const timeout = options?.timeout ?? 5000;
    const events: NostrEvent[] = [];

    return new Promise((resolve, reject) => {
      const sub = this.pool.sub(this.relayUrls, [filter]);
      const timer = setTimeout(() => {
        sub.unsub();
        resolve(events);
      }, timeout);

      sub.on("event", (event) => events.push(event));
      sub.on("eose", () => {
        clearTimeout(timer);
        sub.unsub();
        resolve(events);
      });
    });
  }
}
```

### Security Guarantees

**Syncable Fields (Safe):**

- `theme`, `sidePanel` - UI preferences
- `autoLockMinutes`, `sessionTTLMinutes` - Timeout settings
- `maxActivityEntries` - Log retention
- `mediumAllowKinds` - Trust level defaults
- `relays` - Relay list (public information)

**Non-Syncable Fields (Sensitive):**

- `selectedKeyId` - Device-specific key selection
- `origins` - Per-origin policies (privacy leak)
- `onboardingCompleted` - Local state only
- Private keys (never in settings)
- Passwords (never in settings)

### Sync Flow Diagram

```
┌─────────────────┐                    ┌──────────────────┐
│  Options Page   │                    │  Device B        │
│                 │                    │  (Another Install)│
└────────┬────────┘                    └────────▲─────────┘
         │                                      │
         │ 1. User enables sync                 │
         │                                      │
         ▼                                      │
┌─────────────────────────┐                    │
│ SettingsSyncService     │                    │
│  - filterSyncable()     │                    │
│  - publishSettings()    │                    │
└────────┬────────────────┘                    │
         │                                      │
         │ 2. Create NIP-78 event               │
         │    (kind: 30078)                     │
         ▼                                      │
┌─────────────────────────┐                    │
│ SimpleRelayAdapter      │                    │
│  - publish()            │───────────────────►│
└────────┬────────────────┘  3. Publish event  │
         │                                      │
         │                                      │
         ▼                                      │
┌─────────────────────────┐                    │
│ Nostr Relays            │                    │
│ - relay.damus.io        │◄───────────────────┤
│ - relay.primal.net      │  4. Fetch event    │
└─────────────────────────┘                    │
                                                │
                                                │
                                       5. Merge settings
```

### UI Components for Sync

```tsx
// src/ui/features/settings/components/GeneralSettingsTab.tsx
export function GeneralSettingsTab() {
  const { syncState, enableSync, disableSync, syncNow } = useSettingsSync();

  return (
    <div className="space-y-8">
      {/* Existing theme/sidepanel settings */}

      <section>
        <h2 className="text-lg font-semibold mb-4">Settings Sync</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Sync settings across devices</Label>
              <p className="text-sm text-muted-foreground">
                Non-sensitive settings will be published to Nostr relays
              </p>
            </div>
            <Switch
              checked={syncState.enabled}
              onCheckedChange={(checked) =>
                checked ? enableSync() : disableSync()
              }
            />
          </div>

          {syncState.enabled && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Last synced: {formatTimestamp(syncState.lastSyncedAt)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={syncNow}
                  disabled={syncState.syncInProgress}
                >
                  {syncState.syncInProgress ? "Syncing..." : "Sync Now"}
                </Button>
              </div>

              {syncState.syncError && (
                <Alert variant="destructive">
                  <AlertTitle>Sync Error</AlertTitle>
                  <AlertDescription>{syncState.syncError}</AlertDescription>
                </Alert>
              )}

              <Alert>
                <InfoIcon className="h-4 w-4" />
                <AlertDescription>
                  Only non-sensitive settings are synced. Private keys,
                  passwords, and per-origin policies remain local.
                </AlertDescription>
              </Alert>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
```

### Sync Hook

```typescript
// src/ui/hooks/useSettingsSync.ts
export function useSettingsSync() {
  const [syncState, setSyncState] = useState<SettingsSyncState>({
    enabled: false,
    syncInProgress: false,
  });

  const enableSync = useCallback(async () => {
    try {
      // Enable sync and publish current settings
      await browser.runtime.sendMessage({
        type: "settings.sync.enable",
      });
      setSyncState((prev) => ({ ...prev, enabled: true }));
    } catch (error) {
      console.error("Failed to enable sync:", error);
    }
  }, []);

  const disableSync = useCallback(async () => {
    await browser.runtime.sendMessage({
      type: "settings.sync.disable",
    });
    setSyncState((prev) => ({ ...prev, enabled: false }));
  }, []);

  const syncNow = useCallback(async () => {
    setSyncState((prev) => ({
      ...prev,
      syncInProgress: true,
      syncError: undefined,
    }));
    try {
      const result = await browser.runtime.sendMessage({
        type: "settings.sync.now",
      });
      setSyncState((prev) => ({
        ...prev,
        syncInProgress: false,
        lastSyncedAt: Date.now() / 1000,
      }));
    } catch (error) {
      setSyncState((prev) => ({
        ...prev,
        syncInProgress: false,
        syncError: error.message,
      }));
    }
  }, []);

  return { syncState, enableSync, disableSync, syncNow };
}
```

## WXT Configuration

### Manifest Changes

```typescript
// wxt.config.ts
export default defineConfig({
  manifest: {
    permissions: ["storage", "sidePanel", "windows"],
    // Add options page declaration
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
  },
});
```

### Entrypoint Structure

```
src/extension/
├── background.ts
├── content.ts
├── injected.ts
├── popup/
│   ├── index.html
│   ├── main.tsx
│   └── App.tsx
├── sidepanel/
│   ├── index.html
│   ├── main.tsx
│   └── App.tsx
└── options/           # NEW
    ├── index.html     # NEW
    ├── main.tsx       # NEW
    ├── OptionsApp.tsx # NEW
    └── style.css      # NEW
```

WXT automatically detects `options/` folder and generates the entrypoint.

## Component Extraction Strategy

### Phase 1: Extract Reusable Components

Extract from existing SettingsView into shared components:

```typescript
// src/ui/features/settings/components/shared/
├── KeySelectorCard.tsx        # Active key display + switch
├── ThemeSelector.tsx          # Theme dropdown
├── AutoLockSlider.tsx         # Auto-lock timer
├── SessionTTLSlider.tsx       # Session grant timeout
├── RelayList.tsx              # Relay management
├── ActivityLogConfig.tsx      # Log settings
├── OriginPolicyTable.tsx      # Per-origin policies
└── MediumKindToggles.tsx      # Medium trust kinds
```

### Phase 2: Compose Tab Components

Use extracted components to build tabs:

```tsx
// src/ui/features/settings/components/GeneralSettingsTab.tsx
export function GeneralSettingsTab() {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold mb-4">Appearance</h2>
        <ThemeSelector />
        <SidePanelToggle />
      </section>
    </div>
  );
}
```

### Phase 3: Build BasicSettings for Popup

Minimal settings using extracted components:

```tsx
// src/ui/features/settings/components/BasicSettings.tsx
export function BasicSettings() {
  return (
    <div className="p-3 space-y-4">
      <KeySelectorCard />
      <ThemeSelector />
      <AutoLockSlider />

      <Separator />

      <Button
        variant="outline"
        className="w-full"
        onClick={() => browser.runtime.openOptionsPage()}
      >
        <Settings className="mr-2 h-4 w-4" />
        Advanced Settings
      </Button>
    </div>
  );
}
```

## Responsive Design

### Breakpoints

- **Mobile (< 640px):** Not primary target (extensions typically desktop)
- **Tablet (640px - 1024px):** Stack tabs vertically, reduce padding
- **Desktop (> 1024px):** Full layout with horizontal tabs

### Container Width

```css
.container {
  max-width: 1200px; /* Don't make options page too wide */
  margin: 0 auto;
  padding: 0 1.5rem;
}

.tab-content {
  max-width: 800px; /* Optimal reading width for forms */
}
```

## Performance Considerations

1. **Lazy Tab Loading:** Only render active tab content
2. **Component Memoization:** Memo expensive settings sections
3. **Debounced Mutations:** Slider changes debounced by 300ms
4. **Virtualized Lists:** If origin policy list grows beyond 50 items

```tsx
// Lazy tab content rendering
<TabsContent value="permissions">
  {activeTab === "permissions" && <PermissionsTab />}
</TabsContent>
```

## Testing Strategy

### Unit Tests

- Each tab component renders correctly
- Shared components accept props
- Settings mutations propagate to hooks

### Integration Tests

- Options page loads from popup button click
- Settings sync between popup and options
- Tab navigation works correctly

### E2E Tests

1. **Open Options Page**

   - Click "Advanced Settings" in popup
   - Options page opens in new tab
   - Active tab is "General"

2. **Change Settings in Options**

   - Change theme in options page
   - Close options page
   - Open popup
   - Verify theme applied in popup

3. **Change Settings in Popup**

   - Change auto-lock in popup
   - Open options page
   - Verify auto-lock value matches in Security tab

4. **Navigation**
   - Click through all tabs
   - Each tab loads without errors
   - Back button works as expected

## Migration Path

### Phase 1: Extract Components (No UX Change)

- Extract shared components from SettingsView
- Keep SettingsView using extracted components
- Test that popup settings still work

### Phase 2: Create Options Page

- Build options page with tab layout
- Add "Advanced Settings" button to popup
- Options page uses extracted components

### Phase 3: Refactor Popup Settings

- Replace SettingsView with BasicSettings in popup
- Move advanced settings to options page only
- Test full workflow

### Phase 4: Polish

- Add keyboard shortcuts
- Add settings search
- Improve tab transitions
- Add export/import

## Security Considerations

1. **No Sensitive Data in Options Page URL:** Options page should not accept URL params with sensitive data
2. **Same Security Context:** Options page has same permissions as popup (no additional risks)
3. **State Isolation:** Options page state is isolated from web page context
4. **Password Prompts:** Export key actions still require password confirmation
5. **Sync Boundaries:** Only whitelisted fields are syncable via Nostr (NEVER keys, passwords, origins)
6. **Event Verification:** Published settings events are signed by user's active key
7. **Fetch Timeout:** Relay queries timeout after 5 seconds to prevent blocking
8. **Privacy Protection:** Per-origin policies never synced (prevent tracking across devices)
9. **Local-First:** Extension functions fully without sync enabled
10. **Conflict Resolution:** Last-write-wins with timestamp, no automatic merge conflicts

## Accessibility

- **Tab Navigation:** Keyboard arrow keys navigate between tabs
- **ARIA Labels:** Proper labels for all form controls
- **Focus Management:** Focus restored to last focused element when switching tabs
- **Screen Reader Support:** Announce tab changes
- **High Contrast:** Settings UI works in high contrast mode

## Future Enhancements (Out of Scope)

1. Settings search bar
2. Settings import/export to file
3. Sync settings via Nostr (NIP-78)
4. Settings backup/restore
5. Keyboard shortcuts configuration
6. Multiple language support
7. Settings diff viewer (compare to defaults)
