import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { createLiveStore, type SnapshotRow } from "./liveValues";
import LiveValuesTab from "./LiveValuesTab";

const liveOf = (rows: SnapshotRow[] = []) => {
  const s = createLiveStore();
  s.apply({ full: true, rows });
  return s;
};

const reg = (o: any = {}) => ({
  id: 1,
  unitId: 1,
  functionCode: 3,
  address: 5,
  alias: "Temp",
  dataType: "u16",
  holdValue: 0,
  sortOrder: 0,
  valueSource: "hold",
  byteOrder: "ABCD",
  sourceParams: "{}",
  intervalMs: 1000,
  deviceInstanceId: null,
  ...o,
});

describe("LiveValuesTab", () => {
  it("shows placeholder when stopped", () => {
    render(
      <LiveValuesTab
        registers={[]}
        live={liveOf()}
        status={{ running: false, listen: null, clientCount: 0 }}
      />
    );
    expect(screen.getByText(/start the server/i)).toBeInTheDocument();
  });

  it("offers a Start button when stopped (S8)", () => {
    const onStart = vi.fn();
    render(
      <LiveValuesTab
        registers={[]}
        live={liveOf()}
        status={{ running: false, listen: null, clientCount: 0 }}
        onStart={onStart}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onStart).toHaveBeenCalled();
  });

  it("renders a row per register with live word value when running", () => {
    render(
      <LiveValuesTab
        registers={[reg()]}
        live={liveOf([{ unitId: 1, functionCode: 3, address: 5, valueWord: 42, valueBit: null, sourceStatus: "ok" }])}
        status={{ running: true, listen: { bound: "0.0.0.0", port: 502, addresses: ["127.0.0.1:502"] }, clientCount: 1 }}
      />
    );
    expect(screen.getByText("Temp")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText(/ok/i)).toBeInTheDocument();
  });

  it("renders ON/OFF for bit values and — for missing snapshot", () => {
    render(
      <LiveValuesTab
        registers={[reg({ id: 2, alias: "Coil", functionCode: 1 }), reg({ id: 3, alias: "NoData", address: 9 })]}
        live={liveOf([{ unitId: 1, functionCode: 1, address: 5, valueWord: null, valueBit: true, sourceStatus: "stale" }])}
        status={{ running: true, listen: null, clientCount: 0 }}
      />
    );
    expect(screen.getByText("ON")).toBeInTheDocument();
    expect(screen.getByText(/stale/i)).toBeInTheDocument();
    expect(screen.getByText("NoData")).toBeInTheDocument();
  });

  it("shows addresses in hex and searches hex when the Hex toggle is on (F10)", () => {
    const running = { running: true, listen: null, clientCount: 0 };
    const regs = [reg({ id: 1, address: 257, alias: "A" }), reg({ id: 2, address: 5, alias: "B" })];
    render(<LiveValuesTab registers={regs} live={liveOf()} status={running} addrFmt="hex" />);
    expect(screen.getByText("0x0101")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "0x101" } });
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.queryByText("B")).toBeNull();
  });

  it("shows the scaled value with its unit", () => {
    render(
      <LiveValuesTab
        registers={[reg({ unit: "°C", scale: 0.1 })]}
        live={liveOf([{ unitId: 1, functionCode: 3, address: 5, valueWord: 235, valueBit: null }])}
        status={{ running: true, listen: null, clientCount: 0 }}
      />
    );
    expect(screen.getByText("23.5 °C")).toBeInTheDocument();
  });
});
