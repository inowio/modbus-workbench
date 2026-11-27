// App-wide register address display format (Dec/Hex). Browser localStorage,
// machine-local. Every accessor is defensive so a storage failure degrades to "dec".

import { useCallback, useEffect, useState } from "react";
import type { AddressFormat } from "./simulatorPrefs";

export type { AddressFormat };

export const APP_ADDRESS_FORMAT_KEY = "inowio.addressFormat";
const CHANGE_EVENT = "inowio:address-format";
const LEGACY_PREFIX = "inowio.simulator.addressFormat.";

function legacyHexExists(): boolean {
  const ls = window.localStorage;
  for (let i = 0; i < ls.length; i += 1) {
    const key = ls.key(i);
    if (key && key.startsWith(LEGACY_PREFIX) && ls.getItem(key) === "hex") return true;
  }
  return false;
}

export function readAppAddressFormat(): AddressFormat {
  try {
    const stored = window.localStorage.getItem(APP_ADDRESS_FORMAT_KEY);
    if (stored === "dec" || stored === "hex") return stored;
    // First run: inherit a per-workspace simulator preference if one chose hex.
    const initial: AddressFormat = legacyHexExists() ? "hex" : "dec";
    window.localStorage.setItem(APP_ADDRESS_FORMAT_KEY, initial);
    return initial;
  } catch {
    return "dec";
  }
}

export function writeAppAddressFormat(f: AddressFormat): void {
  try {
    window.localStorage.setItem(APP_ADDRESS_FORMAT_KEY, f);
  } catch {
    // best-effort persistence
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: f }));
}

export function useAppAddressFormat(): [AddressFormat, (f: AddressFormat) => void] {
  const [fmt, setFmt] = useState<AddressFormat>(() => readAppAddressFormat());

  useEffect(() => {
    const sync = () => setFmt(readAppAddressFormat());
    // Use the written value, not storage: it still holds for the session when storage throws.
    const onChange = (e: Event) => {
      const f = (e as CustomEvent<unknown>).detail;
      if (f === "dec" || f === "hex") setFmt(f);
      else sync();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === APP_ADDRESS_FORMAT_KEY) sync();
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const set = useCallback((f: AddressFormat) => {
    setFmt(f);
    writeAppAddressFormat(f);
  }, []);

  return [fmt, set];
}
