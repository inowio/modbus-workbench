import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createLiveStore, useLiveRegister, useLiveText, type LiveStore, type SnapshotRow } from "./liveValues";

const row = (address: number, valueWord: number | null, o: Partial<SnapshotRow> = {}): SnapshotRow => ({
  unitId: 1, functionCode: 3, address, valueWord, valueBit: null, ...o,
});

describe("createLiveStore", () => {
  it("apply full replaces, delta merges", () => {
    const s = createLiveStore();
    s.apply({ full: true, rows: [row(0, 1), row(1, 2)] });
    s.apply({ full: false, rows: [row(1, 3)] });
    expect(s.get(1, 3, 0)?.valueWord).toBe(1);
    expect(s.get(1, 3, 1)?.valueWord).toBe(3);
    s.apply({ full: true, rows: [row(1, 3)] });
    expect(s.get(1, 3, 0)).toBeUndefined();
  });

  it("unchanged rows keep identity and do not notify", () => {
    const s = createLiveStore();
    s.apply({ full: true, rows: [row(0, 1)] });
    const a = s.get(1, 3, 0);
    const v = s.version();
    const l = vi.fn();
    s.subscribe(l);
    s.apply({ full: false, rows: [row(0, 1)] });
    expect(s.get(1, 3, 0)).toBe(a);
    expect(l).not.toHaveBeenCalled();
    expect(s.version()).toBe(v);
  });

  it("clear empties and notifies", () => {
    const s = createLiveStore();
    s.apply({ full: true, rows: [row(0, 1)] });
    const l = vi.fn();
    s.subscribe(l);
    s.clear();
    expect(s.get(1, 3, 0)).toBeUndefined();
    expect(l).toHaveBeenCalledTimes(1);
    s.clear();
    expect(l).toHaveBeenCalledTimes(1);
  });

  it("a full empty event clears", () => {
    const s = createLiveStore();
    s.apply({ full: true, rows: [row(0, 1)] });
    s.apply({ full: true, rows: [] });
    expect(s.get(1, 3, 0)).toBeUndefined();
  });
});

describe("hooks", () => {
  const regA = { unitId: 1, functionCode: 3, address: 0, dataType: "u16" };
  const regB = { unitId: 1, functionCode: 3, address: 1, dataType: "u16" };

  it("only the changed register's subscriber re-renders", () => {
    const s = createLiveStore();
    s.apply({ full: true, rows: [row(0, 1), row(1, 2)] });
    const renders = { A: 0, B: 0 };
    function H({ id, reg, store }: { id: "A" | "B"; reg: typeof regA; store: LiveStore }) {
      renders[id]++;
      return <span>{useLiveText(store, reg)}</span>;
    }
    const { container } = render(<><H id="A" reg={regA} store={s} /><H id="B" reg={regB} store={s} /></>);
    const a0 = renders.A, b0 = renders.B;
    act(() => s.apply({ full: false, rows: [row(0, 5)] }));
    expect(renders.A).toBe(a0 + 1);
    expect(renders.B).toBe(b0);
    expect(container.textContent).toBe("52");
  });

  it("useLiveRegister decodes a scaled value and exposes raw words", () => {
    const s = createLiveStore();
    const reg = { unitId: 1, functionCode: 3, address: 0, dataType: "u16", scale: 0.1, unit: "°C", decimals: 1 };
    s.apply({ full: true, rows: [row(0, 235)] });
    const { result, rerender } = renderHook(() => useLiveRegister(s, reg));
    expect(result.current).toEqual({ text: "23.5 °C", raw: 235, words: [235], sourceStatus: null });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("useLiveRegister decodes an f32 ABCD register", () => {
    const s = createLiveStore();
    const reg = { unitId: 1, functionCode: 3, address: 0, dataType: "f32", byteOrder: "ABCD", scale: 1 };
    s.apply({ full: true, rows: [row(0, 0x420e), row(1, 0x0000, { sourceStatus: "ok" })] });
    const { result } = renderHook(() => useLiveRegister(s, reg));
    expect(result.current.raw).toBe(35.5);
    expect(result.current.words).toEqual([0x420e, 0]);
    expect(result.current.text).toBe("35.5");
  });

  it("useLiveRegister stays stable when the raw value is NaN", () => {
    const s = createLiveStore();
    const reg = { unitId: 1, functionCode: 3, address: 0, dataType: "f32", byteOrder: "ABCD" };
    s.apply({ full: true, rows: [row(0, 0x7fc0), row(1, 0)] });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, rerender } = renderHook(() => useLiveRegister(s, reg));
    const first = result.current;
    expect(Number.isNaN(first.raw)).toBe(true);
    rerender();
    expect(result.current).toBe(first);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("null register yields a dash", () => {
    const s = createLiveStore();
    const { result } = renderHook(() => useLiveRegister(s, null));
    expect(result.current).toEqual({ text: "—", raw: null, words: null, sourceStatus: null });
  });
});
