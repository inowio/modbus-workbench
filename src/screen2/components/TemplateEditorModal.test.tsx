import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TemplateEditorModal from "./TemplateEditorModal";

const custom = {
  templateKey: "custom_x",
  name: "My Device",
  category: "Custom",
  description: "",
  icon: "📟",
  registers: [{ offset: 0, bank: 3, dataType: "u16", byteOrder: "ABCD", valueSource: "hold", sourceParams: "{}", alias: "A" }],
};

describe("TemplateEditorModal", () => {
  it("does not render when closed", () => {
    const { container } = render(<TemplateEditorModal open={false} initial={null} takenKeys={[]} onClose={() => {}} onSave={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("blocks Save until a key and name are present, and on a key clash", () => {
    render(<TemplateEditorModal open initial={null} takenKeys={["taken_key"]} onClose={vi.fn()} onSave={vi.fn()} />);
    const save = screen.getByRole("button", { name: /save device/i });
    expect(save).toBeDisabled(); // blank key + name
    fireEvent.change(screen.getByLabelText(/template name/i), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText(/template key/i), { target: { value: "taken_key" } });
    expect(save).toBeDisabled(); // key clash
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/template key/i), { target: { value: "fresh_key" } });
    expect(save).toBeEnabled();
  });

  it("locks the key when editing an existing template and saves it", () => {
    const onSave = vi.fn();
    render(<TemplateEditorModal open initial={custom} takenKeys={["custom_x"]} onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByLabelText(/template key/i)).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /save device/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ templateKey: "custom_x", name: "My Device" }));
  });

  it("picks the category from a list, and a typed category snaps to an existing one", () => {
    const onSave = vi.fn();
    render(<TemplateEditorModal open initial={null} takenKeys={[]} categories={["HVAC", "Workspace"]} onClose={vi.fn()} onSave={onSave} />);
    const category = screen.getByRole("combobox", { name: "Category" });
    expect(category).toHaveValue("Custom");
    expect(Array.from(category.querySelectorAll("option")).map((o) => o.textContent)).toEqual([
      "Sensors", "Power", "I/O", "Drives", "Learning", "Custom", "HVAC", "New category…",
    ]);
    expect(screen.queryByLabelText("New category name")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/template name/i), { target: { value: "Power Meter" } });
    fireEvent.change(category, { target: { value: "Power" } });
    fireEvent.click(screen.getByRole("button", { name: /save device/i }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ category: "Power" }));

    fireEvent.change(category, { target: { value: " new " } });
    fireEvent.change(screen.getByLabelText("New category name"), { target: { value: "  hvac " } });
    fireEvent.click(screen.getByRole("button", { name: /save device/i }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ category: "HVAC" }));

    fireEvent.change(screen.getByLabelText("New category name"), { target: { value: "Lab rig" } });
    fireEvent.click(screen.getByRole("button", { name: /save device/i }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ category: "Lab rig" }));
  });

  it("keeps an edited device's own category in the list", () => {
    render(<TemplateEditorModal open initial={{ ...custom, category: "Bench" }} takenKeys={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue("Bench");
  });

  it("adds and removes register rows", () => {
    render(<TemplateEditorModal open initial={custom} takenKeys={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByLabelText("Alias 0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add register/i }));
    expect(screen.getByLabelText("Alias 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^remove register 2:/i }));
    expect(screen.queryByLabelText("Alias 1")).not.toBeInTheDocument();
  });

  it("picks an icon from the chooser modal instead of typing one", () => {
    const onSave = vi.fn();
    render(<TemplateEditorModal open initial={custom} takenKeys={[]} onClose={vi.fn()} onSave={onSave} />);
    // No free-text icon box, and the grid is behind a modal (not inline).
    expect(screen.queryByRole("radio", { name: "Icon ⚡" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Choose device icon"));
    fireEvent.click(screen.getByRole("radio", { name: "Icon ⚡" }));
    // Picking closes the modal; the choice sticks on save.
    expect(screen.queryByRole("radio", { name: "Icon ⚡" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save device/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ icon: "⚡" }));
  });

  it("filters icons in the chooser by keyword", () => {
    render(<TemplateEditorModal open initial={custom} takenKeys={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Choose device icon"));
    fireEvent.change(screen.getByLabelText(/search icons/i), { target: { value: "andon" } });
    // 🚦 is tagged "andon"; ⚡ is not.
    expect(screen.getByRole("radio", { name: "Icon 🚦" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Icon ⚡" })).not.toBeInTheDocument();
  });

  it("hold registers carry no parameter fields", () => {
    render(<TemplateEditorModal open initial={custom} takenKeys={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    // hold source => no form/JSON toggle, no raw JSON textarea.
    expect(screen.queryByLabelText("Params JSON 0")).not.toBeInTheDocument();
    expect(screen.getByText(/no parameters/i)).toBeInTheDocument();
  });

  it("edits generator params through the form and saves clean JSON", () => {
    const onSave = vi.fn();
    render(<TemplateEditorModal open initial={custom} takenKeys={[]} onClose={vi.fn()} onSave={onSave} />);
    // Switch the first register to a generator, then set its waveform + max.
    fireEvent.change(screen.getByLabelText("Source 0"), { target: { value: "generator" } });
    fireEvent.change(screen.getByLabelText("Generator kind 0"), { target: { value: "ramp" } });
    fireEvent.change(screen.getByLabelText("Max 0"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: /save device/i }));
    const saved = onSave.mock.calls[0][0];
    expect(JSON.parse(saved.registers[0].sourceParams)).toEqual({ kind: "ramp", min: 0, max: 250, periodMs: 1000 });
  });

  it("switches a register's params to a raw JSON editor", () => {
    render(<TemplateEditorModal open initial={custom} takenKeys={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Source 0"), { target: { value: "generator" } });
    // Form view is default; toggle to JSON exposes the raw editor.
    expect(screen.queryByLabelText("Params JSON 0")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Params JSON view 0"));
    const editor = screen.getByLabelText("Params JSON 0");
    expect(editor).toBeInTheDocument();
    fireEvent.change(editor, { target: { value: "{ not json" } });
    expect(screen.getByText(/not valid json/i)).toBeInTheDocument();
  });

  const reg = (o: number, extra: Record<string, unknown> = {}) => ({ offset: o, bank: 3, dataType: "u16", byteOrder: "ABCD", valueSource: "hold", sourceParams: "{}", alias: "r" + o, ...extra });
  const withRegs = (registers: unknown[]) => ({ ...custom, registers }) as typeof custom;

  it("adds a register at the next free offset (span-aware) and focuses its alias", () => {
    render(<TemplateEditorModal open initial={withRegs([reg(4, { dataType: "f32", valueSource: "generator", sourceParams: '{"kind":"sine"}' })])} takenKeys={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add register/i }));
    expect(screen.getByLabelText("Offset 1")).toHaveValue("6");
    expect(screen.getByLabelText("Alias 1")).toHaveFocus();
  });

  it("duplicates after the row at the next free offset with a (copy) alias", () => {
    render(<TemplateEditorModal open initial={withRegs([reg(0), reg(1)])} takenKeys={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^duplicate register 1:/i }));
    expect(screen.getByLabelText("Alias 1")).toHaveValue("r0 (copy)");
    expect(screen.getByLabelText("Offset 1")).toHaveValue("2");
  });

  it("highlights overlaps and blocks Save with a reason", () => {
    render(<TemplateEditorModal open initial={withRegs([reg(0, { dataType: "u32" }), reg(1)])} takenKeys={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getAllByText(/overlaps offset/i).length).toBe(2);
    expect(screen.getByRole("button", { name: /save device/i })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/overlapping/i);
  });

  it("hides irrelevant type and byte order fields", () => {
    render(<TemplateEditorModal open initial={withRegs([reg(0, { bank: 1, dataType: "bool" })])} takenKeys={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.queryByLabelText("Type 0")).toBeNull(); // plain text, not a labelled control
    expect(screen.getByText("bit")).toBeInTheDocument();
    expect(screen.getByText("Byte order").parentElement).toHaveTextContent("—");
  });

  it("saves an empty alias as Reg <offset> and keeps optional fields", () => {
    const onSave = vi.fn();
    render(<TemplateEditorModal open initial={withRegs([reg(3, { alias: "", unit: "V", intervalMs: 500 })])} takenKeys={[]} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /save device/i }));
    expect(onSave.mock.calls[0][0].registers[0]).toMatchObject({ alias: "Reg 3", unit: "V", intervalMs: 500 });
  });

  it("derives the key from the name until it is edited by hand", () => {
    const onSave = vi.fn();
    render(<TemplateEditorModal open initial={null} takenKeys={["custom_meter"]} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/template name/i), { target: { value: "Meter" } });
    expect(screen.getByLabelText(/template key/i)).toHaveValue("custom_meter_2");
    fireEvent.change(screen.getByLabelText(/template name/i), { target: { value: "Power Meter" } });
    expect(screen.getByLabelText(/template key/i)).toHaveValue("custom_power_meter");
    fireEvent.change(screen.getByLabelText(/template key/i), { target: { value: "mine" } });
    fireEvent.change(screen.getByLabelText(/template name/i), { target: { value: "Other" } });
    expect(screen.getByLabelText(/template key/i)).toHaveValue("mine");
  });

  it("keeps a device preset's period absent unless typed", () => {
    const onSave = vi.fn();
    render(<TemplateEditorModal open initial={custom} takenKeys={[]} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Source 0"), { target: { value: "device" } });
    fireEvent.click(screen.getByRole("button", { name: /save device/i }));
    expect(JSON.parse(onSave.mock.calls[0][0].registers[0].sourceParams)).not.toHaveProperty("periodMs");
  });

  it("lets the generator period be cleared and retyped, saving the default when left empty (M7)", () => {
    const onSave = vi.fn();
    render(<TemplateEditorModal open initial={custom} takenKeys={[]} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Source 0"), { target: { value: "generator" } });
    const period = screen.getByLabelText("Period 0") as HTMLInputElement;
    expect(period.value).toBe("1000");
    fireEvent.change(period, { target: { value: "" } });
    expect(period.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /save device/i }));
    expect(JSON.parse(onSave.mock.calls[0][0].registers[0].sourceParams).periodMs).toBe(1000);
    fireEvent.change(period, { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: /save device/i }));
    expect(JSON.parse(onSave.mock.calls[1][0].registers[0].sourceParams).periodMs).toBe(250);
  });

  it("names the list buttons 1-based with alias, offset and bank (M8)", () => {
    render(<TemplateEditorModal open initial={withRegs([reg(0, { alias: "Temp" })])} takenKeys={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Register 1: Temp, offset 0, holding" });
    expect(btn).toHaveAttribute("aria-current", "true");
  });

  it("puts the container on the dialog so the body's @4xl overflow rule can apply (M2)", () => {
    render(<TemplateEditorModal open initial={custom} takenKeys={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toMatch(/(^|\s)@container(\s|$)/);
    const body = dialog.querySelector(".overflow-y-auto") as HTMLElement;
    expect(body.className).toMatch(/@4xl:overflow-hidden/);
    expect(body.className).not.toMatch(/(^|\s)@container(\s|$)/);
  });

  it("round-trips displayFormat and holdValue through save", () => {
    const onSave = vi.fn();
    render(<TemplateEditorModal open initial={withRegs([reg(0, { displayFormat: "hex", holdValue: 42, unit: "V" })])} takenKeys={[]} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Alias 0"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /save device/i }));
    expect(onSave.mock.calls[0][0].registers[0]).toMatchObject({ alias: "Renamed", displayFormat: "hex", holdValue: 42, unit: "V" });
  });

  it("switches the editor pane when another register is selected", () => {
    render(<TemplateEditorModal open initial={withRegs([reg(0), reg(1)])} takenKeys={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Register 2: r1, offset 1, holding$/ }));
    expect(screen.getByLabelText("Alias 1")).toHaveValue("r1");
  });

  describe("scaling", () => {
    const scaled = { scale: 0.1, scaleOffset: -40, decimals: 1, unit: "°C" };
    const save = () => fireEvent.click(screen.getByRole("button", { name: /save device/i }));

    it("shows the Scaling block for a numeric register and hides it for a bit bank", () => {
      render(<TemplateEditorModal open initial={withRegs([reg(0, scaled), reg(1, { bank: 1, dataType: "bool" })])} takenKeys={[]} onClose={vi.fn()} onSave={vi.fn()} />);
      expect(screen.getByLabelText("Scale 0")).toHaveValue("0.1");
      expect(screen.getByLabelText("Scaling offset 0")).toHaveValue("-40");
      expect(screen.getByLabelText("Decimals 0")).toHaveValue("1");
      expect(screen.getByText("raw 0 = -40.0 °C")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /^Register 2:/ }));
      expect(screen.queryByLabelText("Scale 1")).not.toBeInTheDocument();
    });

    it("round-trips scaling unchanged through edit and save", () => {
      const onSave = vi.fn();
      render(<TemplateEditorModal open initial={withRegs([reg(0, scaled)])} takenKeys={[]} onClose={vi.fn()} onSave={onSave} />);
      fireEvent.change(screen.getByLabelText("Alias 0"), { target: { value: "Temp" } });
      save();
      expect(onSave.mock.calls[0][0].registers[0]).toMatchObject(scaled);
    });

    it("edits scale, offset and decimals and clears them back to absent", () => {
      const onSave = vi.fn();
      render(<TemplateEditorModal open initial={withRegs([reg(0, scaled)])} takenKeys={[]} onClose={vi.fn()} onSave={onSave} />);
      fireEvent.change(screen.getByLabelText("Scale 0"), { target: { value: "0.5" } });
      save();
      expect(onSave.mock.calls[0][0].registers[0]).toMatchObject({ scale: 0.5, scaleOffset: -40, decimals: 1 });
      for (const f of ["Scale 0", "Scaling offset 0", "Decimals 0"]) fireEvent.change(screen.getByLabelText(f), { target: { value: "" } });
      save();
      const out = onSave.mock.calls[1][0].registers[0];
      expect(out).not.toHaveProperty("scale");
      expect(out).not.toHaveProperty("scaleOffset");
      expect(out).not.toHaveProperty("decimals");
    });

    it("saves an unscaled template without adding scaling fields or nulls", () => {
      const onSave = vi.fn();
      render(<TemplateEditorModal open initial={withRegs([reg(0)])} takenKeys={[]} onClose={vi.fn()} onSave={onSave} />);
      fireEvent.change(screen.getByLabelText("Alias 0"), { target: { value: "Temp" } });
      save();
      const out = onSave.mock.calls[0][0].registers[0];
      for (const k of ["scale", "scaleOffset", "decimals", "unit"]) expect(out).not.toHaveProperty(k);
    });

    it("blocks Save with a reason while Scale is 0", () => {
      const onSave = vi.fn();
      render(<TemplateEditorModal open initial={withRegs([reg(0, scaled)])} takenKeys={[]} onClose={vi.fn()} onSave={onSave} />);
      fireEvent.change(screen.getByLabelText("Scale 0"), { target: { value: "0" } });
      expect(screen.getByRole("button", { name: /save device/i })).toBeDisabled();
      expect(screen.getAllByText("Scale can't be zero.").length).toBeGreaterThan(0);
      fireEvent.change(screen.getByLabelText("Scale 0"), { target: { value: "2" } });
      expect(screen.getByRole("button", { name: /save device/i })).toBeEnabled();
    });

    it("keeps Scale 0 out of the saved register even after selecting another register", () => {
      const onSave = vi.fn();
      render(<TemplateEditorModal open initial={withRegs([reg(0, scaled), reg(1)])} takenKeys={[]} onClose={vi.fn()} onSave={onSave} />);
      fireEvent.change(screen.getByLabelText("Scale 0"), { target: { value: "0" } });
      fireEvent.click(screen.getByRole("button", { name: /^Register 2:/ }));
      save();
      expect(onSave.mock.calls[0][0].registers[0].scale).toBe(0.1);
    });

    it("blocks Save for a loaded register that already has scale 0", () => {
      render(<TemplateEditorModal open initial={withRegs([reg(0), reg(1, { scale: 0 })])} takenKeys={[]} onClose={vi.fn()} onSave={vi.fn()} />);
      expect(screen.getByRole("button", { name: /save device/i })).toBeDisabled();
      expect(screen.getByText("Register 2: Scale can't be zero.")).toBeInTheDocument();
    });

    it("drops scaling when the register becomes a bit bank", () => {
      const onSave = vi.fn();
      render(<TemplateEditorModal open initial={withRegs([reg(0, scaled)])} takenKeys={[]} onClose={vi.fn()} onSave={onSave} />);
      fireEvent.change(screen.getByLabelText("Bank 0"), { target: { value: "1" } });
      save();
      const out = onSave.mock.calls[0][0].registers[0];
      for (const k of ["scale", "scaleOffset", "decimals", "unit"]) expect(out).not.toHaveProperty(k);
    });
  });
});
