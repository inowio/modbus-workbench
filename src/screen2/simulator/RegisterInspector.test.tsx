import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RegisterInspector from "./RegisterInspector";
import type { PageRegister } from "./simFilters";
import { blankRegister } from "./simRegister";
import type { SimDevice } from "./useSimulatorData";

const reg: PageRegister = {
  id: 1,
  unitId: 1,
  functionCode: 3,
  address: 40001,
  alias: "Temperature",
  dataType: "f32",
  holdValue: 0,
  sortOrder: 0,
  valueSource: "device",
  byteOrder: "ABCD",
  sourceParams: JSON.stringify({ preset: "temperature", min: 0, max: 100 }),
  intervalMs: 500,
  deviceInstanceId: 7,
  unit: "°C",
  displayFormat: "dec2",
};

const devices: SimDevice[] = [
  { id: 7, templateKey: "th", name: "Temp Sensor A", unitId: 1, baseAddress: 40001, sortOrder: 0 },
];

const base = () => ({
  register: reg,
  devices,
  history: [23.1, 23.3, 23.45],
  liveValue: "23.45 °C",
  sourceStatus: "ok",
  running: true,
  onSave: vi.fn(),
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
  onClose: vi.fn(),
  onViewDevice: vi.fn(),
});

describe("RegisterInspector", () => {
  it("renders nothing when no register is selected", () => {
    const { container } = render(<RegisterInspector {...base()} register={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the register with Unit and derived Read-Write access", () => {
    render(<RegisterInspector {...base()} />);
    expect(screen.getByText("Temperature")).toBeInTheDocument();
    expect((screen.getByLabelText(/^unit$/i) as HTMLInputElement).value).toBe("°C");
    // FC 3 (holding) is derived as Read-Write via rwLabel.
    expect(screen.getByText(/read-write/i)).toBeInTheDocument();
  });

  it("edits unit and saves", () => {
    const p = base();
    render(<RegisterInspector {...p} />);
    fireEvent.change(screen.getByLabelText(/^unit$/i), { target: { value: "K" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(p.onSave).toHaveBeenCalledWith(expect.objectContaining({ unit: "K" }));
  });

  it("duplicate and delete fire", () => {
    const p = base();
    render(<RegisterInspector {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /duplicate/i }));
    expect(p.onDuplicate).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(p.onDelete).toHaveBeenCalledWith(1);
  });

  it("shows the owning device and calls onViewDevice", () => {
    const p = base();
    render(<RegisterInspector {...p} />);
    expect(screen.getByText("Temp Sensor A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /view device/i }));
    expect(p.onViewDevice).toHaveBeenCalledWith(7);
  });

  it("switches to the Source tab and shows the matching param editor", () => {
    render(<RegisterInspector {...base()} />);
    fireEvent.click(screen.getByRole("tab", { name: /source/i }));
    expect(screen.getByLabelText(/device preset/i)).toBeInTheDocument();
  });

  it("renders gracefully with empty history (no crash)", () => {
    render(<RegisterInspector {...base()} history={[]} />);
    expect(screen.getByText("Temperature")).toBeInTheDocument();
  });

  it("re-seeds edit state when the register id changes", () => {
    const p = base();
    const { rerender } = render(<RegisterInspector {...p} />);
    fireEvent.change(screen.getByLabelText(/^unit$/i), { target: { value: "K" } });
    const other: PageRegister = { ...reg, id: 2, alias: "Pressure", unit: "kPa" };
    rerender(<RegisterInspector {...p} register={other} />);
    expect(screen.getByText("Pressure")).toBeInTheDocument();
    expect((screen.getByLabelText(/^unit$/i) as HTMLInputElement).value).toBe("kPa");
  });

  it("keeps the action row pinned outside a height-limited scrolling body (F2)", () => {
    render(<RegisterInspector {...base()} />);
    const save = screen.getByRole("button", { name: /^save$/i });
    const actionRow = save.parentElement as HTMLElement;
    const root = actionRow.parentElement as HTMLElement;
    expect(root.className).toMatch(/max-h-\[calc\(100vh-/);
    expect(root.className).not.toMatch(/h-full/);
    expect(actionRow.className).toMatch(/shrink-0/);
    const body = root.querySelector(".overflow-y-auto") as HTMLElement;
    expect(body).not.toBeNull();
    expect(body.className).toMatch(/min-h-0/);
    expect(body.contains(save)).toBe(false);
  });

  it("shows Access as plain text, not an input-styled box (F9)", () => {
    render(<RegisterInspector {...base()} />);
    const access = screen.getByText("Read-Write");
    expect(access.className).not.toMatch(/border|bg-/);
    render(<RegisterInspector {...base()} register={{ ...reg, id: 3, functionCode: 4 }} />);
    expect(screen.getByText("Read only")).toBeInTheDocument();
  });

  it("saving only the alias of a preset register without a period leaves periodMs absent (I1)", () => {
    const p = base();
    render(<RegisterInspector {...p} />);
    fireEvent.change(screen.getByDisplayValue("Temperature"), { target: { value: "Temp 2" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const saved = p.onSave.mock.calls[0][0] as PageRegister;
    expect(saved.alias).toBe("Temp 2");
    expect(JSON.parse(saved.sourceParams)).toEqual({ preset: "temperature", min: 0, max: 100 });
  });

  it("shows an empty period with a default placeholder for a preset register (I1)", () => {
    render(<RegisterInspector {...base()} />);
    fireEvent.click(screen.getByRole("tab", { name: /source/i }));
    const period = screen.getByLabelText(/period ms/i) as HTMLInputElement;
    expect(period.value).toBe("");
    expect(period.placeholder).toMatch(/default/i);
  });

  it("a generator register still defaults its period to 1000 ms (I1)", () => {
    const p = base();
    const gen = { ...reg, id: 9, valueSource: "generator", sourceParams: JSON.stringify({ kind: "sine", min: 0, max: 10 }) };
    render(<RegisterInspector {...p} register={gen} />);
    fireEvent.change(screen.getByDisplayValue("Temperature"), { target: { value: "Gen" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(JSON.parse((p.onSave.mock.calls[0][0] as PageRegister).sourceParams).periodMs).toBe(1000);
  });

  describe("polish (S5)", () => {
    it("shows the header address in Hex when the setting is hex", () => {
      render(<RegisterInspector {...base()} addrFmt="hex" />);
      expect(screen.getByText(/Unit 1 · Holding · 0x9C41/)).toBeInTheDocument();
    });

    it("removes the duplicated Value Source and Interval footer lines", () => {
      render(<RegisterInspector {...base()} />);
      expect(screen.queryByText(/^Value Source:/)).toBeNull();
      expect(screen.queryByText(/^Interval:/)).toBeNull();
      expect(screen.getByText("Temp Sensor A")).toBeInTheDocument();
    });

    it("closes on Escape", () => {
      const p = base();
      render(<RegisterInspector {...p} />);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(p.onClose).toHaveBeenCalled();
    });

    it("does not close on Escape while a modal dialog is open", () => {
      const p = base();
      render(<><RegisterInspector {...p} /><div role="dialog" aria-modal="true" /></>);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(p.onClose).not.toHaveBeenCalled();
    });

    it("disables Save until something changes, then flags unsaved changes", () => {
      const p = base();
      render(<RegisterInspector {...p} />);
      const save = screen.getByRole("button", { name: /^save$/i });
      expect(save).toBeDisabled();
      expect(screen.queryByText(/unsaved changes/i)).toBeNull();
      fireEvent.change(screen.getByLabelText(/^unit$/i), { target: { value: "K" } });
      expect(save).not.toBeDisabled();
      expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(/^unit$/i), { target: { value: "°C" } });
      expect(save).toBeDisabled();
    });

    it("reports dirty state to the page", () => {
      const onDirtyChange = vi.fn();
      render(<RegisterInspector {...base()} onDirtyChange={onDirtyChange} />);
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
      fireEvent.change(screen.getByLabelText(/^unit$/i), { target: { value: "K" } });
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });

    it("a hold register switched to Device saves without a periodMs (I2)", () => {
      const p = base();
      const hold = { ...reg, id: 5, valueSource: "hold", dataType: "u16", sourceParams: "{}" };
      render(<RegisterInspector {...p} register={hold} />);
      fireEvent.click(screen.getByRole("tab", { name: /source/i }));
      fireEvent.change(screen.getByLabelText(/value source/i), { target: { value: "device" } });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(JSON.parse((p.onSave.mock.calls[0][0] as PageRegister).sourceParams)).not.toHaveProperty("periodMs");
    });

    it("edits the update interval of a saved register and tracks it as dirty (I1)", () => {
      const p = base();
      render(<RegisterInspector {...p} />);
      fireEvent.click(screen.getByRole("tab", { name: /source/i }));
      expect((screen.getByLabelText("Interval ms") as HTMLInputElement).value).toBe("500");
      fireEvent.change(screen.getByLabelText("Interval ms"), { target: { value: "2000" } });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(p.onSave).toHaveBeenCalledWith(expect.objectContaining({ intervalMs: 2000 }));
    });

    it("does not stay dirty after saving a non-canonical period like 02500 (M1)", () => {
      const p = base();
      const gen = { ...reg, id: 9, valueSource: "generator", sourceParams: JSON.stringify({ kind: "sine", min: 0, max: 10, periodMs: 1000 }) };
      const { rerender } = render(<RegisterInspector {...p} register={gen} />);
      fireEvent.click(screen.getByRole("tab", { name: /source/i }));
      fireEvent.change(screen.getByLabelText(/period ms/i), { target: { value: "02500" } });
      const save = screen.getByRole("button", { name: /^save$/i });
      expect(save).not.toBeDisabled();
      fireEvent.click(save);
      const saved = p.onSave.mock.calls[0][0] as PageRegister;
      rerender(<RegisterInspector {...p} register={saved} />);
      expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
      expect(screen.queryByText(/unsaved changes/i)).toBeNull();
    });

    it("treats a source-param edit as unsaved", () => {
      render(<RegisterInspector {...base()} />);
      fireEvent.click(screen.getByRole("tab", { name: /source/i }));
      fireEvent.change(screen.getByLabelText(/^min$/i), { target: { value: "5" } });
      expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
    });
  });

  describe("new register draft (S4)", () => {
    const existing = [reg, { ...reg, id: 2, address: 5, dataType: "u16", alias: "Other", valueSource: "hold", sourceParams: "{}" }];
    const draftProps = (extra: Record<string, unknown> = {}) => ({
      ...base(),
      register: blankRegister(existing),
      registers: existing,
      onCreate: vi.fn(() => true),
      ...extra,
    });

    it("titles the panel New register, hides Duplicate/Delete and offers Create + Cancel", () => {
      const p = draftProps();
      render(<RegisterInspector {...p} />);
      expect(screen.getByText("New register")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /duplicate/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
      expect(p.onClose).toHaveBeenCalled();
    });

    it("creates a default holding register", () => {
      const p = draftProps();
      render(<RegisterInspector {...p} />);
      fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
      expect(p.onCreate).toHaveBeenCalledWith(expect.objectContaining({ id: 0, unitId: 1, functionCode: 3, dataType: "u16", valueSource: "hold" }));
    });

    it("accepts a 0x address and shows the draft address in the current format", () => {
      const p = draftProps({ addrFmt: "hex" });
      render(<RegisterInspector {...p} />);
      const addr = screen.getByLabelText("Address") as HTMLInputElement;
      expect(addr.value).toMatch(/^0x[0-9A-F]{4}$/);
      fireEvent.change(addr, { target: { value: "0x0200" } });
      fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
      expect(p.onCreate).toHaveBeenCalledWith(expect.objectContaining({ address: 512 }));
    });

    it("blocks Create with an inline error when unit+type+address is taken", () => {
      const p = draftProps();
      render(<RegisterInspector {...p} />);
      fireEvent.change(screen.getByLabelText("Address"), { target: { value: "5" } });
      expect(screen.getByRole("alert").textContent).toMatch(/already used/i);
      expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();
    });

    it("treats a multi-word span as taken too", () => {
      const p = draftProps();
      render(<RegisterInspector {...p} />);
      fireEvent.click(screen.getByRole("tab", { name: /source/i }));
      fireEvent.change(screen.getByLabelText(/value source/i), { target: { value: "device" } });
      fireEvent.click(screen.getByRole("tab", { name: /general/i }));
      fireEvent.change(screen.getByLabelText("Data Type"), { target: { value: "f32" } });
      fireEvent.change(screen.getByLabelText("Address"), { target: { value: "4" } });
      expect(screen.getByRole("alert").textContent).toMatch(/already used/i);
    });

    it("rejects an invalid address", () => {
      render(<RegisterInspector {...draftProps()} />);
      fireEvent.change(screen.getByLabelText("Address"), { target: { value: "99999" } });
      expect(screen.getByRole("alert").textContent).toMatch(/65535/);
      expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();
    });

    it("restricts a coil to hold and serialises a generator draft", () => {
      const p = draftProps();
      render(<RegisterInspector {...p} />);
      fireEvent.change(screen.getByLabelText("Register type"), { target: { value: "1" } });
      fireEvent.click(screen.getByRole("tab", { name: /source/i }));
      expect(screen.getByRole("option", { name: /^generator$/i })).toBeDisabled();
      fireEvent.click(screen.getByRole("tab", { name: /general/i }));
      fireEvent.change(screen.getByLabelText("Register type"), { target: { value: "4" } });
      fireEvent.click(screen.getByRole("tab", { name: /source/i }));
      fireEvent.change(screen.getByLabelText(/value source/i), { target: { value: "generator" } });
      fireEvent.change(screen.getByLabelText(/generator kind/i), { target: { value: "sine" } });
      fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
      const arg = (p.onCreate as any).mock.calls[0][0];
      expect(arg.functionCode).toBe(4);
      expect(arg.valueSource).toBe("generator");
      expect(JSON.parse(arg.sourceParams)).toMatchObject({ kind: "sine", periodMs: 1000 });
    });

    it("serialises a route draft", () => {
      const p = draftProps();
      render(<RegisterInspector {...p} />);
      fireEvent.click(screen.getByRole("tab", { name: /source/i }));
      fireEvent.change(screen.getByLabelText(/value source/i), { target: { value: "route" } });
      fireEvent.change(screen.getByLabelText(/source slave unit/i), { target: { value: "7" } });
      fireEvent.change(screen.getByLabelText(/source function/i), { target: { value: "4" } });
      fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
      const sp = JSON.parse((p.onCreate as any).mock.calls[0][0].sourceParams);
      expect(sp).toMatchObject({ slaveUnitId: 7, functionCode: 4, connectionKind: "tcp" });
    });

    it("a draft switched to Device source carries no periodMs unless one is typed (I2)", () => {
      const p = draftProps();
      render(<RegisterInspector {...p} />);
      fireEvent.click(screen.getByRole("tab", { name: /source/i }));
      fireEvent.change(screen.getByLabelText(/value source/i), { target: { value: "device" } });
      expect((screen.getByLabelText(/period ms/i) as HTMLInputElement).value).toBe("");
      fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
      const sp = JSON.parse((p.onCreate as any).mock.calls[0][0].sourceParams);
      expect(sp).not.toHaveProperty("periodMs");
    });

    it("keeps a period the user typed when switching to Device (I2)", () => {
      const p = draftProps();
      render(<RegisterInspector {...p} />);
      fireEvent.click(screen.getByRole("tab", { name: /source/i }));
      fireEvent.change(screen.getByLabelText(/value source/i), { target: { value: "generator" } });
      fireEvent.change(screen.getByLabelText(/period ms/i), { target: { value: "2500" } });
      fireEvent.change(screen.getByLabelText(/value source/i), { target: { value: "device" } });
      fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
      expect(JSON.parse((p.onCreate as any).mock.calls[0][0].sourceParams).periodMs).toBe(2500);
    });

    it("sets the update interval on a draft and blocks an invalid one (I1)", () => {
      const p = draftProps();
      render(<RegisterInspector {...p} />);
      fireEvent.click(screen.getByRole("tab", { name: /source/i }));
      expect(screen.queryByLabelText("Interval ms")).toBeNull(); // hold: not applicable
      fireEvent.change(screen.getByLabelText(/value source/i), { target: { value: "generator" } });
      expect((screen.getByLabelText("Interval ms") as HTMLInputElement).value).toBe("1000");
      fireEvent.change(screen.getByLabelText("Interval ms"), { target: { value: "250" } });
      fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
      expect((p.onCreate as any).mock.calls[0][0].intervalMs).toBe(250);
      fireEvent.change(screen.getByLabelText("Interval ms"), { target: { value: "1.5" } });
      expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();
      fireEvent.change(screen.getByLabelText("Interval ms"), { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
      expect((p.onCreate as any).mock.calls[1][0].intervalMs).toBe(0);
    });

    it("rejects a unit ID outside 0-255 and blocks Create (M5)", () => {
      render(<RegisterInspector {...draftProps()} />);
      fireEvent.change(screen.getByLabelText("Unit ID"), { target: { value: "300" } });
      expect(screen.getByRole("alert").textContent).toMatch(/unit ID/i);
      expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();
      fireEvent.change(screen.getByLabelText("Unit ID"), { target: { value: "255" } });
      expect(screen.getByRole("button", { name: /^create$/i })).not.toBeDisabled();
    });

    it("blocks Create for a non-numeric address", () => {
      const p = draftProps();
      render(<RegisterInspector {...p} />);
      fireEvent.change(screen.getByLabelText("Address"), { target: { value: "abc" } });
      expect(screen.getByRole("alert").textContent).toMatch(/0 to 65535/);
      const create = screen.getByRole("button", { name: /^create$/i });
      expect(create).toBeDisabled();
      fireEvent.click(create);
      expect(p.onCreate).not.toHaveBeenCalled();
    });

    it("shows a save error inside the panel and keeps the entered values", () => {
      render(<RegisterInspector {...draftProps({ error: "Backend said no" })} />);
      expect(within(screen.getByRole("alert")).getByText("Backend said no")).toBeInTheDocument();
    });
  });
});

describe("RegisterInspector scaling", () => {
  const scaled: PageRegister = {
    ...reg, id: 20, dataType: "u16", functionCode: 4, valueSource: "hold", holdValue: 235,
    sourceParams: "{}", unit: "°C", scale: 0.1, scaleOffset: 0, decimals: null,
  };

  it("shows the Scaling block with a preview for holding/input and hides it for bit banks", () => {
    const { unmount } = render(<RegisterInspector {...base()} register={scaled} />);
    expect(screen.getByText("Scaling")).toBeInTheDocument();
    expect(screen.getByLabelText("Scale")).toBeInTheDocument();
    expect(screen.getByLabelText("Offset")).toBeInTheDocument();
    expect(screen.getByLabelText("Decimals")).toBeInTheDocument();
    expect(screen.getByText("raw 235 = 23.5 °C")).toBeInTheDocument();
    unmount();
    render(<RegisterInspector {...base()} register={{ ...scaled, id: 21, functionCode: 1, dataType: "bool" }} />);
    expect(screen.queryByText("Scaling")).toBeNull();
    expect(screen.queryByLabelText("Scale")).toBeNull();
  });

  it("rejects scale 0 inside the panel and blocks Save and Create", () => {
    const p = base();
    const { unmount } = render(<RegisterInspector {...p} register={scaled} />);
    fireEvent.change(screen.getByLabelText("Scale"), { target: { value: "0" } });
    expect(within(screen.getByRole("alert")).getByText(/scale can.t be zero/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Alias"), { target: { value: "x" } });
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    unmount();
    const onCreate = vi.fn();
    render(<RegisterInspector {...p} register={blankRegister([])} onCreate={onCreate} />);
    fireEvent.change(screen.getByLabelText("Scale"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();
  });

  it("enters the hold value in engineering units and saves it raw, showing raw small", () => {
    const p = base();
    render(<RegisterInspector {...p} register={scaled} />);
    fireEvent.click(screen.getByRole("tab", { name: /source/i }));
    const initial = screen.getByLabelText(/initial value/i) as HTMLInputElement;
    expect(initial.value).toBe("23.5");
    expect(screen.getByText("raw 235")).toBeInTheDocument();
    fireEvent.change(initial, { target: { value: "25.6" } });
    expect(screen.getByText("raw 256")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(p.onSave.mock.calls[0][0].holdValue).toBe(256);
  });

  it("labels generator and device Min/Max with the unit", () => {
    const gen = { ...scaled, id: 22, valueSource: "generator", dataType: "u16", sourceParams: JSON.stringify({ kind: "sine", min: 20, max: 30 }) };
    const { unmount } = render(<RegisterInspector {...base()} register={gen} />);
    fireEvent.click(screen.getByRole("tab", { name: /source/i }));
    expect(screen.getByLabelText("Min (°C)")).toBeInTheDocument();
    expect(screen.getByLabelText("Max (°C)")).toBeInTheDocument();
    unmount();
    render(<RegisterInspector {...base()} register={{ ...gen, id: 23, valueSource: "device", sourceParams: JSON.stringify({ preset: "temperature", min: 0, max: 5 }) }} />);
    fireEvent.click(screen.getByRole("tab", { name: /source/i }));
    expect(screen.getByLabelText("Min (°C)")).toBeInTheDocument();
  });

  it("saves scaling edits and leaves the fields null with defaults", () => {
    const p = base();
    render(<RegisterInspector {...p} register={{ ...scaled, id: 24, scale: null, scaleOffset: null, unit: null }} />);
    fireEvent.change(screen.getByLabelText("Alias"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(p.onSave.mock.calls[0][0]).toMatchObject({ scale: null, scaleOffset: null, decimals: null });
  });

  it("includes scale, offset and decimals in dirty tracking and the saved payload", () => {
    const p = base();
    render(<RegisterInspector {...p} register={{ ...scaled, id: 25, scale: null, scaleOffset: null, unit: null }} />);
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Scale"), { target: { value: "0.1" } });
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Offset"), { target: { value: "-40" } });
    fireEvent.change(screen.getByLabelText("Decimals"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(p.onSave.mock.calls[0][0]).toMatchObject({ scale: 0.1, scaleOffset: -40, decimals: 2 });
  });
});
