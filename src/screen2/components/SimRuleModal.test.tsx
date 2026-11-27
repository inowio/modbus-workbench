import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SimRuleModal, { type SimRule } from "./SimRuleModal";

describe("SimRuleModal", () => {
  it("builds an interval rule with one action", () => {
    const onSubmit = vi.fn();
    render(<SimRuleModal open initial={null} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/rule name/i), { target: { value: "blink" } });
    fireEvent.change(screen.getByLabelText(/trigger type/i), { target: { value: "interval" } });
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const arg = onSubmit.mock.calls[0][0];
    expect(arg.name).toBe("blink");
    expect(JSON.parse(arg.trigger).type).toBe("interval");
    expect(JSON.parse(arg.actions).length).toBe(1);
  });
  it("does not render when closed", () => {
    const { container } = render(<SimRuleModal open={false} initial={null} onClose={() => {}} onSubmit={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  const regs = [
    { id: 1, unitId: 1, functionCode: 3, address: 10, alias: "Temp", dataType: "f32" },
    { id: 2, unitId: 1, functionCode: 1, address: 0, alias: "Valve", dataType: "bool" },
  ] as never[];

  it("disables Save with a reason when the name is empty or there are no actions", () => {
    render(<SimRuleModal open initial={null} onClose={() => {}} onSubmit={vi.fn()} />);
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save).toBeDisabled();
    expect(screen.getByText(/enter a rule name/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/rule name/i), { target: { value: "r" } });
    expect(save).toBeDisabled();
    expect(screen.getByText(/add at least one action/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    expect(save).toBeEnabled();
  });

  it("shows a hint when there are no actions yet", () => {
    render(<SimRuleModal open initial={null} onClose={() => {}} onSubmit={vi.fn()} />);
    expect(screen.getByText(/no actions yet/i)).toBeInTheDocument();
  });

  it("warns (but still saves, keeping the stored reference) when an action targets a missing register", () => {
    const onSubmit = vi.fn();
    const legacy = {
      id: 3, name: "r", enabled: true, sortOrder: 0,
      trigger: JSON.stringify({ type: "interval", ms: 1000 }),
      actions: JSON.stringify([{ type: "set", unit: 1, bank: 1, address: 2, value: 1 }]),
    };
    render(<SimRuleModal open initial={legacy} registers={regs} onClose={() => {}} onSubmit={onSubmit} />);
    expect(screen.getByText("No register at coil 2 on unit 1 — this does nothing until you add one.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const saved = JSON.parse(onSubmit.mock.calls[0][0].actions);
    expect(saved[0]).toMatchObject({ unit: 1, bank: 1, address: 2, value: 1 });
  });

  it("defaults a new action to the first register so nothing is missing", () => {
    render(<SimRuleModal open initial={null} registers={regs} onClose={() => {}} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    expect((screen.getByLabelText("Action target 0") as HTMLSelectElement).value).toBe("1:3:10");
    expect(screen.queryByText(/no register at/i)).toBeNull();
  });

  it("explains a legacy reference to the middle of a multi-word register", () => {
    const legacy = {
      id: 3, name: "r", enabled: true, sortOrder: 0,
      trigger: JSON.stringify({ type: "interval", ms: 1000 }),
      actions: JSON.stringify([{ type: "set", unit: 1, bank: 3, address: 11, value: 1 }]),
    };
    render(<SimRuleModal open initial={legacy} registers={regs} onClose={() => {}} onSubmit={vi.fn()} />);
    expect(screen.getByText(/holding 11 is inside Temp \(holding 10\)/)).toBeInTheDocument();
  });

  it("warns about a missing register in a legacy condition trigger", () => {
    const legacy = {
      id: 3, name: "r", enabled: true, sortOrder: 0,
      trigger: JSON.stringify({ type: "condition", unit: 1, bank: 3, address: 0, op: "==", value: 1 }),
      actions: "[]",
    };
    render(<SimRuleModal open initial={legacy} registers={regs} onClose={() => {}} onSubmit={vi.fn()} />);
    expect(screen.getByText(/no register at holding 0 on unit 1/i)).toBeInTheDocument();
  });

  it("shows friendly labels while keeping stored values", () => {
    render(<SimRuleModal open initial={null} onClose={() => {}} onSubmit={vi.fn()} />);
    const trig = screen.getByLabelText(/trigger type/i) as HTMLSelectElement;
    expect(screen.getByRole("option", { name: "Every N ms" })).toHaveValue("interval");
    expect(screen.getByRole("option", { name: "When a condition is met" })).toHaveValue("condition");
    expect(screen.getByRole("option", { name: "When a client writes" })).toHaveValue("onWrite");
    expect(trig.value).toBe("interval");
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    for (const [label, value] of [["Set", "set"], ["Increment", "inc"], ["Decrement", "dec"], ["Toggle", "toggle"], ["Copy from", "copy"], ["Randomize", "randomize"]]) {
      expect(screen.getByRole("option", { name: label })).toHaveValue(value);
    }
  });

  it("shows the error passed in by the page", () => {
    render(<SimRuleModal open initial={null} error="boom" onClose={() => {}} onSubmit={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
});

describe("SimRuleModal — engineering units", () => {
  const regs = [
    { id: 1, unitId: 1, functionCode: 4, address: 1, alias: "Temperature", dataType: "u16", byteOrder: "ABCD", scale: 0.1, scaleOffset: 0, decimals: 1, unit: "°C" },
    { id: 2, unitId: 1, functionCode: 1, address: 2, alias: "Fan relay", dataType: "bool", byteOrder: "ABCD" },
    { id: 3, unitId: 1, functionCode: 3, address: 10, alias: "Setpoint", dataType: "u16", byteOrder: "ABCD", scale: 0.1, unit: "°C" },
    { id: 4, unitId: 1, functionCode: 3, address: 20, alias: "", dataType: "f32", byteOrder: "CDAB" },
  ] as never[];

  const base = (patch: Partial<SimRule>): SimRule => ({ id: 7, name: "Hot", enabled: true, sortOrder: 0, trigger: "", actions: "[]", ...patch });

  const openNew = (onSubmit = vi.fn(), addrFmt: "dec" | "hex" = "dec") => {
    render(<SimRuleModal open initial={null} registers={regs} addrFmt={addrFmt} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/rule name/i), { target: { value: "Hot" } });
    fireEvent.change(screen.getByLabelText(/trigger type/i), { target: { value: "condition" } });
    return onSubmit;
  };

  it("lists registers alias-first with the address in the Dec/Hex setting", () => {
    openNew(vi.fn(), "hex");
    const sel = screen.getByLabelText("Condition register 0");
    expect(within(sel).getByRole("option", { name: "Temperature · input 0x0001" })).toHaveValue("1:4:1");
    expect(within(sel).getByRole("option", { name: "holding 0x0014" })).toHaveValue("1:3:20");
  });

  it("saves register + >= + 35.0 + deadband 1 in the new trigger shape", () => {
    const onSubmit = openNew();
    fireEvent.change(screen.getByLabelText("Condition register 0"), { target: { value: "1:4:1" } });
    fireEvent.change(screen.getByLabelText("Condition op 0"), { target: { value: ">=" } });
    fireEvent.change(screen.getByLabelText("Condition value 0"), { target: { value: "35.0" } });
    fireEvent.change(screen.getByLabelText("Condition deadband 0"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(JSON.parse(onSubmit.mock.calls[0][0].trigger)).toEqual({
      type: "condition",
      join: "all",
      conditions: [{ unit: 1, bank: 4, address: 1, op: ">=", value: 35, deadband: 1 }],
    });
  });

  it("omits a zero deadband", () => {
    const onSubmit = openNew();
    fireEvent.change(screen.getByLabelText("Condition register 0"), { target: { value: "1:4:1" } });
    fireEvent.change(screen.getByLabelText("Condition op 0"), { target: { value: ">" } });
    fireEvent.change(screen.getByLabelText("Condition value 0"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const cond = JSON.parse(onSubmit.mock.calls[0][0].trigger).conditions[0];
    expect(cond).toEqual({ unit: 1, bank: 4, address: 1, op: ">", value: 30 });
  });

  it("opens a legacy single-condition rule with the right register and value", () => {
    const onSubmit = vi.fn();
    const legacy = base({
      trigger: JSON.stringify({ type: "condition", unit: 1, bank: 4, address: 1, op: ">", value: 30.5 }),
      actions: JSON.stringify([{ type: "set", unit: 1, bank: 1, address: 2, value: 1 }]),
    });
    render(<SimRuleModal open initial={legacy} registers={regs} onClose={() => {}} onSubmit={onSubmit} />);
    expect((screen.getByLabelText("Condition register 0") as HTMLSelectElement).value).toBe("1:4:1");
    expect((screen.getByLabelText("Condition op 0") as HTMLSelectElement).value).toBe(">");
    expect((screen.getByLabelText("Condition value 0") as HTMLInputElement).value).toBe("30.5");
    expect((screen.getByLabelText("Action target 0") as HTMLSelectElement).value).toBe("1:1:2");
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(JSON.parse(onSubmit.mock.calls[0][0].trigger)).toEqual({
      type: "condition", join: "all", conditions: [{ unit: 1, bank: 4, address: 1, op: ">", value: 30.5 }],
    });
  });

  it("opens a new-shape rule with its join, conditions and deadband", () => {
    const rule = base({
      trigger: JSON.stringify({ type: "condition", join: "any", conditions: [
        { unit: 1, bank: 4, address: 1, op: "<=", value: 5, deadband: 0.5 },
        { unit: 1, bank: 1, address: 2, op: "==", value: 1 },
      ] }),
    });
    render(<SimRuleModal open initial={rule} registers={regs} onClose={() => {}} onSubmit={vi.fn()} />);
    expect((screen.getByLabelText("Condition join") as HTMLSelectElement).value).toBe("any");
    expect((screen.getByLabelText("Condition deadband 0") as HTMLInputElement).value).toBe("0.5");
    expect((screen.getByLabelText("Condition register 1") as HTMLSelectElement).value).toBe("1:1:2");
    expect((screen.getByLabelText("Condition value 1") as HTMLSelectElement).value).toBe("1");
  });

  it("Add condition shows the All of / Any of select and saves join any", () => {
    const onSubmit = openNew();
    expect(screen.queryByLabelText("Condition join")).toBeNull();
    fireEvent.change(screen.getByLabelText("Condition register 0"), { target: { value: "1:4:1" } });
    fireEvent.change(screen.getByLabelText("Condition op 0"), { target: { value: ">=" } });
    fireEvent.change(screen.getByLabelText("Condition value 0"), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add condition" }));
    const join = screen.getByLabelText("Condition join") as HTMLSelectElement;
    expect(within(join).getByRole("option", { name: "All of" })).toHaveValue("all");
    expect(within(join).getByRole("option", { name: "Any of" })).toHaveValue("any");
    fireEvent.change(join, { target: { value: "any" } });
    fireEvent.change(screen.getByLabelText("Condition register 1"), { target: { value: "1:1:2" } });
    fireEvent.change(screen.getByLabelText("Condition value 1"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const t = JSON.parse(onSubmit.mock.calls[0][0].trigger);
    expect(t.join).toBe("any");
    expect(t.conditions).toEqual([
      { unit: 1, bank: 4, address: 1, op: ">=", value: 35 },
      { unit: 1, bank: 1, address: 2, op: "==", value: 1 },
    ]);
  });

  it("removing a condition drops back to a single condition", () => {
    openNew();
    fireEvent.click(screen.getByRole("button", { name: "+ Add condition" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove condition 1" }));
    expect(screen.queryByLabelText("Condition join")).toBeNull();
    expect(screen.queryByLabelText("Condition register 1")).toBeNull();
  });

  it("changed hides Add condition, and is not offered with two conditions", () => {
    openNew();
    fireEvent.change(screen.getByLabelText("Condition op 0"), { target: { value: "changed" } });
    expect(screen.queryByRole("button", { name: "+ Add condition" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Condition op 0"), { target: { value: ">" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add condition" }));
    for (const i of [0, 1]) {
      const op = screen.getByLabelText(`Condition op ${i}`);
      expect(within(op).queryByRole("option", { name: "changed" })).toBeNull();
    }
  });

  it("shows Deadband only for >, >=, <, <=", () => {
    openNew();
    fireEvent.change(screen.getByLabelText("Condition register 0"), { target: { value: "1:4:1" } });
    for (const op of [">", ">=", "<", "<="]) {
      fireEvent.change(screen.getByLabelText("Condition op 0"), { target: { value: op } });
      expect(screen.getByLabelText("Condition deadband 0")).toBeInTheDocument();
    }
    for (const op of ["==", "!=", "changed"]) {
      fireEvent.change(screen.getByLabelText("Condition op 0"), { target: { value: op } });
      expect(screen.queryByLabelText("Condition deadband 0")).toBeNull();
    }
  });

  it("hides Deadband for a condition on a bit (coil/discrete) register and doesn't save one", () => {
    const onSubmit = openNew();
    fireEvent.change(screen.getByLabelText("Condition register 0"), { target: { value: "1:4:1" } });
    fireEvent.change(screen.getByLabelText("Condition op 0"), { target: { value: ">" } });
    fireEvent.change(screen.getByLabelText("Condition deadband 0"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Condition register 0"), { target: { value: "1:1:2" } });
    for (const op of [">", ">=", "<", "<="]) {
      fireEvent.change(screen.getByLabelText("Condition op 0"), { target: { value: op } });
      expect(screen.queryByLabelText("Condition deadband 0")).toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(JSON.parse(onSubmit.mock.calls[0][0].trigger).conditions[0]).not.toHaveProperty("deadband");
  });

  it("does not block Save on a hidden negative deadband of a bit condition", () => {
    openNew();
    fireEvent.change(screen.getByLabelText("Condition register 0"), { target: { value: "1:4:1" } });
    fireEvent.change(screen.getByLabelText("Condition op 0"), { target: { value: ">=" } });
    fireEvent.change(screen.getByLabelText("Condition deadband 0"), { target: { value: "-1" } });
    fireEvent.change(screen.getByLabelText("Condition register 0"), { target: { value: "1:1:2" } });
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled();
  });

  it("does not save a deadband of a hidden operator", () => {
    const onSubmit = openNew();
    fireEvent.change(screen.getByLabelText("Condition register 0"), { target: { value: "1:4:1" } });
    fireEvent.change(screen.getByLabelText("Condition op 0"), { target: { value: ">" } });
    fireEvent.change(screen.getByLabelText("Condition deadband 0"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Condition op 0"), { target: { value: "==" } });
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(JSON.parse(onSubmit.mock.calls[0][0].trigger).conditions[0].deadband).toBeUndefined();
  });

  it("blocks Save on a negative deadband", () => {
    openNew();
    fireEvent.change(screen.getByLabelText("Condition register 0"), { target: { value: "1:4:1" } });
    fireEvent.change(screen.getByLabelText("Condition op 0"), { target: { value: ">=" } });
    fireEvent.change(screen.getByLabelText("Condition deadband 0"), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText(/deadband can't be negative/i)).toBeInTheDocument();
  });

  it("blocks Save on a value that isn't a number", () => {
    openNew();
    fireEvent.change(screen.getByLabelText("Condition register 0"), { target: { value: "1:4:1" } });
    fireEvent.change(screen.getByLabelText("Condition value 0"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText(/enter a number/i)).toBeInTheDocument();
  });

  it("shows the register's unit beside value and deadband inputs", () => {
    openNew();
    fireEvent.change(screen.getByLabelText("Condition register 0"), { target: { value: "1:4:1" } });
    fireEvent.change(screen.getByLabelText("Condition op 0"), { target: { value: ">=" } });
    expect(screen.getByTestId("cond-value-unit-0")).toHaveTextContent("°C");
    expect(screen.getByTestId("cond-deadband-unit-0")).toHaveTextContent("°C");
  });

  it("uses an On/Off select for bit registers", () => {
    const onSubmit = openNew();
    fireEvent.change(screen.getByLabelText("Condition register 0"), { target: { value: "1:1:2" } });
    const v = screen.getByLabelText("Condition value 0") as HTMLSelectElement;
    expect(v.tagName).toBe("SELECT");
    expect(within(v).getByRole("option", { name: "On" })).toHaveValue("1");
    expect(within(v).getByRole("option", { name: "Off" })).toHaveValue("0");
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    fireEvent.change(screen.getByLabelText("Action target 0"), { target: { value: "1:1:2" } });
    const av = screen.getByLabelText("Action value 0") as HTMLSelectElement;
    expect(av.tagName).toBe("SELECT");
    fireEvent.change(av, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(JSON.parse(onSubmit.mock.calls[0][0].actions)[0]).toMatchObject({ type: "set", unit: 1, bank: 1, address: 2, value: 1 });
  });

  it("hints when a Set value isn't exactly representable (scale 0.1)", () => {
    const onSubmit = openNew();
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    fireEvent.change(screen.getByLabelText("Action target 0"), { target: { value: "1:3:10" } });
    fireEvent.change(screen.getByLabelText("Action value 0"), { target: { value: "25.57" } });
    expect(screen.getByText("Will be stored as 25.6 °C")).toBeInTheDocument();
    expect(screen.getByTestId("action-value-unit-0")).toHaveTextContent("°C");
    fireEvent.change(screen.getByLabelText("Action value 0"), { target: { value: "25.5" } });
    expect(screen.queryByText(/will be stored as/i)).toBeNull();
    fireEvent.change(screen.getByLabelText("Action value 0"), { target: { value: "25.57" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(JSON.parse(onSubmit.mock.calls[0][0].actions)[0]).toMatchObject({ type: "set", address: 10, value: 25.57 });
  });

  it("hints what an Inc/Dec amount really moves on a scale-0.1 target", () => {
    const onSubmit = openNew();
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    fireEvent.change(screen.getByLabelText("Action target 0"), { target: { value: "1:3:10" } });
    fireEvent.change(screen.getByLabelText("Action type 0"), { target: { value: "inc" } });
    fireEvent.change(screen.getByLabelText("Action by 0"), { target: { value: "0.04" } });
    expect(screen.getByText("Smaller than half a step (0.1 °C) — does nothing")).toBeInTheDocument();
    expect(screen.getByTestId("action-by-unit-0")).toHaveTextContent("°C");
    fireEvent.change(screen.getByLabelText("Action by 0"), { target: { value: "0.05" } });
    expect(screen.getByText("Moves by 0.1 °C each time")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Action by 0"), { target: { value: "0.15" } });
    expect(screen.getByText("Moves by 0.2 °C each time")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(JSON.parse(onSubmit.mock.calls[0][0].actions)[0]).toMatchObject({ type: "inc", address: 10, by: 0.15 });
    fireEvent.change(screen.getByLabelText("Action by 0"), { target: { value: "0.5" } });
    expect(screen.queryByText(/does nothing|moves by/i)).toBeNull();
  });

  it("no representability hint for an f32 target", () => {
    openNew();
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    fireEvent.change(screen.getByLabelText("Action target 0"), { target: { value: "1:3:20" } });
    fireEvent.change(screen.getByLabelText("Action value 0"), { target: { value: "25.57" } });
    expect(screen.queryByText(/will be stored as/i)).toBeNull();
  });

  it("selecting a register target records its type as the stored fallback and hides the type fields", () => {
    const onSubmit = openNew();
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    fireEvent.change(screen.getByLabelText("Action target 0"), { target: { value: "1:3:20" } });
    expect(screen.queryByLabelText("Action data type 0")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(JSON.parse(onSubmit.mock.calls[0][0].actions)[0]).toMatchObject({ address: 20, dataType: "f32", byteOrder: "CDAB" });
  });

  it("Copy picks its source from a register dropdown", () => {
    const onSubmit = openNew();
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    fireEvent.change(screen.getByLabelText("Action type 0"), { target: { value: "copy" } });
    fireEvent.change(screen.getByLabelText("Action source 0"), { target: { value: "1:4:1" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(JSON.parse(onSubmit.mock.calls[0][0].actions)[0]).toMatchObject({ type: "copy", srcUnit: 1, srcBank: 4, srcAddr: 1, scale: 1, offset: 0 });
  });

  it("keeps the input and shows the error when a save fails", () => {
    const { rerender } = render(<SimRuleModal open initial={null} registers={regs} onClose={() => {}} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/rule name/i), { target: { value: "Keep me" } });
    rerender(<SimRuleModal open initial={null} registers={regs} error="save failed" onClose={() => {}} onSubmit={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("save failed");
    expect(screen.getByLabelText(/rule name/i)).toHaveValue("Keep me");
  });
});
