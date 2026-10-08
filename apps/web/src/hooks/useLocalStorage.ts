import { useCallback, useEffect, useState } from "react";

/**
 * Persisted UI preference (e.g. list/grid view). Reads localStorage lazily and
 * writes back on change, tolerating browsers where storage is unavailable.
 */
export function useLocalStorage<T extends string>(
  key: string,
  fallback: T,
  isValid?: (value: string) => value is T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null && (isValid === undefined || isValid(stored))) return stored as T;
    } catch {
      // storage unavailable — fall through to the default
    }
    return fallback;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // storage unavailable — preference applies for this session only
    }
  }, [key, value]);

  const update = useCallback((next: T) => setValue(next), []);
  return [value, update];
}
