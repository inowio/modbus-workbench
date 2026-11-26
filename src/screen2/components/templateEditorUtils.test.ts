import { describe, expect, it } from "vitest";

import {
  categoryOptions,
  findOverlaps,
  normalizeCategory,
  formatOffset,
  nextFreeOffset,
  parseOffset,
  regLabel,
  slugKey,
  sourceSummary,
  wordSpan,
} from "./templateEditorUtils";

const reg = (o: number, dataType = "u16", bank = 3, extra: Record<string, unknown> = {}) => ({
  offset: o, bank, dataType, byteOrder: "ABCD", valueSource: "hold", sourceParams: "{}", alias: "", ...extra,
});

describe("templateEditorUtils", () => {
  it("computes word spans", () => {
    expect(["u16", "i16", "bool"].map(wordSpan)).toEqual([1, 1, 1]);
    expect(["u32", "i32", "f32"].map(wordSpan)).toEqual([2, 2, 2]);
    expect(["u64", "i64", "f64"].map(wordSpan)).toEqual([4, 4, 4]);
  });

  it("next free offset is span-aware and bank-scoped", () => {
    expect(nextFreeOffset([], 3)).toBe(0);
    expect(nextFreeOffset([reg(4, "f32")], 3)).toBe(6);
    expect(nextFreeOffset([reg(0), reg(4, "f32", 4)], 3)).toBe(1);
    expect(nextFreeOffset([reg(0), reg(1), reg(2, "u64")], 3)).toBe(6);
  });

  it("finds overlaps within a bank only", () => {
    const o = findOverlaps([reg(0, "u32"), reg(1), reg(1, "u16", 4), reg(5)]);
    expect(o.get(0)).toBe(1);
    expect(o.get(1)).toBe(0);
    expect(o.has(2)).toBe(false);
    expect(o.has(3)).toBe(false);
  });

  it("detects exact duplicates", () => {
    const o = findOverlaps([reg(2), reg(2)]);
    expect(o.get(0)).toBe(2);
    expect(o.get(1)).toBe(2);
  });

  it("slugs keys from names with uniqueness", () => {
    expect(slugKey("Power Meter!", [])).toBe("custom_power_meter");
    expect(slugKey("Power Meter", ["custom_power_meter"])).toBe("custom_power_meter_2");
    expect(slugKey("Power Meter", ["custom_power_meter", "custom_power_meter_2"])).toBe("custom_power_meter_3");
    expect(slugKey("   ", [])).toBe("");
    expect(slugKey("***", [])).toBe("");
  });

  it("labels registers with a placeholder", () => {
    expect(regLabel({ alias: "  ", offset: 7 })).toBe("Reg 7");
    expect(regLabel({ alias: "volts", offset: 7 })).toBe("volts");
  });

  it("formats and parses offsets", () => {
    expect(formatOffset(255, "hex")).toBe("0x00FF");
    expect(formatOffset(255, "dec")).toBe("255");
    expect(parseOffset("0x10")).toBe(16);
    expect(parseOffset(" 12 ")).toBe(12);
    expect(parseOffset("")).toBeNull();
    expect(parseOffset("-1")).toBeNull();
    expect(parseOffset("abc")).toBeNull();
  });

  it("summarises sources", () => {
    expect(sourceSummary(reg(0))).toBe("hold");
    expect(sourceSummary(reg(0, "u16", 3, { valueSource: "generator", sourceParams: '{"kind":"sine","min":0,"max":100,"periodMs":10000}' }))).toBe("sine 0–100 · 10 s");
    expect(sourceSummary(reg(0, "u16", 3, { valueSource: "generator", sourceParams: '{"kind":"ramp","min":0,"max":5,"periodMs":1500}' }))).toBe("ramp 0–5 · 1500 ms");
    expect(sourceSummary(reg(0, "u16", 3, { valueSource: "device", sourceParams: '{"preset":"temperature","min":0,"max":100}' }))).toBe("preset temperature");
    expect(sourceSummary(reg(0, "u16", 3, { valueSource: "route", sourceParams: '{"slaveUnitId":3,"functionCode":3,"address":257}' }))).toBe("route → unit 3 · FC3 @257");
    expect(sourceSummary(reg(0, "u16", 3, { unit: "°C", valueSource: "generator", sourceParams: '{"kind":"sine","min":20,"max":30}' }))).toBe("sine 20–30 °C");
    expect(sourceSummary(reg(0, "u16", 3, { unit: "°C", valueSource: "generator", sourceParams: '{"kind":"sine","min":20,"max":30,"periodMs":4000}' }))).toBe("sine 20–30 °C · 4 s");
  });
});

describe("device categories", () => {
  it("offers the standard categories plus ones already in use, without duplicates or Workspace", () => {
    expect(categoryOptions(["Sensors", "sensors", "HVAC", " Lab ", "Workspace", ""])).toEqual([
      "Sensors", "Power", "I/O", "Drives", "Learning", "Custom", "HVAC", "Lab",
    ]);
  });

  it("snaps a typed category to an existing one ignoring case and spaces", () => {
    const opts = categoryOptions(["HVAC"]);
    expect(normalizeCategory("  sensors ", opts)).toBe("Sensors");
    expect(normalizeCategory("hvac", opts)).toBe("HVAC");
    expect(normalizeCategory("  Lab   rig ", opts)).toBe("Lab rig");
    expect(normalizeCategory("   ", opts)).toBe("Custom");
  });
});
