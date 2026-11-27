import { useEffect, useRef, useState } from "react";

import type { LiveStore } from "./liveValues";
import { engFromRaw, liveRaw, registerScaling } from "./scaling";

type LiveRegister = Parameters<typeof liveRaw>[0];

const SAMPLE_MS = 100;

/**
 * Rolling history of a register's live engineering value (or 0/1 for bits),
 * sampled every 100 ms while the register's row exists in the store. Reading
 * the store on a timer (not per store change) keeps the chart's time base
 * steady for idle registers and independent of unrelated registers' traffic.
 * Resets when the register or anything that changes how its value is decoded
 * changes, and when the row disappears (e.g. the store is cleared on Stop).
 */
export function useValueHistory(store: LiveStore, reg: LiveRegister | null, cap = 60): number[] {
  const [history, setHistory] = useState<number[]>([]);
  const regRef = useRef(reg);
  regRef.current = reg;

  const resetKey = reg
    ? [reg.unitId, reg.functionCode, reg.address, reg.dataType, reg.byteOrder ?? "", reg.scale ?? "", reg.scaleOffset ?? ""].join(":")
    : null;

  useEffect(() => {
    setHistory((h) => (h.length ? [] : h));
    if (resetKey === null) return;
    let buffer: number[] = [];
    const sample = () => {
      const r = regRef.current;
      if (!r) return;
      const row = store.get(r.unitId, r.functionCode, r.address);
      if (!row) {
        if (buffer.length) {
          buffer = [];
          setHistory([]);
        }
        return;
      }
      let value: number | null = null;
      if (row.valueBit !== null && row.valueBit !== undefined) {
        value = row.valueBit ? 1 : 0;
      } else {
        const raw = liveRaw(r, store.get);
        if (raw !== null) {
          const sc = registerScaling(r);
          value = engFromRaw(raw, sc.scale, sc.offset);
        }
      }
      if (value === null) return;
      buffer = [...buffer, value];
      if (buffer.length > cap) buffer.splice(0, buffer.length - cap);
      setHistory(buffer);
    };
    const id = setInterval(sample, SAMPLE_MS);
    return () => clearInterval(id);
  }, [store, resetKey, cap]);

  return history;
}
