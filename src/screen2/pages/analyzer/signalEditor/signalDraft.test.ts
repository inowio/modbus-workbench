import { describe, expect, it } from "vitest";
import type { AnalyzerSignal, AnalyzerTile } from "../../../api/analyzer";
import type { SignalMath } from "../../../utils/analyzerMath";
import { draftFromSignal, draftToUpsert, suggestCalculatedId, validateDraft } from "./signalDraft";

function signal(id: string, over: Partial<AnalyzerSignal> = {}): AnalyzerSignal {
  return {
    id, kind: "register", slaveId: 1, connectionKind: "tcp", functionKind: "holding", registerRowId: 7, address: 10,
    functionCode: 3, alias: id, dataType: "u16", order: null, displayFormat: null, inputSignalIds: [], decoderJson: "{}",
    state: "OK", ...over,
  };
}

function tile(id: number, title: string, kind = "chart"): AnalyzerTile {
  return { id, kind, title, configJson: "{}", pollingEnabled: true, createdAt: "", updatedAt: "" };
}

/** A realistic pre-0.6 decoder: every register-value key set. */
const OLD_DECODER = '{"bit":3,"scale":0.1,"offset":-2,"clampMin":0,"clampMax":100,"decimals":2,"unit":"degC"}';

const TEXT_MATH: SignalMath = {
  version: 1,
  inputs: [],
  variables: [
    { name: "y", kind: "calc", start: { ref: "register" }, steps: [] },
    {
      name: "z",
      kind: "rules",
      rules: [{ join: "and", conds: [{ left: { ref: "y" }, cmp: "gt", right: { num: 5 } }], then: { text: "High" } }],
      otherwise: { text: "Low" },
    },
  ],
};

describe("signalDraft", () => {
  it("old signal round-trips unchanged", () => {
    const s = signal("Temp_1", { decoderJson: OLD_DECODER });
    const out = draftToUpsert(draftFromSignal(s, "register"));
    expect(JSON.parse(out.decoderJson ?? "")).toEqual(JSON.parse(OLD_DECODER));
    expect(Object.keys(JSON.parse(out.decoderJson ?? ""))).toEqual(Object.keys(JSON.parse(OLD_DECODER)));
    expect(out).toMatchObject({ id: "Temp_1", kind: "register", slaveId: 1, functionKind: "holding", registerRowId: 7 });
  });

  it("omits math and show when unused", () => {
    const d = draftFromSignal(signal("A", { decoderJson: '{"unit":"V"}' }), "register");
    expect(d.show).toBe("register");
    const cfg = JSON.parse(draftToUpsert(d).decoderJson ?? "");
    expect(cfg).toEqual({ unit: "V" });
    expect("math" in cfg).toBe(false);
    expect("show" in cfg).toBe(false);

    const withMath = draftToUpsert({ ...d, show: "z", math: TEXT_MATH });
    const cfg2 = JSON.parse(withMath.decoderJson ?? "");
    expect(cfg2.show).toBe("z");
    expect(cfg2.math.variables).toHaveLength(2);
  });

  it("calculated upsert has kind and null register fields", () => {
    const d = draftFromSignal(null, "calculated");
    const math: SignalMath = {
      version: 1,
      inputs: [{ name: "A", signalId: "Temp_1", value: "shown" }],
      variables: [{ name: "x", kind: "calc", start: { ref: "A" }, steps: [] }],
    };
    const out = draftToUpsert({ ...d, id: "Calc_1", show: "x", scale: "2", bit: "3", unit: "°C", math });
    expect(out.kind).toBe("calculated");
    expect(out.slaveId).toBeNull();
    expect(out.registerRowId).toBeNull();
    expect(out.functionKind).toBe("");
    const cfg = JSON.parse(out.decoderJson ?? "");
    expect(cfg).toEqual({ unit: "°C", show: "x", math });
  });

  it("a calculated signal without a Show value picks its first variable", () => {
    const math: SignalMath = {
      version: 1,
      inputs: [{ name: "A", signalId: "Temp_1", value: "shown" }],
      variables: [{ name: "x", kind: "calc", start: { ref: "A" }, steps: [] }],
    };
    const calc = signal("Calc_1", { kind: "calculated", slaveId: null, registerRowId: null, decoderJson: JSON.stringify({ math }) });
    expect(draftFromSignal(calc, "calculated").show).toBe("x");
    expect(draftFromSignal(null, "calculated").show).toBe("");
  });

  it("suggestCalculatedId skips taken ids", () => {
    expect(suggestCalculatedId([])).toBe("Calc_1");
    expect(suggestCalculatedId(["Calc_1", "calc_2", "Other"])).toBe("Calc_3");
  });

  it("blocking message when a charted signal would become text", () => {
    const s = signal("Temp_1", { decoderJson: '{"unit":"degC"}' });
    const d = { ...draftFromSignal(s, "register"), show: "z", math: TEXT_MATH };
    const res = validateDraft(d, { signals: [s], mode: "edit", chartTiles: [tile(1, "Boiler temp"), tile(2, "Line 2")] });
    expect(res.ok).toBe(false);
    expect(res.blocking).toBe("Used by chart tiles: Boiler temp, Line 2. Change them to Value tiles or pick a numeric Show value.");

    const numeric = validateDraft({ ...d, show: "y" }, { signals: [s], mode: "edit", chartTiles: [tile(1, "Boiler temp")] });
    expect(numeric.blocking).toBeNull();
    expect(numeric.ok).toBe(true);
  });

  it("calculated draft needs an input and a variable to show", () => {
    const d = { ...draftFromSignal(null, "calculated"), id: "Calc_1" };
    const res = validateDraft(d, { signals: [], mode: "add", chartTiles: [] });
    expect(res.ok).toBe(false);
    expect(res.byTab.math.map((i) => i.message)).toContain("needs at least one input");
    expect(res.byTab.data.join(" ")).toMatch(/Show value/);
  });

  it("rejects calculated or unknown signals as inputs", () => {
    const calc = signal("C", { kind: "calculated", slaveId: null, registerRowId: null });
    const math: SignalMath = {
      version: 1,
      inputs: [
        { name: "A", signalId: "C", value: "shown" },
        { name: "B", signalId: "Nope", value: "shown" },
      ],
      variables: [{ name: "x", kind: "calc", start: { ref: "A" }, steps: [] }],
    };
    const d = { ...draftFromSignal(null, "calculated"), id: "Calc_9", show: "x", math };
    const res = validateDraft(d, { signals: [calc], mode: "add", chartTiles: [] });
    expect(res.byTab.math.map((i) => i.path)).toEqual(expect.arrayContaining(["inputs.0.signalId", "inputs.1.signalId"]));
  });

  it("names a self input before calling it calculated", () => {
    const self = signal("Calc_9", { kind: "calculated", slaveId: null, registerRowId: null });
    const math: SignalMath = {
      version: 1,
      inputs: [{ name: "A", signalId: "Calc_9", value: "shown" }],
      variables: [{ name: "x", kind: "calc", start: { ref: "A" }, steps: [] }],
    };
    const d = { ...draftFromSignal(self, "calculated"), show: "x", math };
    const res = validateDraft(d, { signals: [self], mode: "edit", chartTiles: [] });
    expect(res.byTab.math.map((i) => i.message)).toContain("input A: a signal can't use itself");
  });

  it("an input naming a variable its source no longer has blocks Save", () => {
    const srcMath: SignalMath = { version: 1, inputs: [], variables: [{ name: "temp", kind: "calc", start: { ref: "register" }, steps: [] }] };
    const src = signal("r1", { decoderJson: JSON.stringify({ math: srcMath }) });
    const math = (value: string): SignalMath => ({
      version: 1,
      inputs: [{ name: "in1", signalId: "r1", value }],
      variables: [{ name: "x", kind: "calc", start: { ref: "in1" }, steps: [] }],
    });
    const d = { ...draftFromSignal(null, "calculated"), id: "Calc_1", show: "x" };
    const bad = validateDraft({ ...d, math: math("temp_old") }, { signals: [src], mode: "add", chartTiles: [] });
    expect(bad.ok).toBe(false);
    expect(bad.byTab.math).toContainEqual({ path: "inputs.0.value", message: 'input in1: variable "temp_old" no longer exists in r1' });
    for (const value of ["shown", "register", "temp"]) {
      expect(validateDraft({ ...d, math: math(value) }, { signals: [src], mode: "add", chartTiles: [] }).ok).toBe(true);
    }
  });

  it("chart-text block names untitled tiles as Tile <id>", () => {
    const s = signal("Temp_1", { decoderJson: '{"unit":"degC"}' });
    const d = { ...draftFromSignal(s, "register"), show: "z", math: TEXT_MATH };
    const res = validateDraft(d, { signals: [s], mode: "edit", chartTiles: [tile(4, ""), tile(5, "Line 2")] });
    expect(res.blocking).toBe("Used by chart tiles: Tile 4, Line 2. Change them to Value tiles or pick a numeric Show value.");
  });

  it("rejects a register draft whose math has inputs", () => {
    const s = signal("A");
    const math: SignalMath = { version: 1, inputs: [{ name: "in1", signalId: "B", value: "shown" }], variables: [] };
    const res = validateDraft({ ...draftFromSignal(s, "register"), math }, { signals: [s], mode: "edit", chartTiles: [] });
    expect(res.ok).toBe(false);
    expect(res.byTab.math.map((i) => i.message)).toContain("register signals can't have inputs");
  });

  it("keeps the old decoder field checks", () => {
    const d = { ...draftFromSignal(signal("A"), "register"), bit: "64", clampMin: "5", clampMax: "1", decimals: "1.5" };
    const res = validateDraft(d, { signals: [signal("A")], mode: "edit", chartTiles: [] });
    expect(res.byTab.data).toEqual(expect.arrayContaining(["Must be ≤ 63", "Must be ≤ clamp max", "Must be an integer"]));
  });
});
