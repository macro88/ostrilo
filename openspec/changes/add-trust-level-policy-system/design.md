# Design: Trust Level Policy System

## Architecture Overview

The Trust Level Policy System introduces a new layer on top of the existing per-kind rules system. It follows the **Strategy Pattern** for policy resolution and the **Chain of Responsibility Pattern** for source priority.

```
┌─────────────────────────────────────────────────────────────┐
│                   Policy Resolution Flow                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │ evaluatePolicy() │
                    └──────────────────┘
                              │
                  ┌───────────┴───────────┐
                  │                       │
                  ▼                       ▼
         ┌────────────────┐      ┌────────────────┐
         │ Explicit Rules │      │  Trust Level   │
         │   (Per-Kind)   │      │  Resolution    │
         └────────────────┘      └────────────────┘
                  │                       │
                  │              ┌────────┴────────┐
                  │              ▼                 ▼
                  │      ┌─────────────┐   ┌──────────────┐
                  │      │  autoSign   │   │ requirePrompt│
                  │      │   kinds     │   │    kinds     │
                  │      └─────────────┘   └──────────────┘
                  │              │                 │
                  └──────────────┴─────────────────┘
                                 │
                                 ▼
                          ┌──────────────┐
                          │ Final Auth   │
                          │ Decision     │
                          └──────────────┘
```

## Core Data Structures

### Trust Definitions (Hardcoded)

```typescript
// src/domain/policy/trust-definitions.ts
export const TRUST_DEFINITIONS = {
  low: {
    autoSign: [],
  },
  medium: {
    autoSign: [3, 7, 10000, 10002, 22242],
  },
  high: {
    autoSign: [0, 3, 6, 7, 1984, 10000, 10002, 22242, 30023],
  },
} as const;

// Critical guardrails - NEVER auto-sign these
export const PROTECTED_KINDS = [1, 9734] as const;
```

### NIP-78 Policy Event

```typescript
// NIP-78 format
{
  "kind": 30078,
  "tags": [
    ["d", "https://primal.net"],        // dApp origin
    ["t", "ostrilo-policy"]             // Filter tag
  ],
  "content": "{\"trustLevel\": \"high\", \"updatedAt\": 1709230000}",
  "pubkey": "official-ostrilo-pubkey-hex",
  "sig": "..."
}
```

### Policy Cache Entry

```typescript
interface PolicyCacheEntry {
  origin: string;
  trustLevel: TrustLevel;
  source: "official" | "user";
  fetchedAt: number;
  expiresAt: number;
  event?: NostrEvent; // Full NIP-78 event for verification
}

// Stored in chrome.storage.local
{
  "policyCache": {
    "https://primal.net": { ... },
    "https://snort.social": { ... }
  }
}
```

## Policy Resolution Algorithm

### Step-by-Step Flow

```typescript
async function resolveTrustLevel(
  origin: string,
  settings: AppSettingsV1
): Promise<TrustLevel> {
  // 1. Global Override
  if (settings.globalTrustOverride) {
    return settings.globalTrustLevel;
  }

  // 2. User-Specific Override
  const userPolicy = settings.origins.find((p) => p.origin === origin);
  if (userPolicy?.trustLevelSource === "user") {
    return userPolicy.trustLevel;
  }

  // 3. Official Ostrilo Directory
  const cached = await loadPolicyCache(origin);
  if (cached && cached.source === "official" && !isExpired(cached)) {
    return cached.trustLevel;
  }

  // 4. Background fetch (if cache miss or expired)
  if (!cached || isExpired(cached)) {
    fetchOfficialPolicyInBackground(origin); // Don't block
  }

  // 5. Fallback
  return "low";
}
```

### Integration with Existing evaluatePolicy

```typescript
// src/domain/policy/evaluate.ts (modified)
export function evaluatePolicy(input: PolicyInput): PolicyOutput {
  const { origin, kind, unlocked, policies, trustLevel } = input;

  if (!unlocked) return { mode: "deny", reason: "locked" };

  const policy = policies.find((p) => p.origin === origin);

  // 1. Explicit deny always wins
  if (policy?.rules?.[kind] === "deny") {
    return { mode: "deny", reason: "rule" };
  }

  // 2. Protected kinds (NEVER auto-sign)
  if (PROTECTED_KINDS.includes(kind)) {
    return { mode: "ask", reason: "protected" };
  }

  // 3. Session grant
  if (policy?.sessionGrantAll) {
    return { mode: "allow", reason: "session" };
  }

  // 4. Explicit allow/ask rule
  if (policy?.rules?.[kind]) {
    return { mode: policy.rules[kind], reason: "rule" };
  }

  // 5. Trust level auto-sign
  const autoSignKinds = TRUST_DEFINITIONS[trustLevel].autoSign;
  if (autoSignKinds.includes(kind)) {
    return { mode: "allow", reason: "trust" };
  }

  // 6. Fallback to ask
  return { mode: "ask", reason: "trust" };
}
```

## Service Layer Changes

### New: PolicyFetchService

```typescript
// src/application/services/policy-fetch.service.ts
export class PolicyFetchService {
  private relays = ["wss://relay.damus.io", "wss://nos.lol"];
  private officialPubkey = "official-ostrilo-pubkey-hex";
  private timeout = 2000; // 2 seconds

  async fetchOfficialPolicy(origin: string): Promise<PolicyCacheEntry | null> {
    const filter = {
      kinds: [30078],
      authors: [this.officialPubkey],
      "#d": [origin],
      "#t": ["ostrilo-policy"],
    };

    const event = await this.queryRelays(filter, this.timeout);
    if (!event) return null;

    // Verify signature
    if (!verifySignature(event)) return null;

    const content = JSON.parse(event.content);
    const now = Date.now();

    return {
      origin,
      trustLevel: content.trustLevel,
      source: "official",
      fetchedAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000, // 24 hours
      event,
    };
  }

  private async queryRelays(filter: any, timeout: number): Promise<any> {
    // Simple-pool or manual WebSocket implementation
    // Return first matching event or null after timeout
  }
}
```

### Modified: PolicyService

```typescript
// src/application/services/policy.service.ts (additions)
export class PolicyService {
  constructor(
    private storage: StorageSuite,
    private policyFetch: PolicyFetchService
  ) {}

  async resolveTrustLevel(origin: string): Promise<TrustLevel> {
    const settings = await this.getSettings();

    // Step 1: Global override
    if (settings.globalTrustOverride) {
      return settings.globalTrustLevel;
    }

    // Step 2: User override
    const policy = settings.origins.find((p) => p.origin === origin);
    if (policy?.trustLevelSource === "user") {
      return policy.trustLevel;
    }

    // Step 3: Official cache
    const cache = await this.loadPolicyCache();
    const cached = cache[origin];
    if (cached?.source === "official" && Date.now() < cached.expiresAt) {
      return cached.trustLevel;
    }

    // Step 4: Background fetch
    if (!cached || Date.now() >= cached.expiresAt) {
      this.backgroundFetchOfficial(origin); // Fire and forget
    }

    // Step 5: Fallback
    return "low";
  }

  private async backgroundFetchOfficial(origin: string): Promise<void> {
    try {
      const entry = await this.policyFetch.fetchOfficialPolicy(origin);
      if (entry) {
        await this.updatePolicyCache(origin, entry);
      }
    } catch (err) {
      console.warn(`Failed to fetch official policy for ${origin}:`, err);
    }
  }
}
```

## UI/UX Changes

### Settings View

**New Section: "Global Trust Settings"**

```tsx
<div className="space-y-4">
  <div className="flex items-center justify-between">
    <Label>Enable Global Trust Level</Label>
    <Switch
      checked={settings.globalTrustOverride}
      onCheckedChange={(checked) => updateGlobalTrustOverride(checked)}
    />
  </div>

  {settings.globalTrustOverride && (
    <div className="space-y-2">
      <Label>Default Trust for All Apps</Label>
      <Select value={settings.globalTrustLevel} onValueChange={setGlobalLevel}>
        <SelectItem value="low">Low - Ask for Everything</SelectItem>
        <SelectItem value="medium">Medium - Allow Interactions</SelectItem>
        <SelectItem value="high">High - Maximum Convenience</SelectItem>
      </Select>

      {settings.globalTrustLevel === "high" && (
        <Alert variant="warning">
          <AlertTitle>Warning</AlertTitle>
          <AlertDescription>
            This will auto-approve most actions on all websites. Notes and Zaps
            will still require approval.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )}
</div>
```

**DApp List with Trust Levels**

```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Domain</TableHead>
      <TableHead>Trust Level</TableHead>
      <TableHead>Source</TableHead>
      <TableHead>Actions</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {origins.map((origin) => (
      <TableRow key={origin.origin}>
        <TableCell>{origin.origin}</TableCell>
        <TableCell>
          <Select
            value={origin.trustLevel}
            onValueChange={(level) => updateOriginTrust(origin.origin, level)}
          >
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
          </Select>
        </TableCell>
        <TableCell>
          <Badge
            variant={
              origin.trustLevelSource === "official" ? "default" : "secondary"
            }
          >
            {origin.trustLevelSource === "official" ? "Official" : "User"}
          </Badge>
        </TableCell>
        <TableCell>...</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

### Connection Popup

```tsx
<Dialog>
  <DialogHeader>
    <DialogTitle>Connect to {origin}?</DialogTitle>
  </DialogHeader>

  {officialTrustLevel && (
    <Alert>
      <ShieldCheck className="h-4 w-4" />
      <AlertTitle>
        Official Trust Level: {officialTrustLevel.toUpperCase()}
      </AlertTitle>
      <AlertDescription>
        Ostrilo has verified this application as {officialTrustLevel} trust.
      </AlertDescription>
    </Alert>
  )}

  <div className="space-y-2">
    <Label>Trust Level for this App</Label>
    <Select value={selectedTrustLevel} onValueChange={setSelectedTrustLevel}>
      <SelectItem value="low">Low - Ask Everything</SelectItem>
      <SelectItem value="medium">Medium - Allow Interactions</SelectItem>
      <SelectItem value="high">High - Maximum Convenience</SelectItem>
    </Select>
  </div>

  <DialogFooter>
    <Button variant="outline" onClick={onCancel}>
      Cancel
    </Button>
    <Button onClick={onConnect}>Connect</Button>
  </DialogFooter>
</Dialog>
```

## Security Considerations

### Protected Kinds Enforcement

```typescript
// Enforce at multiple layers
// 1. In evaluatePolicy (primary)
if (PROTECTED_KINDS.includes(kind)) {
  return { mode: "ask", reason: "protected" };
}

// 2. In RPC handler (secondary guardrail)
if ([1, 9734].includes(event.kind)) {
  // Force prompt regardless of policy
  return await showApprovalDialog(event);
}

// 3. In UI (tertiary - user education)
<Alert variant="warning">
  <AlertTitle>Protected Event Types</AlertTitle>
  <AlertDescription>
    Text Notes (kind 1) and Zap Requests (kind 9734) always require manual
    approval for security.
  </AlertDescription>
</Alert>;
```

### Signature Verification

```typescript
function verifyOfficialPolicy(event: NostrEvent): boolean {
  // 1. Verify event signature
  if (!verifySignature(event)) return false;

  // 2. Verify author is official Ostrilo pubkey
  if (event.pubkey !== OFFICIAL_OSTRILO_PUBKEY) return false;

  // 3. Verify content is valid JSON
  try {
    const content = JSON.parse(event.content);
    if (!["low", "medium", "high"].includes(content.trustLevel)) {
      return false;
    }
  } catch {
    return false;
  }

  return true;
}
```

## Performance Considerations

1. **Cache-First:** Always serve from cache if available and valid
2. **Background Fetch:** Network requests never block policy evaluation
3. **Stale-While-Revalidate:** Use expired cache while fetching fresh data
4. **Timeout:** 2-second hard limit on relay queries
5. **Local Priority:** Global and user overrides bypass network entirely

## Testing Strategy

1. **Unit Tests:**

   - Trust level resolution priority
   - Protected kinds enforcement
   - Cache expiration logic
   - Signature verification

2. **Integration Tests:**

   - Policy fetch from relays
   - Cache persistence across restarts
   - Settings mutations

3. **E2E Tests:**

   - User sets global trust level
   - User overrides specific dApp
   - Official policy loads on first connection
   - Protected kinds always prompt

4. **Security Tests:**
   - Kind 1 never auto-signed
   - Kind 9734 never auto-signed
   - Invalid signatures rejected
   - Unauthorized pubkeys ignored
