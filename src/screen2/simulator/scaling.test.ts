import { describe, expect, it } from "vitest";

import {
  decodeRegisterRaw, effectiveDecimals, engFromRaw, formatEng, liveValueText, rawFromEng, registerScaling,
} from "./scaling";

describe("rawFromEng", () => {
  it("inverts scale and offset, rounding integer types to nearest", () => {
    expect(rawFromEng(23.45, 0.1, 0, "u16")).toBe(235);
    expect(rawFromEng(23.45, 0.1, 0, "f32")).toBeCloseTo(234.5, 9);
    expect(rawFromEng(-10, -0.5, -40, "i16")).toBe(-60);
    expect(rawFromEng(1e9, 1, 0, "u16")).toBe(65535);
    expect(rawFromEng(-5, 1, 0, "u16")).toBe(0);
  });
  it("is the identity without scaling (R1: clamp only)", () => {
    expect(rawFromEng(49.7, 1, 0, "u16")).toBe(49.7);
    expect(rawFromEng(-3.2, 1, 0, "i32")).toBe(-3.2);
    expect(rawFromEng(70000.5, 1, 0, "u16")).toBe(65535);
    expect(rawFromEng(49.7, 1, 1, "u16")).toBe(49);
  });
  it("rounds half away from zero for negatives", () => {
    expect(rawFromEng(-2, 1, 0.5, "i16")).toBe(-3);
  });
  it("maps non-finite to zero", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(rawFromEng(bad, 0.1, 0, "u16")).toBe(0);
      expect(rawFromEng(bad, 0.5, 0, "f32")).toBe(0);
    }
    expect(rawFromEng(NaN, 0.5, 40, "i16")).toBe(-80);
  });
  it("round-trips for scale -0.5, offset -40", () => {
    for (const x of [-20, 0, 23.5, 100]) {
      const back = engFromRaw(rawFromEng(x, -0.5, -40, "i16"), -0.5, -40);
      expect(Math.abs(back - x)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("effectiveDecimals", () => {
  it("derives from scale for integers and 3 for floats", () => {
    expect(effectiveDecimals(null, 1, "u16")).toBe(0);
    expect(effectiveDecimals(undefined, 0.1, "u16")).toBe(1);
    expect(effectiveDecimals(null, 0.25, "i16")).toBe(2);
    expect(effectiveDecimals(null, 2.5, "u16")).toBe(1);
    expect(effectiveDecimals(null, 1, "f32")).toBe(3);
    expect(effectiveDecimals(9, 1, "u16")).toBe(6);
    expect(effectiveDecimals(2, 0.1, "u16")).toBe(2);
    expect(effectiveDecimals(null, -0.5, "u16")).toBe(1);
    expect(effectiveDecimals(null, 1e-9, "u16")).toBe(6);
  });
});

describe("formatEng / registerScaling", () => {
  it("formats with decimals and unit", () => {
    expect(formatEng(23.5, 1, "°C")).toBe("23.5 °C");
    expect(formatEng(300, 0)).toBe("300");
    expect(formatEng(-0.04, 1)).toBe("0.0");
  });
  it("applies defaults", () => {
    expect(registerScaling({ dataType: "u16" })).toEqual({ scale: 1, offset: 0, decimals: 0, unit: "" });
    expect(registerScaling({ dataType: "i16", scale: 0.1, scaleOffset: -40, unit: "°C" })).toEqual({ scale: 0.1, offset: -40, decimals: 1, unit: "°C" });
  });
});

describe("decodeRegisterRaw / liveValueText", () => {
  it("decodes i16 0xFFFF as -1", () => {
    expect(decodeRegisterRaw({ dataType: "i16", address: 5 }, () => 0xffff)).toBe(-1);
  });
  it("decodes a two-word f32", () => {
    const words: Record<number, number> = { 10: 0x420e, 11: 0x0000 };
    expect(decodeRegisterRaw({ dataType: "f32", byteOrder: "ABCD", address: 10 }, (a) => words[a] ?? null)).toBe(35.5);
  });
  it("is null when any word is missing", () => {
    expect(decodeRegisterRaw({ dataType: "u32", address: 10 }, (a) => (a === 10 ? 1 : null))).toBeNull();
  });
  it("formats the scaled live value", () => {
    const reg = { unitId: 1, functionCode: 4, address: 1, dataType: "u16", scale: 0.1, unit: "°C" };
    const snap = () => ({ valueWord: 235, valueBit: null });
    expect(liveValueText(reg, snap)).toBe("23.5 °C");
    expect(liveValueText(reg, () => undefined)).toBe("—");
    expect(liveValueText({ ...reg, functionCode: 1 }, () => ({ valueWord: null, valueBit: true }))).toBe("ON");
  });
});
