import { describe, it, expect, beforeEach } from "vitest";
import { filterRegisters, EMPTY_FILTER, rwLabel, readColumns, writeColumns, DEFAULT_COLUMNS } from "./simFilters";

const reg = (o: Partial<any> = {}) => ({ id: 1, unitId: 1, functionCode: 3, address: 5, alias: "Temp", dataType: "u16", holdValue: 0, sortOrder: 0, valueSource: "hold", byteOrder: "ABCD", sourceParams: "{}", intervalMs: 1000, deviceInstanceId: null, ...o });

describe("filterRegisters", () => {
  const rows = [reg(), reg({ id: 2, unitId: 2, alias: "Volt", valueSource: "device", dataType: "f32" })];
  it("returns all with empty filter", () => expect(filterRegisters(rows, EMPTY_FILTER)).toHaveLength(2));
  it("filters by unit", () => expect(filterRegisters(rows, { ...EMPTY_FILTER, unit: 2 })).toHaveLength(1));
  it("filters by source", () => expect(filterRegisters(rows, { ...EMPTY_FILTER, source: "device" })[0].id).toBe(2));
  it("filters by type", () => expect(filterRegisters(rows, { ...EMPTY_FILTER, type: "f32" })[0].id).toBe(2));
  it("search matches alias case-insensitively", () => expect(filterRegisters(rows, { ...EMPTY_FILTER, search: "temp" })[0].id).toBe(1));
  it("search matches address", () => expect(filterRegisters(rows, { ...EMPTY_FILTER, search: "5" })).toHaveLength(2));
});

describe("filterRegisters hex search (F10)", () => {
  const rows = [reg({ id: 1, address: 257, alias: "A" }), reg({ id: 2, address: 5, alias: "B" })];
  const hex = (search: string) => filterRegisters(rows, { ...EMPTY_FILTER, search }, "hex").map((r) => r.id);
  it("matches a 4-digit hex address", () => expect(hex("0101")).toEqual([1]));
  it("matches 0x-prefixed, case-insensitively", () => { expect(hex("0x101")).toEqual([1]); expect(hex("0X0101")).toEqual([1]); });
  it("matches hex letters in any case", () => {
    const r = [reg({ id: 9, address: 0x1fa })];
    expect(filterRegisters(r, { ...EMPTY_FILTER, search: "1FA" }, "hex")).toHaveLength(1);
    expect(filterRegisters(r, { ...EMPTY_FILTER, search: "0x1fa" }, "hex")).toHaveLength(1);
  });
  it("still matches decimal in hex mode", () => expect(hex("257")).toEqual([1]));
  it("does not match hex text in dec mode", () => expect(filterRegisters(rows, { ...EMPTY_FILTER, search: "0x101" }, "dec")).toHaveLength(0));
});

describe("rwLabel", () => {
  it("holding & coil are R/W", () => { expect(rwLabel(3)).toBe("R/W"); expect(rwLabel(1)).toBe("R/W"); });
  it("input & discrete are R", () => { expect(rwLabel(4)).toBe("R"); expect(rwLabel(2)).toBe("R"); });
});

describe("column prefs", () => {
  beforeEach(() => localStorage.clear());
  it("defaults when unset", () => expect(readColumns("ws")).toEqual(DEFAULT_COLUMNS));
  it("round-trips", () => { writeColumns("ws", ["unit", "value"]); expect(readColumns("ws")).toEqual(["unit", "value"]); });
});
