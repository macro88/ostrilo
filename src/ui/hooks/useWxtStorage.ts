import { useCallback, useSyncExternalStore } from "react";
import browser from "webextension-polyfill";

// Module-level storage cache and subscriber registry
type Subscriber = () => void;
const subscribers = new Map<string, Set<Subscriber>>();
const cache = new Map<string, unknown>();
const hasValue = new Set<string>();
const ready = new Set<string>();
const initPromises = new Map<string, Promise<void>>();
const defaultCache = new Map<string, unknown>();

// Debounced write management to respect storage.sync quotas
const writeTimers = new Map<string, number>();
const pendingValues = new Map<string, unknown>();
const pendingPromises = new Map<string, Promise<void>>();
const pendingResolvers = new Map<
  string,
  { resolve: () => void; reject: (e: unknown) => void }
>();

function notify(key: string) {
  const subs = subscribers.get(key);
  if (subs) subs.forEach((fn) => fn());
}

function ensureInitialized(key: string) {
  if (ready.has(key) || initPromises.has(key)) return;
  const p = browser.storage.sync
    .get([key])
    .then((result: Record<string, unknown>) => {
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        cache.set(key, result[key]);
        hasValue.add(key);
      } else {
        cache.delete(key);
        hasValue.delete(key);
      }
      ready.add(key);
      notify(key);
    })
    .catch(() => {
      // If we fail to load, mark ready so hook can fall back to default
      ready.add(key);
      notify(key);
    })
    .finally(() => {
      initPromises.delete(key);
    });
  initPromises.set(key, p);
}

// Single global listener to propagate external storage changes
let storageListenerAttached = false;
function attachGlobalListener() {
  if (storageListenerAttached) return;
  browser.storage.onChanged.addListener(
    (
      changes: Record<string, browser.Storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "sync") return;
      for (const k of Object.keys(changes)) {
        // Only update for keys that have subscribers to avoid unnecessary churn
        if (!subscribers.has(k)) continue;
        const change = changes[k];
        if (change.newValue === undefined) {
          cache.delete(k);
          hasValue.delete(k);
        } else {
          cache.set(k, change.newValue as unknown);
          hasValue.add(k);
        }
        ready.add(k);
        notify(k);
      }
    }
  );
  storageListenerAttached = true;
}

function subscribeKey(key: string, callback: Subscriber) {
  attachGlobalListener();
  let set = subscribers.get(key);
  if (!set) {
    set = new Set();
    subscribers.set(key, set);
  }
  set.add(callback);

  // Lazily initialize from storage on first subscription
  ensureInitialized(key);

  return () => {
    set!.delete(callback);
    if (set!.size === 0) {
      subscribers.delete(key);
      // A queued write is a user decision: it still flushes and settles its
      // promise after the last consumer unmounts, and needs its cached value.
      if (pendingPromises.has(key)) return;
      cache.delete(key);
      hasValue.delete(key);
      ready.delete(key);
      defaultCache.delete(key);
    }
  };
}

async function flushWrite(k: string) {
  const t = writeTimers.get(k);
  if (t !== undefined) {
    clearTimeout(t);
    writeTimers.delete(k);
  }
  const valueToStore = pendingValues.get(k);
  const resolver = pendingResolvers.get(k);
  try {
    await browser.storage.sync.set({ [k]: valueToStore });
    pendingValues.delete(k);
    resolver?.resolve();
  } catch (error) {
    // Roll back by reloading from storage to ensure consistency
    try {
      const result = await browser.storage.sync.get([k]);
      if (Object.prototype.hasOwnProperty.call(result, k)) {
        cache.set(k, result[k] as unknown);
        hasValue.add(k);
      } else {
        cache.delete(k);
        hasValue.delete(k);
      }
      ready.add(k);
      notify(k);
    } finally {
      resolver?.reject(error);
    }
  } finally {
    pendingPromises.delete(k);
    pendingResolvers.delete(k);
  }
}

export function useWxtStorage<T>(key: string, defaultValue: T) {
  // Must be stable: React resubscribes whenever `subscribe` changes identity, and
  // a lone consumer's resubscribe would pass through zero subscribers and wipe
  // the cache and any queued write.
  const subscribe = useCallback(
    (cb: Subscriber) => subscribeKey(key, cb),
    [key]
  );

  // Value snapshot with stable identity (returns cached reference or the same defaultValue reference)
  const value = useSyncExternalStore(
    subscribe,
    () =>
      hasValue.has(key)
        ? (cache.get(key) as T)
        : (defaultCache.has(key) || defaultCache.set(key, defaultValue),
          defaultCache.get(key) as T),
    () => defaultValue
  );

  // Ready flag snapshot as a primitive boolean
  const isReady = useSyncExternalStore(
    subscribe,
    () => ready.has(key),
    () => true
  );

  // Helper to schedule a debounced write and return a shared promise
  const scheduleWrite = useCallback(async (): Promise<void> => {
    // Reuse existing pending promise if present
    const existing = pendingPromises.get(key);
    if (existing) {
      // Reset timer to push the batch window
      const t = writeTimers.get(key);
      if (t !== undefined) {
        clearTimeout(t);
      }
      const newTimer = setTimeout(async () => {
        await flushWrite(key);
      }, 100);
      writeTimers.set(key, newTimer as unknown as number);
      return existing;
    }

    const p = new Promise<void>((resolve, reject) => {
      pendingResolvers.set(key, { resolve, reject });
    });
    pendingPromises.set(key, p);
    const timer = setTimeout(async () => {
      await flushWrite(key);
    }, 100);
    writeTimers.set(key, timer as unknown as number);
    return p;
  }, [key]);

  // Setter writes to storage and updates cache optimistically
  const setStoredValue = useCallback(
    async (newValue: T | ((prevValue: T) => T)) => {
      const previous = hasValue.has(key) ? (cache.get(key) as T) : defaultValue;
      const valueToStore =
        typeof newValue === "function"
          ? (newValue as (prev: T) => T)(previous)
          : newValue;

      // Optimistic local update
      cache.set(key, valueToStore as unknown);
      hasValue.add(key);
      ready.add(key);
      notify(key);

      // Queue debounced write and await completion
      pendingValues.set(key, valueToStore as unknown);
      await scheduleWrite();
    },
    [key, defaultValue, scheduleWrite]
  );

  return [value, setStoredValue, isReady] as const;
}
