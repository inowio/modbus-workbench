import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RegistersTab from "./RegistersTab";

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

const base = () => ({
  ws: "ws",
  registers: [reg(), reg({ id: 2, unitId: 2, alias: "Volt", valueSource: "device" })],
  devices: [],
  status: { running: false, listen: null, clientCount: 0 },
  snapshotFor: () => undefined,
  addrFmt: "dec" as const,
  onAddrFmt: vi.fn(),
  onSelectRegister: vi.fn(),
  onDelete: vi.fn(),
  onAddRegister: vi.fn(),
  onAddDevice: vi.fn(),
});

beforeEach(() => localStorage.clear());

describe("RegistersTab", () => {
  it("rows are focusable, selectable with Enter/Space, and flag the selected one (S6)", () => {
    const onSelectRegister = vi.fn();
    render(<RegistersTab {...base()} selectedId={2} onSelectRegister={onSelectRegister} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveAttribute("tabindex", "0");
    expect(rows[0]).not.toHaveAttribute("aria-current");
    expect(rows[1]).toHaveAttribute("aria-current", "true");
    expect(rows[1]).not.toHaveAttribute("aria-selected");
    expect(rows[1].className).toMatch(/bg-emerald/);
    fireEvent.keyDown(rows[0], { key: "Enter" });
    fireEvent.keyDown(rows[0], { key: " " });
    expect(onSelectRegister).toHaveBeenCalledTimes(2);
    expect(onSelectRegister).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("ignores Enter on the row's own Delete button (S6)", () => {
    const onSelectRegister = vi.fn();
    render(<RegistersTab {...base()} onSelectRegister={onSelectRegister} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /delete register temp/i }), { key: "Enter" });
    expect(onSelectRegister).not.toHaveBeenCalled();
  });

  it("shows a muted source summary in the Value column while stopped (S7)", () => {
    const regs = [
      reg({ id: 1, holdValue: 7 }),
      reg({ id: 2, alias: "G", valueSource: "generator", sourceParams: JSON.stringify({ kind: "sine", min: 0, max: 100 }) }),
      reg({ id: 3, alias: "D", valueSource: "device", sourceParams: JSON.stringify({ preset: "temperature" }) }),
      reg({ id: 4, alias: "R", valueSource: "route", sourceParams: JSON.stringify({ slaveUnitId: 3, functionCode: 3, address: 257 }) }),
    ];
    render(<RegistersTab {...base()} registers={regs} addrFmt="hex" />);
    expect(screen.getByText("hold 7")).toBeInTheDocument();
    expect(screen.getByText("sine 0–100")).toBeInTheDocument();
    expect(screen.getByText("preset temperature")).toBeInTheDocument();
    expect(screen.getByText("route → unit 3 holding 0x0101")).toBeInTheDocument();
  });

  it("replaces the summary with the live value while running (S7)", () => {
    render(
      <RegistersTab
        {...base()}
        registers={[reg({ holdValue: 7 })]}
        status={{ running: true, listen: null, clientCount: 0 }}
        snapshotFor={() => ({ unitId: 1, functionCode: 3, address: 5, valueWord: 42, valueBit: null })}
      />,
    );
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.queryByText("hold 7")).toBeNull();
  });

  it("renders all rows then filters by search", () => {
    render(<RegistersTab {...base()} />);
    expect(screen.getAllByRole("row").length).toBeGreaterThan(2);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "volt" } });
    expect(screen.getByText("Volt")).toBeInTheDocument();
    expect(screen.queryByText("Temp")).not.toBeInTheDocument();
  });

  it("Add Register triggers callback", () => {
    const p = base();
    render(<RegistersTab {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /add register/i }));
    expect(p.onAddRegister).toHaveBeenCalled();
  });

  it("Add Device triggers callback", () => {
    const p = base();
    render(<RegistersTab {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /add device/i }));
    expect(p.onAddDevice).toHaveBeenCalled();
  });

  it("shows R/W for holding registers", () => {
    render(<RegistersTab {...base()} />);
    expect(screen.getAllByText("R/W").length).toBeGreaterThan(0);
  });

  it("clicking a row calls onSelectRegister with the register", () => {
    const p = base();
    render(<RegistersTab {...p} />);
    fireEvent.click(screen.getByText("Temp"));
    expect(p.onSelectRegister).toHaveBeenCalledWith(expect.objectContaining({ id: 1, alias: "Temp" }));
  });

  it("Delete action calls onDelete with the register id", () => {
    const p = base();
    render(<RegistersTab {...p} />);
    fireEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]);
    expect(p.onDelete).toHaveBeenCalledWith(1);
  });

  it("shows empty state with Add Register / Add Device CTAs when there are no registers", () => {
    const p = { ...base(), registers: [] };
    render(<RegistersTab {...p} />);
    expect(screen.getByText(/no registers/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /add register/i })[0]);
    expect(p.onAddRegister).toHaveBeenCalled();
  });

  it("Dec/Hex toggle calls onAddrFmt", () => {
    const p = base();
    render(<RegistersTab {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /hex addresses/i }));
    expect(p.onAddrFmt).toHaveBeenCalledWith("hex");
  });

  it("closes the Columns menu on Escape and on an outside click", () => {
    render(<RegistersTab {...base()} />);
    const toggle = screen.getByRole("button", { name: /show or hide columns/i });

    // Opens, then Escape closes it.
    fireEvent.click(toggle);
    expect(screen.getByLabelText(/toggle unit column/i)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByLabelText(/toggle unit column/i)).not.toBeInTheDocument();

    // Opens again, then a click outside closes it.
    fireEvent.click(toggle);
    expect(screen.getByLabelText(/toggle unit column/i)).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByLabelText(/toggle unit column/i)).not.toBeInTheDocument();
  });

  it("shows scaled engineering values while running and in the stopped summary", () => {
    const scaled = reg({ dataType: "u16", unit: "°C", scale: 0.1, holdValue: 235 });
    const { unmount } = render(
      <RegistersTab
        {...base()}
        registers={[scaled]}
        status={{ running: true, listen: null, clientCount: 0 }}
        snapshotFor={() => ({ unitId: 1, functionCode: 3, address: 5, valueWord: 235, valueBit: null })}
      />,
    );
    expect(screen.getByText("23.5 °C")).toBeInTheDocument();
    unmount();
    const gen = reg({ id: 2, alias: "G", unit: "°C", scale: 0.1, valueSource: "generator", sourceParams: JSON.stringify({ kind: "sine", min: 20, max: 30 }) });
    render(<RegistersTab {...base()} registers={[scaled, gen]} />);
    expect(screen.getByText("hold 23.5 °C")).toBeInTheDocument();
    expect(screen.getByText("sine 20–30 °C")).toBeInTheDocument();
  });

  it("decodes a two-word f32 live value", () => {
    const f = reg({ dataType: "f32", address: 10 });
    const words: Record<number, number> = { 10: 0x420e, 11: 0 };
    render(
      <RegistersTab
        {...base()}
        registers={[f]}
        status={{ running: true, listen: null, clientCount: 0 }}
        snapshotFor={(u, fc, a) => (a in words ? { unitId: u, functionCode: fc, address: a, valueWord: words[a], valueBit: null } : undefined)}
      />,
    );
    expect(screen.getByText("35.500")).toBeInTheDocument();
  });
});
