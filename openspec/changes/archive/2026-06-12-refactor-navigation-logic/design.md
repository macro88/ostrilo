# Design: Refactor Navigation Logic

## Architecture

### Shared Constants
A new file `src/domain/events.ts` will house system-wide event constants. This ensures that event names are defined in one place and reused across the extension (background script, UI, content scripts).

```typescript
// src/domain/events.ts
export const BROADCAST_EVENTS = {
  SWITCH_TO_ACTIVITY: "ostrilo.switchToActivity",
  QUEUE_UPDATED: "ostrilo.queue.updated",
} as const;
```

### Custom Hook: `useAppNavigation`
The navigation logic currently residing in `MainApp.tsx` will be moved to `src/ui/hooks/useAppNavigation.ts`. This hook will:
- Manage the `activeTab` state.
- Set up and tear down the `browser.runtime.onMessage` listener for navigation events.
- Handle the specific logic for `SWITCH_TO_ACTIVITY`.

```typescript
// src/ui/hooks/useAppNavigation.ts
export function useAppNavigation(initialTab: TabKey = "home") {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  // ... useEffect for listener ...
  return { activeTab, setActiveTab };
}
```

### Component Integration
`MainApp.tsx` will be simplified to use this hook, removing the direct dependency on `browser.runtime` and the imperative event handling logic.

## Trade-offs
- **Complexity**: Adds a new file and a new hook for a relatively simple piece of logic. However, this pays off by preventing `MainApp.tsx` from becoming a "god component" and avoids magic string duplication.
