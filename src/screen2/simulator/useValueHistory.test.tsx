import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createLiveStore, type SnapshotRow } from "./liveValues";
import { useValueHistory } from "./useValueHistory";

const reg = (o: Record<string, unknown> = {}) => ({
  unitId: 1, functionCode: 3, address: 5, dataType: "u16", byteOrder: "ABCD", ...o,
});
const row = (valueWord: number | null, o: Partial<SnapshotRow> = {}): SnapshotRow => ({
  unitId: 1, functionCode: 3, address: 5, valueWord, valueBit: null, ...o,
});
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("useValueHistory", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("samples an idle register every 100 ms so a flat line still draws", () => {
    const store = createLiveStore();
    store.apply({ full: true, rows: [row(7)] });
    const r = reg();
    const { result } = renderHook(() => useValueHistory(store, r));
    tick(300);
    expect(result.current.length).toBeGreaterThanOrEqual(2);
    expect(new Set(result.current)).toEqual(new Set([7]));
  });

  it("records engineering values", () => {
    const store = createLiveStore();
    store.apply({ full: true, rows: [row(235)] });
    const r = reg({ scale: 0.1 });
    const { result } = renderHook(() => useValueHistory(store, r));
    tick(100);
    expect(result.current[result.current.length - 1]).toBeCloseTo(23.5);
    act(() => store.apply({ full: false, rows: [row(240)] }));
    tick(100);
    expect(result.current[result.current.length - 1]).toBeCloseTo(24);
  });

  it("records 0/1 for bit registers", () => {
    const store = createLiveStore();
    const bit = (valueBit: boolean): SnapshotRow => ({ unitId: 2, functionCode: 1, address: 0, valueWord: null, valueBit });
    store.apply({ full: true, rows: [bit(true)] });
    const r = reg({ unitId: 2, functionCode: 1, address: 0 });
    const { result } = renderHook(() => useValueHistory(store, r));
    tick(100);
    act(() => store.apply({ full: false, rows: [bit(false)] }));
    tick(100);
    expect(result.current[result.current.length - 1]).toBe(0);
    expect(new Set(result.current)).toEqual(new Set([1, 0]));
  });

  it("does not record while the register has no row or no value", () => {
    const store = createLiveStore();
    const r = reg();
    const { result } = renderHook(() => useValueHistory(store, r));
    tick(300);
    act(() => store.apply({ full: false, rows: [{ ...row(1), address: 9 }] }));
    tick(300);
    act(() => store.apply({ full: false, rows: [row(null)] }));
    tick(300);
    expect(result.current).toEqual([]);
  });

  it("caps the history at cap", () => {
    const store = createLiveStore();
    store.apply({ full: true, rows: [row(1)] });
    const { result } = renderHook(() => useValueHistory(store, reg(), 3));
    for (const v of [2, 3, 4, 5]) {
      act(() => store.apply({ full: false, rows: [row(v)] }));
      tick(100);
    }
    expect(result.current).toEqual([3, 4, 5]);
  });

  it("resets when the register changes", () => {
    const store = createLiveStore();
    store.apply({ full: true, rows: [row(1), { ...row(100), address: 6 }] });
    const a = reg();
    const b = reg({ address: 6 });
    const { result, rerender } = renderHook(({ r }) => useValueHistory(store, r), { initialProps: { r: a } });
    tick(200);
    expect(new Set(result.current)).toEqual(new Set([1]));
    rerender({ r: b });
    tick(100);
    expect(result.current.length).toBeGreaterThanOrEqual(1);
    expect(new Set(result.current)).toEqual(new Set([100]));
  });

  it("resets when scale, offset, data type or byte order change", () => {
    const store = createLiveStore();
    store.apply({ full: true, rows: [row(10)] });
    const { result, rerender } = renderHook(({ r }) => useValueHistory(store, r), { initialProps: { r: reg() } });
    tick(100);
    expect(result.current).toEqual([10]);
    rerender({ r: reg({ scale: 0.5 }) });
    tick(100);
    expect(new Set(result.current)).toEqual(new Set([5]));
    rerender({ r: reg({ scale: 0.5, scaleOffset: 1 }) });
    tick(100);
    expect(new Set(result.current)).toEqual(new Set([6]));
    const n = result.current.length;
    rerender({ r: reg({ scale: 0.5, scaleOffset: 1, byteOrder: "BADC" }) });
    tick(100);
    expect(result.current.length).toBeLessThanOrEqual(n);
    rerender({ r: reg({ scale: 0.5, scaleOffset: 1, byteOrder: "BADC", dataType: "i16" }) });
    tick(100);
    expect(result.current).toHaveLength(1);
  });

  it("empties when the store is cleared and grows again after a new full event", () => {
    const store = createLiveStore();
    store.apply({ full: true, rows: [row(7)] });
    const r = reg();
    const { result } = renderHook(() => useValueHistory(store, r));
    tick(300);
    expect(result.current.length).toBeGreaterThanOrEqual(2);
    act(() => store.clear());
    tick(100);
    expect(result.current).toEqual([]);
    act(() => store.apply({ full: true, rows: [row(8)] }));
    tick(100);
    expect(result.current).toEqual([8]);
    tick(100);
    expect(result.current).toEqual([8, 8]);
  });

  it("stops sampling on unmount", () => {
    const store = createLiveStore();
    store.apply({ full: true, rows: [row(7)] });
    const { unmount } = renderHook(() => useValueHistory(store, reg()));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns an empty history when reg is null", () => {
    const store = createLiveStore();
    store.apply({ full: true, rows: [row(1)] });
    const { result } = renderHook(() => useValueHistory(store, null));
    tick(300);
    expect(result.current).toEqual([]);
  });
});
