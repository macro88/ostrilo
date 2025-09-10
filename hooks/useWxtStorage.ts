import { useState, useEffect, useCallback } from "react";
import browser from "webextension-polyfill";

export function useWxtStorage<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(defaultValue);

  // Get initial value from storage
  useEffect(() => {
    browser.storage.sync.get([key]).then((result: Record<string, any>) => {
      if (result[key] !== undefined) {
        setValue(result[key]);
      }
    });
  }, [key]);

  // Watch for changes
  useEffect(() => {
    const onChanged = (changes: Record<string, browser.Storage.StorageChange>) => {
      if (key in changes) {
        const newValue = changes[key].newValue;
        setValue((newValue !== undefined && newValue !== null) ? newValue as T : defaultValue);
      }
    };

    browser.storage.onChanged.addListener(onChanged);
    return () => {
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, [key, defaultValue]);

  // Setter
  const setStoredValue = useCallback(
    (newValue: T | ((prevValue: T) => T)) => {
      setValue((currentValue) => {
        const valueToStore =
          newValue instanceof Function ? newValue(currentValue) : newValue;
        browser.storage.sync.set({ [key]: valueToStore });
        return valueToStore;
      });
    },
    [key]
  );

  return [value, setStoredValue] as const;
}
