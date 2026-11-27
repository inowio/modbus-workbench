import { useEffect, useRef, useState } from "react";

import type { LiveStore } from "./liveValues";
import { engFromRaw, liveRaw, registerScaling } from "./scaling";

type LiveRegister = Parameters<typeof liveRaw>[0];

/**
 * Rolling history of a register's live engineering value (or 0/1 for bits),
 * one point per store change while the register's row exists. Resets when the
 * register or anything that changes how its value is decoded changes.
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
    const record = () => {
      const r = regRef.current;
      if (!r) return;
      const row = store.get(r.unitId, r.functionCode, r.address);
      if (!row) return;
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
    record();
    return store.subscribe(record);
  }, [store, resetKey, cap]);

  return history;
}
