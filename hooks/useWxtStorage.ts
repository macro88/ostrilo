import { useState, useEffect, useCallback } from "react";
import { storage } from "#imports";

export function useWxtStorage<T>(key: StorageItemKey, defaultValue: T) {
  const [value, setValue] = useState<T | null>(defaultValue);

  useEffect(() => {
    storage.getItem<T>(key).then(setValue);
  }, [key, defaultValue]);

  // 2. Watch for changes to the key in storage from other parts of the extension.
  useEffect(() => {
    const unwatch = storage.watch<T>(key, (newValue) => {
      // When the storage changes, update the local state.
      // Fall back to defaultValue if the new value is null or undefined.
      setValue(newValue ?? defaultValue);
    });

    // The return function for cleanup must be synchronous.
    // We resolve the promise which gives the actual unwatch function.
    return () => {
      unwatch();
    };
  }, [key, defaultValue]);

  // 3. Create a setter function that updates both React state and extension storage.
  const setStoredValue = useCallback(
    (newValue: T | ((prevValue: T) => T)) => {
      // Use the functional update form of useState to avoid stale closures.
      setValue((currentValue) => {
        const valueToStore =
          newValue instanceof Function ? newValue(currentValue) : newValue;
        // Asynchronously set the item in storage.
        storage.setItem(key, valueToStore);
        // Return the new value to update the React state immediately.
        return valueToStore;
      });
    },
    [key]
  );

  return [value, setStoredValue] as const;
}
