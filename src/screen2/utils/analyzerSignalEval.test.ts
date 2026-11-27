import { describe, expect, it } from "vitest";
import { decodeAnalyzerSignal } from "./analyzerSignalDecoder";
import {
  evaluateCalculatedSignal,
  evaluateRegisterSignal,
  formatMathNumber,
  shownValueType,
  worstState,
  type RegisterSignalInput,
  type SignalEvaluation,
} from "./analyzerSignalEval";
import type { SignalMath } from "./analyzerMath";

const base: RegisterSignalInput = {
  state: "OK",
  rawWords: [328],
  functionCode: 3,
  dataType: "u16",
  order: "ABCD",
  displayFormat: "dec",
};

const json = (o: unknown) => JSON.stringify(o);

const rulesZ = {
  name: "z",
  kind: "rules",
  rules: [{ join: "and", conds: [{ left: { ref: "register" }, cmp: "gt", right: { num: 100 } }], then: { text: "High" } }],
  otherwise: { text: "Medium" },
};

describe("evaluateRegisterSignal", () => {
  const cases: Array<[string, RegisterSignalInput]> = [
    ["plain", { ...base }],
    ["scale/offset/decimals/unit", { ...base, decoderJson: json({ scale: 0.1, offset: 1, decimals: 2, unit: "°C" }) }],
    ["bool coil", { ...base, rawWords: null, rawBools: [true, false], functionCode: 1, dataType: "bool", decoderJson: json({ bit: 0, unit: "x" }) }],
    ["u64 bigint", { ...base, rawWords: [0, 0, 0, 5], dataType: "u64" }],
    ["hex display", { ...base, rawWords: [255], displayFormat: "hex" }],
  ];
  it.each(cases)("signal without math is byte-identical to decodeAnalyzerSignal (%s)", (_n, input) => {
    const ev = evaluateRegisterSignal(input);
    const dec = decodeAnalyzerSignal(input);
    expect(ev.formatted).toBe(dec.formatted);
    expect(ev.state).toBe("OK");
    expect(ev.valueType).toBe("number");
    expect(dec.ok).toBe(true);
    if (dec.ok) {
      const v = dec.value;
      const expected = v.kind === "bool" ? (v.value ? 1 : 0) : Number(v.value);
      expect(ev.sample).toBe(expected);
    }
  });

  it("shown is unrounded while label and sample are rounded", () => {
    const ev = evaluateRegisterSignal({ ...base, decoderJson: json({ scale: 0.1, decimals: 0 }) });
    expect(ev.formatted).toBe("33");
    expect(ev.sample).toBe(33);
    expect(ev.shown.ok && ev.shown.value.kind === "number" && ev.shown.value.value).toBeCloseTo(32.8, 9);
  });

  it("example 1 shows y with unit", () => {
    const math = { version: 1, inputs: [], variables: [{ name: "y", kind: "calc", start: { ref: "register" }, steps: [{ op: "mul", operand: { num: 0.1 } }] }] };
    const ev = evaluateRegisterSignal({ ...base, decoderJson: json({ math, show: "y", decimals: 1, unit: "°C" }) });
    expect(ev.formatted).toBe("32.8 °C");
    expect(ev.sample).toBe(32.8);
    expect(ev.variables.y.ok).toBe(true);
  });

  it("text variable label has no unit and no sample", () => {
    const math = { version: 1, inputs: [], variables: [rulesZ] };
    const ev = evaluateRegisterSignal({ ...base, rawWords: [50], decoderJson: json({ math, show: "z", unit: "°C" }) });
    expect(ev.formatted).toBe("Medium");
    expect(ev.sample).toBeNull();
    expect(ev.valueType).toBe("text");
    expect(shownValueType(json({ math, show: "z" }))).toBe("text");
  });

  it("formats variable values without float noise", () => {
    const math = { version: 1, inputs: [], variables: [{ name: "n", kind: "calc", start: { num: 0.1 }, steps: [{ op: "add", operand: { num: 0.2 } }] }] };
    const ev = evaluateRegisterSignal({ ...base, decoderJson: json({ math, show: "n" }) });
    expect(ev.formatted).toBe("0.3");
    expect(formatMathNumber(0.1 + 0.2, undefined)).toBe("0.3");
    expect(formatMathNumber(1.25, 1)).toBe("1.3");
  });

  it("formats integers exactly when no decimals are set", () => {
    expect(formatMathNumber(1234567890123456, undefined)).toBe("1234567890123456");
    expect(formatMathNumber(-9007199254740991, undefined)).toBe("-9007199254740991");
    expect(formatMathNumber(-0, undefined)).toBe("0");
  });

  it("u64 above 2^53 into math is an error", () => {
    const words = [0x1000, 0, 0, 0]; // 2^60
    const math = { version: 1, inputs: [], variables: [{ name: "x", kind: "calc", start: { ref: "register" }, steps: [] }] };
    const ev = evaluateRegisterSignal({ ...base, rawWords: words, dataType: "u64", decoderJson: json({ math, show: "x" }) });
    expect(ev.formatted).toContain("value too large for math");
    expect(ev.sample).toBeNull();
    const plain = evaluateRegisterSignal({ ...base, rawWords: words, dataType: "u64" });
    expect(plain.formatted).toBe(decodeAnalyzerSignal({ ...base, rawWords: words, dataType: "u64" }).formatted);
  });

  it("large safe integers are shown exactly", () => {
    const math = { version: 1, inputs: [], variables: [{ name: "x", kind: "calc", start: { ref: "register" }, steps: [] }] };
    const v = 1250999896491;
    const words = [0, Math.floor(v / 2 ** 32), Math.floor(v / 2 ** 16) % 65536, v % 65536];
    const ev = evaluateRegisterSignal({ ...base, rawWords: words, dataType: "u64", decoderJson: json({ math, show: "x" }) });
    expect(ev.formatted).toBe("1250999896491");
    expect(ev.sample).toBe(v);
  });

  it("u64 above 2^53 with scale 1 is still too large for math", () => {
    const math = { version: 1, inputs: [], variables: [{ name: "x", kind: "calc", start: { ref: "register" }, steps: [] }] };
    const ev = evaluateRegisterSignal({ ...base, rawWords: [0x1000, 0, 0, 0], dataType: "u64", decoderJson: json({ scale: 1, math, show: "x" }) });
    expect(ev.formatted).toContain("value too large for math");
    expect(ev.sample).toBeNull();
  });

  it("stale state wins over invalid math and keeps the register value", () => {
    const ev = evaluateRegisterSignal({ ...base, state: "STALE", decoderJson: json({ math: { version: 2 } }) });
    expect(ev.state).toBe("STALE");
    expect(ev.formatted).toBe("Stale");
    const ok = evaluateRegisterSignal({ ...base, decoderJson: json({ math: { version: 2 } }) });
    expect(ok.register).toEqual({ ok: true, value: { kind: "number", value: 328 } });
  });

  it("non-OK state yields no number", () => {
    const math = { version: 1, inputs: [], variables: [] };
    const ev = evaluateRegisterSignal({ ...base, state: "STALE", decoderJson: json({ math, show: "register" }) });
    expect(ev.state).toBe("STALE");
    expect(ev.formatted).toBe("Stale");
    expect(ev.sample).toBeNull();
    expect(ev.shown.ok).toBe(false);
  });

  it("unsupported math version is an error, not a silent fallback", () => {
    const ev = evaluateRegisterSignal({ ...base, decoderJson: json({ math: { version: 2 }, show: "y" }) });
    expect(ev.state).toBe("ERROR");
    expect(ev.formatted).toBe("unsupported or invalid math");
    expect(ev.shown).toEqual({ ok: false, error: "unsupported or invalid math" });
    expect(ev.sample).toBeNull();
  });
});

describe("evaluateCalculatedSignal", () => {
  const ok = (n: number, extra: Partial<SignalEvaluation> = {}): SignalEvaluation => ({
    state: "OK",
    formatted: String(n),
    shown: { ok: true, value: { kind: "number", value: n } },
    register: { ok: true, value: { kind: "number", value: n } },
    variables: {},
    sample: n,
    valueType: "number",
    ...extra,
  });
  const power: SignalMath = {
    version: 1,
    inputs: [
      { name: "V", signalId: "s1", value: "shown" },
      { name: "A", signalId: "s2", value: "shown" },
    ],
    variables: [{ name: "P", kind: "calc", start: { ref: "V" }, steps: [{ op: "mul", operand: { ref: "A" } }, { op: "div", operand: { num: 1000 } }] }],
  };

  it("P = V x A / 1000", () => {
    const inputs = { s1: ok(230.4), s2: ok(4.2) };
    const ev = evaluateCalculatedSignal(json({ math: power, show: "P" }), inputs);
    expect(ev.shown.ok && ev.shown.value.kind === "number" && ev.shown.value.value).toBeCloseTo(0.96768, 9);
    expect(ev.register).toBeNull();
    const ev3 = evaluateCalculatedSignal(json({ math: power, show: "P", decimals: 3 }), inputs);
    expect(ev3.formatted).toBe("0.968");
    expect(ev3.sample).toBe(0.968);
    expect(ev3.state).toBe("OK");
  });

  it("calculated input can read a register value or a variable of another signal", () => {
    const math: SignalMath = {
      version: 1,
      inputs: [
        { name: "R", signalId: "s1", value: "register" },
        { name: "Y", signalId: "s2", value: "y" },
      ],
      variables: [{ name: "S", kind: "calc", start: { ref: "R" }, steps: [{ op: "add", operand: { ref: "Y" } }] }],
    };
    const src2 = ok(0, {
      variables: {
        y: { ok: true, value: { kind: "number", value: 5 } },
        z: { ok: true, value: { kind: "text", value: "Hi" } },
      },
    });
    const src1 = ok(10, { register: { ok: true, value: { kind: "number", value: 7 } } });
    const ev = evaluateCalculatedSignal(json({ math, show: "S" }), { s1: src1, s2: src2 });
    expect(ev.formatted).toBe("12");

    const textMath: SignalMath = {
      version: 1,
      inputs: [{ name: "Lvl", signalId: "s2", value: "z" }],
      variables: [{ name: "T", kind: "rules", rules: [], otherwise: { ref: "Lvl" } }],
    };
    expect(shownValueType(json({ math: textMath, show: "T" }), { Lvl: "text" })).toBe("text");
    expect(shownValueType(json({ math: textMath, show: "T" }))).toBe("number");
    const t = evaluateCalculatedSignal(json({ math: textMath, show: "T", unit: "V" }), { s2: src2 });
    expect(t.formatted).toBe("Hi");
    expect(t.valueType).toBe("text");
    expect(t.sample).toBeNull();
  });

  it("calculated input pointing at a missing variable is an error", () => {
    const math: SignalMath = {
      version: 1,
      inputs: [{ name: "Temp", signalId: "s1", value: "y" }],
      variables: [{ name: "o", kind: "calc", start: { ref: "Temp" }, steps: [] }],
    };
    const ev = evaluateCalculatedSignal(json({ math, show: "o" }), { s1: ok(1) });
    expect(ev.formatted).toContain("missing: Temp.y");
    expect(ev.sample).toBeNull();
    expect(ev.state).toBe("ERROR");
  });

  it("calculated state is worst of inputs", () => {
    const ev = evaluateCalculatedSignal(json({ math: power, show: "P" }), { s1: ok(1), s2: ok(2, { state: "STALE" }) });
    expect(ev.state).toBe("STALE");
    expect(ev.formatted).toBe("Stale");
    expect(ev.sample).toBeNull();
    const ev2 = evaluateCalculatedSignal(json({ math: power, show: "P" }), { s1: ok(1), s2: ok(2, { state: "DISCONNECTED" }) });
    expect(ev2.state).toBe("DISCONNECTED");
    expect(ev2.formatted).toBe("Disconnected");
  });

  it("calculated signal with an ERROR input shows no number", () => {
    const math: SignalMath = {
      version: 1,
      inputs: [
        { name: "V", signalId: "s1", value: "shown" },
        { name: "A", signalId: "s2", value: "shown" },
      ],
      variables: [{ name: "P", kind: "calc", start: { ref: "V" }, steps: [] }],
    };
    const ev = evaluateCalculatedSignal(json({ math, show: "P" }), { s1: ok(5), s2: ok(1, { state: "ERROR" }) });
    expect(ev.state).toBe("ERROR");
    expect(ev.formatted).toBe("Error");
    expect(ev.sample).toBeNull();
    expect(ev.shown.ok).toBe(false);
  });

  it("invalid math is an error", () => {
    const ev = evaluateCalculatedSignal(json({ math: { version: 9 } }), {});
    expect(ev.formatted).toBe("unsupported or invalid math");
    expect(ev.state).toBe("ERROR");
  });
});

describe("shownValueType / worstState", () => {
  it("no math is number; calc variable on a calculated signal is number", () => {
    expect(shownValueType("{}")).toBe("number");
    expect(shownValueType(json({ unit: "V" }))).toBe("number");
    const math = { version: 1, inputs: [{ name: "V", signalId: "s1", value: "shown" }], variables: [{ name: "p", kind: "calc", start: { ref: "V" }, steps: [] }] };
    expect(shownValueType(json({ math, show: "p" }))).toBe("number");
  });
  it("worstState ranks DISCONNECTED > STALE > ERROR > OK", () => {
    expect(worstState([])).toBe("OK");
    expect(worstState(["OK", "connecting"])).toBe("ERROR");
    expect(worstState(["OK", "ERROR"])).toBe("ERROR");
    expect(worstState(["ERROR", "STALE", "OK"])).toBe("STALE");
    expect(worstState(["STALE", "DISCONNECTED"])).toBe("DISCONNECTED");
  });
});
