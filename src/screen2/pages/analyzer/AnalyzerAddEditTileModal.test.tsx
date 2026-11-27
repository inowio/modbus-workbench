import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AnalyzerSignal, AnalyzerTile, AnalyzerTileSignalInfo } from "../../api/analyzer";
import AnalyzerAddEditTileModal from "./AnalyzerAddEditTileModal";

function signal(id: string, over: Partial<AnalyzerSignal> = {}): AnalyzerSignal {
  return {
    id, kind: "register", slaveId: 1, connectionKind: "tcp", functionKind: "holding", registerRowId: 7, address: 10,
    functionCode: 3, alias: id, dataType: "u16", order: null, displayFormat: null, inputSignalIds: [], decoderJson: "{}",
    state: "OK", ...over,
  };
}

const rulesZ = {
  name: "z",
  kind: "rules",
  rules: [{ join: "and", conds: [{ left: { ref: "register" }, cmp: "gt", right: { num: 100 } }], then: { text: "High" } }],
  otherwise: { text: "Medium" },
};
const textMath = { version: 1, inputs: [], variables: [rulesZ] };

const NUM = signal("Temp");
const TEXT = signal("Level", { decoderJson: JSON.stringify({ math: textMath, show: "z" }) });
const CALC = signal("Calc_1", {
  kind: "calculated", slaveId: null, registerRowId: null, address: null, functionKind: "",
  inputSignalIds: ["Temp"],
  decoderJson: JSON.stringify({
    math: { version: 1, inputs: [{ name: "a", signalId: "Temp", value: "register" }], variables: [{ name: "y", kind: "calc", start: { ref: "a" }, steps: [] }] },
    show: "y",
  }),
});
const CALC_TEXT = signal("Calc_Text", {
  kind: "calculated", slaveId: null, registerRowId: null, address: null, functionKind: "",
  inputSignalIds: ["Level"],
  decoderJson: JSON.stringify({
    math: { version: 1, inputs: [{ name: "l", signalId: "Level", value: "z" }], variables: [{ name: "t", kind: "rules", rules: [{ join: "and", conds: [{ left: { num: 1 }, cmp: "gt", right: { num: 0 } }], then: { ref: "l" } }], otherwise: { num: 0 } }] },
    show: "t",
  }),
});

const SIGNALS = [NUM, TEXT, CALC, CALC_TEXT];

function modal(over: Partial<React.ComponentProps<typeof AnalyzerAddEditTileModal>> = {}) {
  return (
    <AnalyzerAddEditTileModal
      open
      mode="add"
      signals={SIGNALS}
      getSignalPollIntervalMs={() => 1000}
      editingTile={null}
      editingTilePrimary={null}
      onClose={vi.fn()}
      onSubmit={vi.fn()}
      {...over}
    />
  );
}

const signalSelect = () => screen.getByLabelText("Primary signal") as HTMLSelectElement;
const optionFor = (id: string) =>
  Array.from(signalSelect().options).find((o) => o.value === id) as HTMLOptionElement;

describe("AnalyzerAddEditTileModal signal picker", () => {
  it("value tile lists register and calculated signals", () => {
    render(modal({ initialKind: "value" }));
    expect(optionFor("Temp").textContent).toBe("Temp");
    expect(optionFor("Calc_1").textContent).toBe("Calc_1 · calculated");
    expect(optionFor("Level").disabled).toBe(false);
    expect(optionFor("Calc_Text").disabled).toBe(false);
  });

  it("trend tile disables text signals with a note", () => {
    render(modal({ initialKind: "trend" }));
    expect(optionFor("Temp").disabled).toBe(false);
    expect(optionFor("Calc_1").disabled).toBe(false);
    expect(optionFor("Level").disabled).toBe(true);
    expect(optionFor("Level").textContent?.endsWith("(text — can't be charted)")).toBe(true);
    expect(optionFor("Calc_Text").disabled).toBe(true);
    expect(optionFor("Calc_Text").textContent).toBe("Calc_Text · calculated (text — can't be charted)");
  });

  it("switching to trend clears a selected text signal", () => {
    const onSubmit = vi.fn();
    render(modal({ initialKind: "value", onSubmit }));
    fireEvent.change(signalSelect(), { target: { value: "Level" } });
    expect(signalSelect().value).toBe("Level");
    fireEvent.change(screen.getByLabelText("Tile type"), { target: { value: "trend" } });
    expect(signalSelect().value).toBe("Temp");
  });

  it("edit mode with an existing trend tile on a now-text signal shows it disabled without crashing", () => {
    const tile = { kind: "trend", title: "T" } as unknown as AnalyzerTile;
    const primary = { signalId: "Level" } as unknown as AnalyzerTileSignalInfo;
    render(modal({ mode: "edit", editingTile: tile, editingTilePrimary: primary }));
    expect(optionFor("Level").disabled).toBe(true);
    expect(optionFor("Level").textContent?.endsWith("(text — can't be charted)")).toBe(true);
    expect((screen.getByText("Save") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Text values can't be charted — pick a numeric signal or use a Value tile.")).toBeTruthy();
  });

  it("add-mode trend tile preselects the first numeric signal when the first signal is text", () => {
    render(modal({ initialKind: "trend", signals: [TEXT, NUM] }));
    expect(signalSelect().value).toBe("Temp");
    expect(screen.queryByText(/Text values can't be charted/)).toBeNull();
  });

  it("shows the hint when a trend tile has no numeric signal", () => {
    render(modal({ initialKind: "trend", signals: [TEXT] }));
    expect(screen.getByText(/Text values can't be charted/)).toBeTruthy();
  });
});

describe("AnalyzerAddEditTileModal poll interval", () => {
  it("uses the page's poll interval, so a calculated signal shows its fastest input", () => {
    const intervals: Record<string, number> = { Temp: 500, Calc_1: 250 };
    render(modal({ initialKind: "value", getSignalPollIntervalMs: (id) => intervals[id] ?? 1000 }));
    const interval = () => screen.getByText(/Poll interval:/).textContent;
    fireEvent.change(signalSelect(), { target: { value: "Calc_1" } });
    expect(interval()).toBe("Poll interval: 250 ms");
    fireEvent.change(signalSelect(), { target: { value: "Temp" } });
    expect(interval()).toBe("Poll interval: 500 ms");
  });
});
