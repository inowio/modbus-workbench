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
    expect(effectiveDecimals(null, 1, 0, "u16")).toBe(0);
    expect(effectiveDecimals(undefined, 0.1, 0, "u16")).toBe(1);
    expect(effectiveDecimals(null, 0.25, 0, "i16")).toBe(2);
    expect(effectiveDecimals(null, 2.5, 0, "u16")).toBe(1);
    expect(effectiveDecimals(null, 1, 0, "f32")).toBe(6);
    expect(effectiveDecimals(null, 0.1, 0, "f64")).toBe(6);
    expect(effectiveDecimals(9, 1, 0, "u16")).toBe(6);
    expect(effectiveDecimals(2, 0.1, 0, "u16")).toBe(2);
    expect(effectiveDecimals(2, 1, 0, "f32")).toBe(2);
    expect(effectiveDecimals(null, -0.5, 0, "u16")).toBe(1);
    expect(effectiveDecimals(null, 1e-9, 0, "u16")).toBe(6);
    expect(effectiveDecimals(null, 1, 0.25, "u16")).toBe(2);
    expect(effectiveDecimals(null, 0.1, -40.5, "i16")).toBe(1);
    expect(effectiveDecimals(null, 0.1, 0.125, "i16")).toBe(3);
  });
});

describe("formatEng / registerScaling", () => {
  it("formats with decimals and unit", () => {
    expect(formatEng(23.5, 1, "°C")).toBe("23.5 °C");
    expect(formatEng(300, 0)).toBe("300");
    expect(formatEng(-0.04, 1)).toBe("0.0");
    expect(formatEng(35.5, 6, null, true)).toBe("35.5");
    expect(formatEng(300, 6, "V", true)).toBe("300 V");
    expect(formatEng(1.23456, 6, null, true)).toBe("1.23456");
    expect(formatEng(35.5, 3)).toBe("35.500");
  });
  it("applies defaults", () => {
    expect(registerScaling({ dataType: "u16" })).toEqual({ scale: 1, offset: 0, decimals: 0, unit: "", trim: false });
    expect(registerScaling({ dataType: "i16", scale: 0.1, scaleOffset: -40, unit: "°C" })).toEqual({ scale: 0.1, offset: -40, decimals: 1, unit: "°C", trim: false });
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
  it("decodes f32 to its shortest round-trip decimal (no float noise)", () => {
    const f32Words = (v: number): Record<number, number> => {
      const dv = new DataView(new ArrayBuffer(4));
      dv.setFloat32(0, v);
      return { 1: dv.getUint16(0), 2: dv.getUint16(2) };
    };
    for (const [v, text] of [[230.7, "230.7 V"], [23.3, "23.3 V"], [49.95, "49.95 V"]] as const) {
      const w = f32Words(v);
      expect(decodeRegisterRaw({ dataType: "f32", byteOrder: "ABCD", address: 1 }, (a) => w[a] ?? null)).toBe(v);
      const snap = (_u: number, _f: number, a: number) => (a in w ? { valueWord: w[a], valueBit: null } : undefined);
      expect(liveValueText({ unitId: 1, functionCode: 3, address: 1, dataType: "f32", unit: "V" }, snap)).toBe(text);
    }
    // f64 is untouched.
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, 0.1 + 0.2);
    const w64: Record<number, number> = { 0: dv.getUint16(0), 1: dv.getUint16(2), 2: dv.getUint16(4), 3: dv.getUint16(6) };
    expect(decodeRegisterRaw({ dataType: "f64", address: 0 }, (a) => w64[a] ?? null)).toBe(0.1 + 0.2);
  });
  it("is null when any word is missing", () => {
    expect(decodeRegisterRaw({ dataType: "u32", address: 10 }, (a) => (a === 10 ? 1 : null))).toBeNull();
  });
  it("formats the scaled live value", () => {
    const reg = { unitId: 1, functionCode: 4, address: 1, dataType: "u16", scale: 0.1, unit: "°C" };
    const snap = () => ({ valueWord: 235, valueBit: null });
    expect(liveValueText(reg, snap)).toBe("23.5 °C");
    expect(liveValueText(reg, () => undefined)).toBe("—");
    const at = (word: number) => () => ({ valueWord: word, valueBit: null });
    // negative scale + offset: 100 * -0.5 + (-40) = -90 (integer type, 1 place)
    expect(liveValueText({ ...reg, scale: -0.5, scaleOffset: -40, unit: "" }, at(100))).toBe("-90.0");
    // fractional offset on an unscaled integer register: 23 + 0.25
    expect(liveValueText({ ...reg, scale: 1, scaleOffset: 0.25, unit: "" }, at(23))).toBe("23.25");
    // automatic float decimals trim trailing zeros; explicit ones stay fixed
    const f32 = { unitId: 1, functionCode: 4, address: 1, dataType: "f32" };
    const w: Record<number, number> = { 1: 0x420e, 2: 0 };
    const snapF = (_u: number, _f: number, a: number) => (a in w ? { valueWord: w[a], valueBit: null } : undefined);
    expect(liveValueText(f32, snapF)).toBe("35.5");
    expect(liveValueText({ ...f32, decimals: 3 }, snapF)).toBe("35.500");
    expect(liveValueText({ ...reg, functionCode: 1 }, () => ({ valueWord: null, valueBit: true }))).toBe("ON");
  });
});
