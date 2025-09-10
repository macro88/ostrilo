import { useState, useEffect, useCallback } from "react";
import { browser } from "wxt/browser";

export function useWxtStorage<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(defaultValue);

  // Get initial value from storage
  useEffect(() => {
    browser.storage.sync.get([key]).then((result) => {
      if (result[key] !== undefined) {
        setValue(result[key]);
      }
    });
  }, [key]);

  // Watch for changes
  useEffect(() => {
    const onChanged = (changes: { [key: string]: any }) => {
      if (key in changes) {
        setValue(changes[key].newValue ?? defaultValue);
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
