import { useCallback, useRef, useSyncExternalStore } from "react";

import { liveRaw, liveValueText, liveWords } from "./scaling";

export type SnapshotRow = {
  unitId: number;
  functionCode: number;
  address: number;
  valueWord: number | null;
  valueBit: boolean | null;
  sourceStatus?: string | null;
};

export type SimValuesEvent = { workspace: string; full: boolean; rows: SnapshotRow[] };

export type LiveStore = {
  get(unitId: number, functionCode: number, address: number): SnapshotRow | undefined;
  apply(event: { full: boolean; rows: SnapshotRow[] }): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
  version(): number;
};

const key = (unitId: number, functionCode: number, address: number): number =>
  unitId * 16777216 + functionCode * 65536 + address;

const sameRow = (a: SnapshotRow, b: SnapshotRow): boolean =>
  a.valueWord === b.valueWord &&
  a.valueBit === b.valueBit &&
  (a.sourceStatus ?? null) === (b.sourceStatus ?? null);

/** Live register values keyed by (unit, fc, address); consumers subscribe via React hooks below. */
export function createLiveStore(): LiveStore {
  let map = new Map<number, SnapshotRow>();
  let ver = 0;
  const listeners = new Set<() => void>();

  const bump = () => {
    ver++;
    for (const l of [...listeners]) l();
  };

  const store: LiveStore = {
    // Arrow-style closure (no `this`) so `store.get` can be passed around as a lookup.
    get: (unitId, functionCode, address) => map.get(key(unitId, functionCode, address)),
    apply({ full, rows }) {
      let changed = false;
      if (full) {
        const next = new Map<number, SnapshotRow>();
        for (const r of rows) {
          const k = key(r.unitId, r.functionCode, r.address);
          const old = map.get(k);
          next.set(k, old && sameRow(old, r) ? old : r);
        }
        changed = next.size !== map.size;
        if (!changed) for (const [k, v] of next) if (map.get(k) !== v) { changed = true; break; }
        if (changed) map = next;
      } else {
        for (const r of rows) {
          const k = key(r.unitId, r.functionCode, r.address);
          const old = map.get(k);
          if (old && sameRow(old, r)) continue;
          map.set(k, r);
          changed = true;
        }
      }
      if (changed) bump();
    },
    clear() {
      if (map.size === 0) return;
      map = new Map();
      bump();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    version: () => ver,
  };
  return store;
}

type LiveRegister = Parameters<typeof liveRaw>[0];

export type LiveRegisterView = {
  text: string;
  raw: number | null;
  words: number[] | null;
  sourceStatus: string | null;
};

/** Scaled/decoded live text for one register; re-renders only when that text changes. */
export function useLiveText(store: LiveStore, reg: LiveRegister | null): string {
  const getSnapshot = () => (reg ? liveValueText(reg, store.get) : "—");
  return useSyncExternalStore(store.subscribe, getSnapshot);
}

const EMPTY_VIEW: LiveRegisterView = { text: "—", raw: null, words: null, sourceStatus: null };

function sameWords(a: number[] | null, b: number[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((w, i) => w === b[i]);
}

/** Decoded view of one register; the returned object is stable while its fields are unchanged. */
export function useLiveRegister(store: LiveStore, reg: LiveRegister | null): LiveRegisterView {
  const cache = useRef<LiveRegisterView>(EMPTY_VIEW);
  const getSnapshot = useCallback((): LiveRegisterView => {
    if (!reg) return EMPTY_VIEW;
    const next: LiveRegisterView = {
      text: liveValueText(reg, store.get),
      raw: liveRaw(reg, store.get),
      words: liveWords(reg, store.get),
      sourceStatus: store.get(reg.unitId, reg.functionCode, reg.address)?.sourceStatus ?? null,
    };
    const prev = cache.current;
    if (prev.text === next.text && Object.is(prev.raw, next.raw) && prev.sourceStatus === next.sourceStatus && sameWords(prev.words, next.words)) {
      return prev;
    }
    cache.current = next;
    return next;
  }, [store, reg]);
  return useSyncExternalStore(store.subscribe, getSnapshot);
}
