import { act, renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { createLiveStore, type SnapshotRow } from "./liveValues";
import { useValueHistory } from "./useValueHistory";

const reg = (o: Record<string, unknown> = {}) => ({
  unitId: 1, functionCode: 3, address: 5, dataType: "u16", byteOrder: "ABCD", ...o,
});
const row = (valueWord: number | null, o: Partial<SnapshotRow> = {}): SnapshotRow => ({
  unitId: 1, functionCode: 3, address: 5, valueWord, valueBit: null, ...o,
});

describe("useValueHistory", () => {
  it("records engineering values, one point per store change", () => {
    const store = createLiveStore();
    const r = reg({ scale: 0.1 });
    const { result } = renderHook(() => useValueHistory(store, r));
    expect(result.current).toEqual([]);
    act(() => store.apply({ full: false, rows: [row(235)] }));
    expect(result.current).toEqual([23.5]);
    act(() => store.apply({ full: false, rows: [row(240)] }));
    expect(result.current).toEqual([23.5, 24]);
  });

  it("records 0/1 for bit registers", () => {
    const store = createLiveStore();
    const r = reg({ unitId: 2, functionCode: 1, address: 0 });
    const { result } = renderHook(() => useValueHistory(store, r));
    act(() => store.apply({ full: false, rows: [{ unitId: 2, functionCode: 1, address: 0, valueWord: null, valueBit: true }] }));
    act(() => store.apply({ full: false, rows: [{ unitId: 2, functionCode: 1, address: 0, valueWord: null, valueBit: false }] }));
    expect(result.current).toEqual([1, 0]);
  });

  it("skips changes while the register has no row or no value", () => {
    const store = createLiveStore();
    const r = reg();
    const { result } = renderHook(() => useValueHistory(store, r));
    act(() => store.apply({ full: false, rows: [row(null)] }));
    act(() => store.apply({ full: false, rows: [{ ...row(1), address: 9 }] }));
    expect(result.current).toEqual([]);
  });

  it("caps the history at cap", () => {
    const store = createLiveStore();
    const r = reg();
    const { result } = renderHook(() => useValueHistory(store, r, 3));
    for (const v of [1, 2, 3, 4, 5]) act(() => store.apply({ full: false, rows: [row(v)] }));
    expect(result.current).toEqual([3, 4, 5]);
  });

  it("resets when the register changes", () => {
    const store = createLiveStore();
    store.apply({ full: true, rows: [row(1), { ...row(100), address: 6 }] });
    const a = reg();
    const b = reg({ address: 6 });
    const { result, rerender } = renderHook(({ r }) => useValueHistory(store, r), { initialProps: { r: a } });
    act(() => store.apply({ full: false, rows: [row(2)] }));
    expect(result.current).toEqual([1, 2]);
    rerender({ r: b });
    expect(result.current).toEqual([100]);
  });

  it("resets when scale, offset, data type or byte order change", () => {
    const store = createLiveStore();
    store.apply({ full: true, rows: [row(10)] });
    const { result, rerender } = renderHook(({ r }) => useValueHistory(store, r), { initialProps: { r: reg() } });
    expect(result.current).toEqual([10]);
    rerender({ r: reg({ scale: 0.5 }) });
    expect(result.current).toEqual([5]);
    rerender({ r: reg({ scale: 0.5, scaleOffset: 1 }) });
    expect(result.current).toEqual([6]);
    rerender({ r: reg({ scale: 0.5, scaleOffset: 1, byteOrder: "BADC" }) });
    expect(result.current).toHaveLength(1);
    rerender({ r: reg({ scale: 0.5, scaleOffset: 1, byteOrder: "BADC", dataType: "i16" }) });
    expect(result.current).toHaveLength(1);
  });

  it("returns an empty history when reg is null", () => {
    const store = createLiveStore();
    const { result } = renderHook(() => useValueHistory(store, null));
    act(() => store.apply({ full: false, rows: [row(1)] }));
    expect(result.current).toEqual([]);
  });
});
