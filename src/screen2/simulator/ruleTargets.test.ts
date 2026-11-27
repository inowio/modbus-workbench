import { describe, expect, it } from "vitest";

import { setHint, stepHint, storedEngValue } from "./ruleTargets";
import type { PageRegister } from "./useSimulatorData";

const reg = (patch: Partial<PageRegister>): PageRegister =>
  ({ id: 1, unitId: 1, functionCode: 3, address: 0, alias: "", dataType: "u16", byteOrder: "ABCD", ...patch }) as PageRegister;

const tenths = reg({ scale: 0.1, unit: "°C" });

describe("storedEngValue", () => {
  it("rounds to the nearest step on a scaled integer register", () => {
    expect(storedEngValue(25.57, tenths)).toBeCloseTo(25.6, 9);
    expect(storedEngValue(25.5, tenths)).toBeCloseTo(25.5, 9);
  });

  it("truncates and wraps on a default-scale single-word register (legacy path)", () => {
    expect(storedEngValue(25.9, reg({}))).toBe(25);
    expect(storedEngValue(-1, reg({}))).toBe(65535);
    expect(storedEngValue(-1, reg({ dataType: "i16" }))).toBe(-1);
    expect(storedEngValue(40000, reg({ dataType: "i16" }))).toBe(-25536);
  });

  it("keeps f32 precision only", () => {
    expect(storedEngValue(25.57, reg({ dataType: "f32" }))).toBeCloseTo(25.57, 5);
  });
});

describe("setHint", () => {
  it("shows the stored value when it differs", () => {
    expect(setHint(25.57, tenths, 3)).toBe("Will be stored as 25.6 °C");
    expect(setHint(25.6, tenths, 3)).toBeNull();
  });

  it("handles a signed i16 register", () => {
    expect(setHint(-2.57, reg({ dataType: "i16", scale: 0.1 }), 3)).toBe("Will be stored as -2.6");
    expect(setHint(-1, reg({ dataType: "i16" }), 3)).toBeNull();
    expect(setHint(40000, reg({ dataType: "i16" }), 3)).toBe("Will be stored as -25536");
  });

  it("no hint for f32 (rounding noise only), f64, bits or a missing register", () => {
    expect(setHint(25.57, reg({ dataType: "f32" }), 3)).toBeNull();
    expect(setHint(25.57, reg({ dataType: "f64" }), 3)).toBeNull();
    expect(setHint(5, reg({ functionCode: 1, dataType: "bool" }), 1)).toBeNull();
    expect(setHint(25.57, undefined, 3)).toBeNull();
  });
});

describe("stepHint", () => {
  it("scaled integer: under half a step does nothing, otherwise says what it really moves", () => {
    expect(stepHint(0.04, tenths, 3)).toBe("Smaller than half a step (0.1 °C) — does nothing");
    expect(stepHint(0.05, tenths, 3)).toBe("Moves by 0.1 °C each time");
    expect(stepHint(0.15, tenths, 3)).toBe("Moves by 0.2 °C each time");
    expect(stepHint(0.5, tenths, 3)).toBeNull();
    expect(stepHint(0.2, tenths, 3)).toBeNull();
  });

  it("scaled i16 with a negative amount", () => {
    const r = reg({ dataType: "i16", scale: 0.5 });
    expect(stepHint(-0.6, r, 3)).toBe("Moves by -0.5 each time");
    expect(stepHint(-0.2, r, 3)).toBe("Smaller than half a step (0.5) — does nothing");
  });

  it("default scale keeps the legacy truncation hint", () => {
    expect(stepHint(0.5, reg({}), 3)).toBe("Smaller than one step (1) — does nothing");
    expect(stepHint(1.5, reg({}), 3)).toBeNull();
  });

  it("no hint for f32, bits, zero or a missing register", () => {
    expect(stepHint(0.01, reg({ dataType: "f32", scale: 0.1 }), 3)).toBeNull();
    expect(stepHint(0.5, reg({ functionCode: 1, dataType: "bool" }), 1)).toBeNull();
    expect(stepHint(0, tenths, 3)).toBeNull();
    expect(stepHint(0.04, undefined, 3)).toBeNull();
  });
});
