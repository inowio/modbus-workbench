import { describe, expect, it } from "vitest";
import type { AnalyzerSignal, AnalyzerTile, AnalyzerTileSignalInfo } from "../../api/analyzer";
import { chartTilesUsingSignal, computeSignalEvaluations, dependentsBySignalId } from "./signalEvaluations";

const reg = (id: string, extra: Partial<AnalyzerSignal> = {}): AnalyzerSignal => ({
  id,
  kind: "register",
  slaveId: 1,
  connectionKind: "serial",
  functionKind: "holding",
  registerRowId: 1,
  address: 0,
  functionCode: 3,
  alias: null,
  dataType: "u16",
  order: "ABCD",
  displayFormat: "dec",
  inputSignalIds: [],
  decoderJson: JSON.stringify({ scale: 0.1, decimals: 1 }),
  state: "OK",
  ...extra,
});

const power = JSON.stringify({
  math: {
    version: 1,
    inputs: [
      { name: "V", signalId: "a", value: "shown" },
      { name: "A", signalId: "b", value: "shown" },
    ],
    variables: [{ name: "P", kind: "calc", start: { ref: "V" }, steps: [{ op: "mul", operand: { ref: "A" } }, { op: "div", operand: { num: 1000 } }] }],
  },
  show: "P",
  decimals: 3,
});

const calc = (id: string, extra: Partial<AnalyzerSignal> = {}): AnalyzerSignal => ({
  ...reg(id),
  kind: "calculated",
  slaveId: null,
  registerRowId: null,
  address: null,
  functionCode: null,
  dataType: null,
  order: null,
  displayFormat: null,
  inputSignalIds: ["a", "b"],
  decoderJson: power,
  ...extra,
});

const okState = (_s: AnalyzerSignal, live: { state: string } | null) => (live?.state ?? "OK").toUpperCase();

describe("signalEvaluations", () => {
  it("evaluates register then calculated from live updates", () => {
    const signals = [calc("p"), reg("a"), reg("b")];
    const ev = computeSignalEvaluations({
      signals,
      live: {
        a: { state: "OK", rawWords: [2304], tsMs: 1 },
        b: { state: "OK", rawWords: [42], tsMs: 1 },
      },
      uiState: okState,
    });
    expect(ev.a.formatted).toBe("230.4");
    expect(ev.b.formatted).toBe("4.2");
    expect(ev.p.formatted).toBe("0.968");
    expect(ev.p.sample).toBe(0.968);
    expect(ev.p.state).toBe("OK");
  });

  it("uses lastValueJson when not live", () => {
    const signals = [
      reg("a", { lastValueJson: JSON.stringify({ rawWords: [2304] }) }),
      reg("b", { lastValueJson: JSON.stringify({ rawWords: [42] }) }),
      calc("p"),
    ];
    const ev = computeSignalEvaluations({ signals, live: {}, uiState: okState });
    expect(ev.p.formatted).toBe("0.968");
  });

  it("propagates a stale input to the calculated signal", () => {
    const signals = [reg("a"), reg("b"), calc("p")];
    const ev = computeSignalEvaluations({
      signals,
      live: { a: { state: "OK", rawWords: [2304], tsMs: 1 }, b: { state: "OK", rawWords: [42], tsMs: 1 } },
      uiState: (s) => (s.id === "a" ? "STALE" : "OK"),
    });
    expect(ev.p.state).toBe("STALE");
    expect(ev.p.sample).toBeNull();
  });

  it("without uiState there is no age staleness (decodes from the raw state)", () => {
    const signals = [reg("a", { lastUpdatedTsMs: 1, lastValueJson: JSON.stringify({ rawWords: [2304] }) }), reg("b", { lastUpdatedTsMs: 1, lastValueJson: JSON.stringify({ rawWords: [42] }) }), calc("p")];
    const ev = computeSignalEvaluations({ signals, live: {} });
    expect(ev.a.state).toBe("OK");
    expect(ev.a.formatted).toBe("230.4");
    expect(ev.p.formatted).toBe("0.968");
  });

  it("dependentsBySignalId maps inputs to calculated signals", () => {
    const deps = dependentsBySignalId([reg("a"), reg("b"), calc("p"), calc("q", { inputSignalIds: ["a"] })]);
    expect(deps.a).toEqual(["p", "q"]);
    expect(deps.b).toEqual(["p"]);
    expect(deps.p).toBeUndefined();
  });

  it("chartTilesUsingSignal returns only chart/trend tiles whose primary is the signal", () => {
    const tile = (id: number, kind: string, configJson = "{}"): AnalyzerTile => ({
      id,
      kind,
      title: "",
      configJson,
      pollingEnabled: true,
      createdAt: "",
      updatedAt: "",
    });
    const link = (tileId: number, signalId: string, role = "primary"): AnalyzerTileSignalInfo =>
      ({ tileId, signalId, role }) as AnalyzerTileSignalInfo;
    const tiles = [
      tile(1, "trend"),
      tile(2, "chart", JSON.stringify({ chartKind: "trend" })),
      tile(3, "value"),
      tile(4, "trend"),
    ];
    const tileSignals = {
      1: [link(1, "p")],
      2: [link(2, "p")],
      3: [link(3, "p")],
      4: [link(4, "a")],
    };
    expect(chartTilesUsingSignal("p", tiles, tileSignals).map((t) => t.id)).toEqual([1, 2]);
  });
});
