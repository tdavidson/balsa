"use client";

import { useSyncExternalStore } from "react";

/** A choice remembered per browser. Server renders the fallback; the client reads storage on hydration. */
const storageListeners = new Set<() => void>();
function subscribeStorage(listener: () => void) {
  storageListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { storageListeners.delete(listener); window.removeEventListener("storage", listener); };
}
function readStored(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeStored(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  storageListeners.forEach((listener) => listener());
}
export function useStoredChoice(key: string, fallback: string, allowed: (value: string) => boolean) {
  const stored = useSyncExternalStore(subscribeStorage, () => readStored(key), () => null);
  const value = stored && allowed(stored) ? stored : fallback;
  return [value, (next: string) => writeStored(key, next)] as const;
}
