import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { AnalyzerSignal } from "../../api/analyzer";
import type { SlaveItem } from "../../api/slaves";
import AnalyzerConfigureSignalsModal from "./AnalyzerConfigureSignalsModal";

const deleteSignal = vi.fn();
vi.mock("../../api/analyzer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/analyzer")>()),
  deleteAnalyzerSignal: (...a: unknown[]) => deleteSignal(...a),
}));
vi.mock("../../api/slaves", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/slaves")>()),
  listSlaveRegisterRows: vi.fn(async () => []),
}));

const SLAVES: SlaveItem[] = [
  { id: 1, name: "PLC", unitId: 3, connectionKind: "tcp", pollIntervalMs: 1000, addressOffset: 0, createdAt: "", updatedAt: "" },
];

function signal(id: string, over: Partial<AnalyzerSignal> = {}): AnalyzerSignal {
  return {
    id, kind: "register", slaveId: 1, connectionKind: "tcp", functionKind: "holding", registerRowId: 7, address: 10,
    functionCode: 3, alias: id, dataType: "u16", order: null, displayFormat: null, inputSignalIds: [], decoderJson: "{}",
    state: "OK", ...over,
  };
}

const CALC = signal("Calc_1", { kind: "calculated", slaveId: null, registerRowId: null, address: null, functionKind: "", inputSignalIds: ["A", "B"] });

function modal(signals: AnalyzerSignal[], onClose = vi.fn()) {
  return (
    <AnalyzerConfigureSignalsModal
      open
      workspaceName="ws"
      signals={signals}
      slaves={SLAVES}
      addressFormat="dec"
      isPollingWanted={false}
      nowTsMs={0}
      getSignalPollIntervalMs={() => 1000}
      tiles={[]}
      tileSignals={{}}
      evaluations={{}}
      onClose={onClose}
      onAfterMutation={vi.fn(async () => {})}
      onError={vi.fn()}
      onToast={vi.fn()}
    />
  );
}

function renderModal(signals: AnalyzerSignal[]) {
  return render(modal(signals));
}

beforeEach(() => deleteSignal.mockReset());

describe("AnalyzerConfigureSignalsModal list", () => {
  it("shows a kind badge and the inputs of calculated signals", () => {
    renderModal([signal("A"), CALC]);
    expect(screen.getByText("Register")).toBeTruthy();
    expect(screen.getByText("Calculated")).toBeTruthy();
    expect(screen.getByText("Inputs: A, B")).toBeTruthy();
    expect(screen.getByText("Unit 3 | HOLDING | Addr 10")).toBeTruthy();
    expect(screen.queryByText(/Slave #null/)).toBeNull();
  });

  it("shows the backend delete error as-is", async () => {
    const message = 'Signal "A" is used by calculated signal(s): Calc_1. Remove it from their inputs first.';
    deleteSignal.mockRejectedValueOnce(message);
    renderModal([signal("A"), CALC]);
    fireEvent.click(screen.getByRole("button", { name: "Delete A" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    });
    expect(screen.getByText(message)).toBeTruthy();
  });

  it("Esc closes the editor back to the list", async () => {
    renderModal([signal("A")]);
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    await act(async () => {});
    expect(screen.getByText("Edit signal · A")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Edit signal · A")).toBeNull();
    expect(screen.getByText("Manage analyzer signals")).toBeTruthy();
  });

  it("falls back to the list when the edited signal vanishes, and Esc still closes", async () => {
    const onClose = vi.fn();
    const { rerender } = render(modal([signal("A"), signal("B")], onClose));
    fireEvent.click(screen.getAllByRole("button", { name: /Edit/ })[0]);
    await act(async () => {});
    expect(screen.getByText("Edit signal · A")).toBeTruthy();
    rerender(modal([signal("B")], onClose));
    await act(async () => {});
    expect(screen.getByText("Manage analyzer signals")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
