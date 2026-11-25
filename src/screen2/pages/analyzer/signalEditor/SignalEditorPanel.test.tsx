import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { AnalyzerSignal, AnalyzerTile, AnalyzerTileSignalInfo } from "../../../api/analyzer";
import type { SlaveItem, SlaveRegisterRow } from "../../../api/slaves";
import type { MathResult, SignalMath } from "../../../utils/analyzerMath";
import type { SignalEvaluation } from "../../../utils/analyzerSignalEval";
import SignalEditorPanel from "./SignalEditorPanel";

const upsert = vi.fn();
const listRows = vi.fn();

vi.mock("../../../api/analyzer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/analyzer")>()),
  upsertAnalyzerSignal: (...a: unknown[]) => upsert(...a),
}));
vi.mock("../../../api/slaves", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/slaves")>()),
  listSlaveRegisterRows: (...a: unknown[]) => listRows(...a),
}));

const ok = (n: number): MathResult => ({ ok: true, value: { kind: "number", value: n } });

const EXAMPLE: SignalMath = {
  version: 1,
  inputs: [],
  variables: [
    { name: "x", kind: "calc", start: { ref: "register" }, steps: [] },
    { name: "y", kind: "calc", start: { ref: "x" }, steps: [{ op: "div", operand: { num: 10 } }] },
    {
      name: "z",
      kind: "rules",
      rules: [
        { join: "and", conds: [{ left: { ref: "y" }, cmp: "ge", right: { num: 50 } }], then: { text: "High" } },
        { join: "and", conds: [{ left: { ref: "y" }, cmp: "ge", right: { num: 20 } }], then: { text: "Medium" } },
      ],
      otherwise: { text: "Low" },
    },
  ],
};

const SLAVES: SlaveItem[] = [
  { id: 1, name: "PLC", unitId: 1, connectionKind: "tcp", pollIntervalMs: 1000, addressOffset: 0, createdAt: "", updatedAt: "" },
];
const ROWS: SlaveRegisterRow[] = [
  { id: 7, slaveId: 1, functionCode: 3, address: 10, alias: "Temp", dataType: "u16", order: "ABCD", displayFormat: "dec", updatedAt: "" },
];

function signal(id: string, over: Partial<AnalyzerSignal> = {}): AnalyzerSignal {
  return {
    id, kind: "register", slaveId: 1, connectionKind: "tcp", functionKind: "holding", registerRowId: 7, address: 10,
    functionCode: 3, alias: id, dataType: "u16", order: null, displayFormat: null, inputSignalIds: [], decoderJson: "{}",
    state: "OK", ...over,
  };
}

function evaluation(over: Partial<SignalEvaluation>): SignalEvaluation {
  return { state: "OK", formatted: "", shown: ok(0), register: null, variables: {}, sample: null, valueType: "number", ...over };
}

type PanelProps = ComponentProps<typeof SignalEditorPanel>;

async function renderPanel(over: Partial<PanelProps> = {}) {
  const props: PanelProps = {
    mode: "edit",
    signal: null,
    workspaceName: "ws",
    signals: [],
    slaves: SLAVES,
    tiles: [],
    tileSignals: {},
    evaluations: {},
    addressFormat: "dec",
    polling: true,
    onCancel: vi.fn(),
    onSaved: vi.fn(),
    onError: vi.fn(),
    ...over,
  };
  const utils = render(<SignalEditorPanel {...props} />);
  await act(async () => {}); // let the register rows load
  return { ...utils, props };
}

const saveButton = () => screen.getByRole("button", { name: /^Save$/ });

beforeEach(() => {
  upsert.mockReset();
  upsert.mockResolvedValue({});
  listRows.mockReset();
  listRows.mockResolvedValue(ROWS);
});

describe("SignalEditorPanel", () => {
  it("editor is the large panel with Data and Math tabs", async () => {
    const s = signal("Temp_1", { decoderJson: JSON.stringify({ math: EXAMPLE }) });
    await renderPanel({ signal: s, signals: [s] });
    expect(screen.getByRole("dialog").className).toContain("max-w-[1800px]");
    expect(screen.getByRole("tab", { name: /^Data/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Math \(3\)/ })).toBeTruthy();
  });

  it("kind toggle only in add mode", async () => {
    const s = signal("Temp_1");
    const { unmount } = await renderPanel({ mode: "add", signals: [s] });
    expect(screen.getByRole("radio", { name: "Register signal" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Calculated signal" })).toBeTruthy();
    unmount();
    await renderPanel({ signal: s, signals: [s] });
    expect(screen.queryByRole("radio", { name: "Register signal" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Calculated signal" })).toBeNull();
  });

  it("show value lists register value and variables with results", async () => {
    const s = signal("Temp_1", { decoderJson: JSON.stringify({ math: EXAMPLE }) });
    await renderPanel({ signal: s, signals: [s], evaluations: { Temp_1: evaluation({ register: ok(328) }) } });
    const select = screen.getByLabelText("Show value") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toEqual(["Register value", "x · 328", "y · 32.8", "z · Medium · text"]);
  });

  it("save is blocked while a reference is broken", async () => {
    const broken: SignalMath = { version: 1, inputs: [], variables: [{ name: "x", kind: "calc", start: { ref: "q" }, steps: [] }] };
    const s = signal("Temp_1", { decoderJson: JSON.stringify({ math: broken }) });
    await renderPanel({ signal: s, signals: [s] });
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    const mathTab = screen.getByRole("tab", { name: /Math/ });
    expect(within(mathTab).getByLabelText("has errors")).toBeTruthy();
    expect(within(screen.getByRole("tab", { name: /^Data/ })).queryByLabelText("has errors")).toBeNull();
  });

  it("save is blocked when a chart tile would get text", async () => {
    const s = signal("Temp_1", { decoderJson: JSON.stringify({ show: "z", math: EXAMPLE }) });
    const tiles: AnalyzerTile[] = [{ id: 5, kind: "chart", title: "Boiler temp", configJson: "{}", pollingEnabled: true, createdAt: "", updatedAt: "" }];
    const tileSignals: Record<number, AnalyzerTileSignalInfo[]> = {
      5: [{ tileId: 5, signalId: "Temp_1", role: "primary" } as AnalyzerTileSignalInfo],
    };
    await renderPanel({ signal: s, signals: [s], tiles, tileSignals });
    expect(screen.getByText("Used by chart tiles: Boiler temp. Change them to Value tiles or pick a numeric Show value.")).toBeTruthy();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("saving a calculated signal calls upsert with kind calculated", async () => {
    const src = signal("Temp_1");
    const onSaved = vi.fn();
    await renderPanel({ mode: "add", signals: [src], onSaved });

    fireEvent.click(screen.getByRole("radio", { name: "Calculated signal" }));
    expect((screen.getByLabelText("Signal ID") as HTMLInputElement).value).toBe("Calc_1");
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("tab", { name: /Math/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add input" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add variable" }));
    fireEvent.click(screen.getByRole("button", { name: "Calculation" }));

    fireEvent.click(screen.getByRole("tab", { name: /^Data/ }));
    const show = screen.getByLabelText("Show value") as HTMLSelectElement;
    expect(Array.from(show.options).some((o) => o.value === "register")).toBe(false);
    // The first variable is picked for Show value automatically.
    expect(show.value).toBe("v1");

    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    const [ws, payload] = upsert.mock.calls[0];
    expect(ws).toBe("ws");
    expect(payload).toMatchObject({ id: "Calc_1", kind: "calculated", slaveId: null, registerRowId: null, functionKind: "" });
    const cfg = JSON.parse(payload.decoderJson);
    expect(cfg.show).toBe("v1");
    expect(cfg.math.inputs).toEqual([{ name: "in1", signalId: "Temp_1", value: "shown" }]);
    // A new Calculation starts on the first input.
    expect(cfg.math.variables[0]).toEqual({ name: "v1", kind: "calc", start: { ref: "in1" }, steps: [] });
    expect(onSaved).toHaveBeenCalledWith("Calc_1");
  });

  it("Esc closes the editor", async () => {
    const onCancel = vi.fn();
    await renderPanel({ signal: signal("Temp_1"), signals: [signal("Temp_1")], onCancel });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("saving an old register signal unchanged keeps its decoder JSON", async () => {
    const json = '{"bit":3,"scale":0.1,"offset":-2,"clampMin":0,"clampMax":100,"decimals":2,"unit":"degC"}';
    const s = signal("Temp_1", { decoderJson: json });
    await renderPanel({ signal: s, signals: [s] });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    const [, payload] = upsert.mock.calls[0];
    expect(payload).toMatchObject({ id: "Temp_1", kind: "register", slaveId: 1, functionKind: "holding", registerRowId: 7 });
    expect(JSON.parse(payload.decoderJson)).toEqual(JSON.parse(json));
  });

  it("switching to Register drops calculated inputs", async () => {
    const src = signal("Temp_1");
    await renderPanel({ mode: "add", signals: [src] });
    fireEvent.click(screen.getByRole("radio", { name: "Calculated signal" }));
    fireEvent.click(screen.getByRole("tab", { name: /Math/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add input" }));
    expect(screen.getByLabelText("Input 1 name")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Register signal" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("tab", { name: /Math/ }));
    expect(screen.queryByLabelText("Input 1 name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Add variable" }));
    fireEvent.click(screen.getByRole("button", { name: "Calculation" }));
    const start = screen.getByLabelText("v1 start") as HTMLSelectElement;
    const refs = Array.from(start.options).map((o) => o.value);
    expect(refs).toContain("register");
    expect(refs).not.toContain("in1");
  });

  it("while live, changing Decimals or Unit updates the preview", async () => {
    const s = signal("Temp_1", { decoderJson: JSON.stringify({ unit: "°C", decimals: 1, show: "y", math: EXAMPLE }) });
    const live = evaluation({ register: ok(328), formatted: "32.8 °C", shown: ok(32.8) });
    await renderPanel({ signal: s, signals: [s], evaluations: { Temp_1: live } });
    const preview = () => screen.getByRole("group", { name: "Tile preview" }).textContent ?? "";
    expect(preview()).toContain("32.8 °C");
    expect(preview()).toContain("Live value");

    fireEvent.change(screen.getByLabelText("Decimals (0-12)"), { target: { value: "2" } });
    expect(preview()).toContain("32.80 °C");
    fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "V" } });
    expect(preview()).toContain("32.80 V");
  });

  it("while live, changing Scale shows a save note and no stale number", async () => {
    const s = signal("Temp_1", { decoderJson: JSON.stringify({ unit: "°C", decimals: 1, show: "y", math: EXAMPLE }) });
    const live = evaluation({ register: ok(328), formatted: "32.8 °C", shown: ok(32.8) });
    await renderPanel({ signal: s, signals: [s], evaluations: { Temp_1: live } });
    const preview = () => screen.getByRole("group", { name: "Tile preview" }).textContent ?? "";
    expect(preview()).toContain("32.8 °C");

    fireEvent.change(screen.getByLabelText("Scale"), { target: { value: "0.1" } });
    expect(preview()).toContain("—");
    expect(preview()).toContain("Save to preview register or Scale/Offset/Clamp/Bit changes");
    expect(preview()).not.toContain("32.8");
    expect(preview()).not.toContain("Live value");

    // Try it must not offer the saved-transform register value as live for the draft.
    fireEvent.click(screen.getByRole("tab", { name: /Math/ }));
    const useLive = screen.getByLabelText("Use live values") as HTMLInputElement;
    expect(useLive.checked).toBe(false);
    expect(useLive.disabled).toBe(true);
    expect(screen.getByText("Live values use the saved register and Scale/Offset/Clamp/Bit. Save to use them, or type a value.")).toBeTruthy();
    expect((screen.getByLabelText("Try it register value") as HTMLInputElement).value).toBe("");

    // A typed register value (already scaled) still previews, labelled as typed.
    fireEvent.change(screen.getByLabelText("Try it register value"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("tab", { name: /^Data/ }));
    expect(preview()).toContain("50.0 °C");
    expect(preview()).toContain("From Try it values");

    // Undoing the change brings the live value back.
    fireEvent.change(screen.getByLabelText("Scale"), { target: { value: "" } });
    expect(preview()).toContain("32.8 °C");
    expect(preview()).toContain("Live value");
  });

  it("while live, re-pointing the register stops showing the old register's value", async () => {
    listRows.mockResolvedValue([
      ...ROWS,
      { id: 8, slaveId: 1, functionCode: 3, address: 11, alias: "Humidity", dataType: "u16", order: "ABCD", displayFormat: "dec", updatedAt: "" },
    ]);
    const s = signal("Temp_1", { decoderJson: JSON.stringify({ unit: "°C", decimals: 1, show: "y", math: EXAMPLE }) });
    const live = evaluation({ register: ok(328), formatted: "32.8 °C", shown: ok(32.8) });
    await renderPanel({ signal: s, signals: [s], evaluations: { Temp_1: live } });
    const preview = () => screen.getByRole("group", { name: "Tile preview" }).textContent ?? "";
    expect(preview()).toContain("Live value");

    fireEvent.change(screen.getByLabelText("Register address"), { target: { value: "8" } });
    expect(preview()).toContain("Save to preview register or Scale/Offset/Clamp/Bit changes");
    expect(preview()).not.toContain("32.8");

    fireEvent.click(screen.getByRole("tab", { name: /Math/ }));
    expect((screen.getByLabelText("Use live values") as HTMLInputElement).disabled).toBe(true);
    expect(document.body.textContent).not.toContain("→ 328");

    // Pointing back at the saved register brings the live value back.
    fireEvent.click(screen.getByRole("tab", { name: /^Data/ }));
    fireEvent.change(screen.getByLabelText("Register address"), { target: { value: "7" } });
    expect(preview()).toContain("32.8 °C");
    expect(preview()).toContain("Live value");
  });

  it("a variable a calculated signal reads can't be renamed away, and the Math tab says who uses it", async () => {
    const src = signal("Temp_1", { decoderJson: JSON.stringify({ show: "y", math: EXAMPLE }) });
    const calcMath = {
      version: 1,
      inputs: [{ name: "C", signalId: "Temp_1", value: "y" }],
      variables: [{ name: "F", kind: "calc", start: { ref: "C" }, steps: [] }],
    };
    const calc = signal("Calc_F", {
      kind: "calculated", slaveId: null, registerRowId: null, address: null, functionKind: "", inputSignalIds: ["Temp_1"],
      decoderJson: JSON.stringify({ show: "F", math: calcMath }),
    });
    await renderPanel({ signal: src, signals: [src, calc] });
    fireEvent.click(screen.getByRole("tab", { name: /Math/ }));
    expect(screen.getByRole("note").textContent).toContain('Used by calculated signal Calc_F, which reads "y"');
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);

    const name = screen.getByLabelText("Variable 2 name");
    fireEvent.change(name, { target: { value: "y2" } });
    fireEvent.blur(name);
    expect(screen.getByText('Calc_F uses variable "y". Keep that variable, or change the calculated signal\'s inputs first.')).toBeTruthy();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("while stopped, the stored value is labelled as the last value, not live", async () => {
    const s = signal("Temp_1", { decoderJson: JSON.stringify({ unit: "°C", decimals: 1, show: "y", math: EXAMPLE }) });
    const last = evaluation({ register: ok(328), formatted: "32.8 °C", shown: ok(32.8) });
    await renderPanel({ signal: s, signals: [s], evaluations: { Temp_1: last }, polling: false });
    const preview = screen.getByRole("group", { name: "Tile preview" }).textContent ?? "";
    expect(preview).toContain("32.8 °C");
    expect(preview).toContain("Last value (analyzer stopped)");
    expect(preview).not.toContain("Live value");
  });

  it("a typed Try it register value previews Register value", async () => {
    const s = signal("Temp_1", { decoderJson: '{"unit":"V","decimals":1}' });
    await renderPanel({ signal: s, signals: [s] });
    const preview = () => screen.getByRole("group", { name: "Tile preview" }).textContent ?? "";
    expect(preview()).toContain("—");
    fireEvent.click(screen.getByRole("tab", { name: /Math/ }));
    fireEvent.change(screen.getByLabelText("Try it register value"), { target: { value: "12.34" } });
    fireEvent.click(screen.getByRole("tab", { name: /^Data/ }));
    expect(preview()).toContain("12.3 V");
  });

  it("slaves that arrive late fill in the first slave", async () => {
    const { rerender, props } = await renderPanel({ mode: "add", slaves: [] });
    rerender(<SignalEditorPanel {...props} slaves={SLAVES} />);
    await act(async () => {});
    expect((screen.getByLabelText("Slave") as HTMLSelectElement).value).toBe("1");
    expect(listRows).toHaveBeenCalledWith("ws", 1, 4);
  });

  it("save checks show inline in the editor", async () => {
    const onError = vi.fn();
    const s = signal("Temp_1", { slaveId: 99 });
    await renderPanel({ signal: s, signals: [s], onError });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("Slave not found");
    expect(screen.getByText("Slave not found")).toBeTruthy();
  });

  it("Esc inside a name chip cancels the rename, not the editor", async () => {
    const onCancel = vi.fn();
    const s = signal("Temp_1", { decoderJson: JSON.stringify({ math: EXAMPLE }) });
    await renderPanel({ signal: s, signals: [s], onCancel });
    fireEvent.click(screen.getByRole("tab", { name: /Math/ }));
    fireEvent.keyDown(screen.getByLabelText("Variable 1 name"), { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("save errors from the backend show as-is", async () => {
    upsert.mockRejectedValueOnce("Signal kind can't be changed");
    const onError = vi.fn();
    const s = signal("Temp_1", { decoderJson: '{"unit":"V"}' });
    await renderPanel({ signal: s, signals: [s], onError });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(onError).toHaveBeenCalledWith("Signal kind can't be changed");
    expect(screen.getByText("Signal kind can't be changed")).toBeTruthy();
  });

  it("tile preview formats the shown value with decimals and unit", async () => {
    const s = signal("Temp_1", { decoderJson: JSON.stringify({ unit: "°C", decimals: 1, show: "y", math: EXAMPLE }) });
    await renderPanel({ signal: s, signals: [s] });
    const preview = screen.getByLabelText("Tile preview");
    expect(preview.textContent).toContain("—");
    fireEvent.click(screen.getByRole("tab", { name: /Math/ }));
    fireEvent.change(screen.getByLabelText("Try it register value"), { target: { value: "328" } });
    expect(screen.getByLabelText("Tile preview").textContent).toContain("32.8 °C");
  });
});
