import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RulesTab, { actionsSummary, ruleSummary } from "./RulesTab";

const rule = {
  id: 1,
  name: "High Temp",
  enabled: true,
  sortOrder: 0,
  trigger: JSON.stringify({ type: "condition", bank: 3, address: 5, op: ">", value: 60 }),
  actions: JSON.stringify([{ type: "set", bank: 3, address: 10, value: 1 }]),
};

describe("actionsSummary", () => {
  it("summarizes a set action", () => {
    expect(actionsSummary(rule as any)).toMatch(/set/i);
  });

  it("summarizes inc/dec/toggle/copy/randomize actions joined by · ", () => {
    const r = {
      ...rule,
      actions: JSON.stringify([
        { type: "inc", bank: 3, address: 1, by: 2 },
        { type: "dec", bank: 3, address: 2, by: 3 },
        { type: "toggle", bank: 1, address: 4 },
        { type: "copy", bank: 3, address: 5, srcBank: 4, srcAddr: 6 },
        { type: "randomize", bank: 3, address: 7, min: 0, max: 100 },
      ]),
    };
    const summary = actionsSummary(r as any);
    expect(summary).toBe(
      "Inc holding[1] by 2 · Dec holding[2] by 3 · Toggle coil[4] · Copy input[6]→holding[5] · Randomize holding[7] 0..100"
    );
  });

  it("falls back to the raw type for an unknown action", () => {
    const r = { ...rule, actions: JSON.stringify([{ type: "mystery", bank: 3, address: 1 }]) };
    expect(actionsSummary(r as any)).toBe("mystery");
  });

  it("returns — for invalid JSON", () => {
    expect(actionsSummary({ ...rule, actions: "not json" } as any)).toBe("—");
  });

  it("returns — for empty actions", () => {
    expect(actionsSummary({ ...rule, actions: "[]" } as any)).toBe("—");
    expect(actionsSummary({ ...rule, actions: "" } as any)).toBe("—");
  });

  it("uses reg fallback for an unknown bank number", () => {
    const r = { ...rule, actions: JSON.stringify([{ type: "toggle", bank: 9, address: 1 }]) };
    expect(actionsSummary(r as any)).toBe("Toggle reg[1]");
  });
});

describe("ruleSummary", () => {
  it("summarizes a condition trigger", () => {
    expect(ruleSummary(rule as any)).toBe("holding[5] > 60");
  });

  it("summarizes an interval trigger", () => {
    const r = { ...rule, trigger: JSON.stringify({ type: "interval", ms: 500 }) };
    expect(ruleSummary(r as any)).toBe("interval 500ms");
  });

  it("returns invalid trigger for bad JSON", () => {
    expect(ruleSummary({ ...rule, trigger: "nope" } as any)).toBe("invalid trigger");
  });
});

describe("RulesTab", () => {
  it("wraps the rules table in a horizontally scrolling container (S9)", () => {
    render(<RulesTab rules={[rule as any]} devices={[]} onAdd={vi.fn()} onEdit={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />);
    const table = screen.getByRole("table");
    expect(table.parentElement!.className).toMatch(/overflow-x-auto/);
  });

  it("renders rule name and toggles", () => {
    const onToggle = vi.fn();
    render(
      <RulesTab
        rules={[rule as any]}
        devices={[]}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onToggle={onToggle}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText("High Temp")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /high temp/i }));
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), false);
  });

  it("resolves scope to a device name when the trigger unit maps to a device", () => {
    const r = { ...rule, trigger: JSON.stringify({ type: "condition", unit: 3, bank: 3, address: 5, op: ">", value: 60 }) };
    const device = { id: 9, templateKey: "th", name: "Boiler", unitId: 3, baseAddress: 0, sortOrder: 0 };
    render(<RulesTab rules={[r as any]} devices={[device as any]} onAdd={vi.fn()} onEdit={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("Boiler")).toBeInTheDocument();
  });

  it("shows — for scope when the trigger unit doesn't map to any device", () => {
    render(<RulesTab rules={[rule as any]} devices={[]} onAdd={vi.fn()} onEdit={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("Add Rule triggers onAdd", () => {
    const onAdd = vi.fn();
    render(<RulesTab rules={[]} devices={[]} onAdd={onAdd} onEdit={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    expect(onAdd).toHaveBeenCalled();
  });

  it("Edit and Delete buttons fire callbacks", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<RulesTab rules={[rule as any]} devices={[]} onAdd={vi.fn()} onEdit={onEdit} onToggle={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it("states that rule edits apply immediately and shows an empty state when there are no rules", () => {
    render(<RulesTab rules={[]} devices={[]} onAdd={vi.fn()} onEdit={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByText(/next start/i)).toBeNull();
    expect(screen.getByText(/apply immediately/i)).toBeInTheDocument();
    expect(screen.getByText(/no rules/i)).toBeInTheDocument();
  });

  describe("F6 readable summaries", () => {
    const regs = [
      { id: 1, unitId: 1, functionCode: 4, address: 1, alias: "Temperature", dataType: "u16" },
      { id: 2, unitId: 1, functionCode: 1, address: 2, alias: "", dataType: "bool" },
    ] as any[];
    const r2 = {
      id: 5, name: "Hot", enabled: true, sortOrder: 0,
      trigger: JSON.stringify({ type: "condition", unit: 1, bank: 4, address: 1, op: ">=", value: 350 }),
      actions: JSON.stringify([{ type: "set", unit: 1, bank: 1, address: 2, value: 1 }, { type: "set", unit: 1, bank: 1, address: 9, value: 1 }]),
    };
    const renderIt = (fmt: "dec" | "hex" = "dec") =>
      render(<RulesTab rules={[r2 as any]} devices={[]} registers={regs} addrFmt={fmt} onAdd={vi.fn()} onEdit={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />);

    it("shows the register alias and friendly operator", () => {
      renderIt();
      // Unique alias: the name alone; the location is in the tooltip.
      expect(screen.getByText("Temperature ≥ 350")).toHaveAttribute("title", "Temperature · input 1");
    });

    it("renders actions with the address and marks missing targets amber with a tooltip", () => {
      renderIt();
      expect(screen.getByText("Set coil 2 = On")).toBeInTheDocument();
      const missing = screen.getByText("Set coil 9 = On");
      expect(missing).toHaveAttribute("title", "No such register");
      expect(missing.className).toMatch(/amber/);
    });

    it("honours the Hex address setting", () => {
      renderIt("hex");
      expect(screen.getByText("Set coil 0x0002 = On")).toBeInTheDocument();
      expect(screen.getByText("Temperature ≥ 350")).toHaveAttribute("title", "Temperature · input 0x0001");
    });

    it("flags a reference to the middle of a multi-word register", () => {
      const wide = [{ id: 7, unitId: 1, functionCode: 3, address: 20, alias: "Flow", dataType: "f32" }] as any[];
      const r = { ...r2, trigger: JSON.stringify({ type: "condition", unit: 1, bank: 3, address: 21, op: ">", value: 1 }), actions: "[]" };
      render(<RulesTab rules={[r as any]} devices={[]} registers={wide} onAdd={vi.fn()} onEdit={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />);
      expect(screen.getByText("holding 21 > 1")).toHaveAttribute("title", "Points inside a register, not at its start");
    });

    it("names the Enabled column and labels the checkbox", () => {
      renderIt();
      expect(screen.getByRole("columnheader", { name: "Enabled" })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "Enable Hot" })).toBeInTheDocument();
    });

    it("falls back to the rule id for the checkbox label when the name is empty", () => {
      render(<RulesTab rules={[{ ...r2, name: "" } as any]} devices={[]} onAdd={vi.fn()} onEdit={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />);
      expect(screen.getByRole("checkbox", { name: "Enable rule #5" })).toBeInTheDocument();
    });

    it("shows a legacy onWrite rule with no/negative address as 'any address', not missing (M5)", () => {
      const noAddr = { ...r2, id: 6, trigger: JSON.stringify({ type: "onWrite", unit: 1, bank: 3 }) };
      const negAddr = { ...r2, id: 7, trigger: JSON.stringify({ type: "onWrite", unit: 1, bank: 1, address: -1 }) };
      render(<RulesTab rules={[noAddr as any, negAddr as any]} devices={[]} registers={regs} onAdd={vi.fn()} onEdit={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />);
      const holding = screen.getByText("On write to holding (any address)");
      expect(holding).not.toHaveAttribute("title");
      expect(holding.className).not.toMatch(/amber/);
      expect(screen.getByText("On write to coil (any address)")).toBeInTheDocument();
      expect(ruleSummary(noAddr as any)).toBe("onWrite holding[any]");
    });
  });
});

describe("RulesTab — engineering units", () => {
  const regs = [
    { id: 1, unitId: 1, functionCode: 4, address: 1, alias: "Temperature", dataType: "u16", scale: 0.1, scaleOffset: 0, decimals: null, unit: "°C" },
    { id: 2, unitId: 1, functionCode: 1, address: 2, alias: "Fan relay", dataType: "bool" },
    { id: 3, unitId: 1, functionCode: 1, address: 3, alias: "Run", dataType: "bool" },
    { id: 4, unitId: 1, functionCode: 1, address: 4, alias: "Fault", dataType: "bool" },
    { id: 5, unitId: 1, functionCode: 3, address: 10, alias: "Setpoint", dataType: "u16", scale: 0.1, unit: "°C" },
  ] as any[];
  const mk = (trigger: unknown, actions: unknown[] = []) => ({
    id: 1, name: "R", enabled: true, sortOrder: 0, trigger: JSON.stringify(trigger), actions: JSON.stringify(actions),
  });
  const show = (r: ReturnType<typeof mk>, registers = regs) =>
    render(<RulesTab rules={[r as any]} devices={[]} registers={registers} onAdd={vi.fn()} onEdit={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />);

  it("formats a condition with unit, register decimals and deadband", () => {
    show(mk({ type: "condition", join: "all", conditions: [{ unit: 1, bank: 4, address: 1, op: ">=", value: 35, deadband: 1 }] }));
    expect(screen.getByText("Temperature ≥ 35.0 °C (±1.0)")).toBeInTheDocument();
  });

  it("formats a legacy single condition the same way", () => {
    show(mk({ type: "condition", unit: 1, bank: 4, address: 1, op: "<", value: 5 }));
    expect(screen.getByText("Temperature < 5.0 °C")).toBeInTheDocument();
  });

  it("summarizes multiple conditions with All of / Any of and On/Off for bits", () => {
    show(mk({ type: "condition", join: "all", conditions: [
      { unit: 1, bank: 1, address: 3, op: "==", value: 1 },
      { unit: 1, bank: 1, address: 4, op: "==", value: 0 },
    ] }));
    expect(screen.getByText("All of: Run = On, Fault = Off")).toBeInTheDocument();
  });

  it("uses Any of for join any", () => {
    show(mk({ type: "condition", join: "any", conditions: [
      { unit: 1, bank: 1, address: 3, op: "==", value: 1 },
      { unit: 1, bank: 4, address: 1, op: ">", value: 40 },
    ] }));
    expect(screen.getByText("Any of: Run = On, Temperature > 40.0 °C")).toBeInTheDocument();
  });

  it("flags a multi-condition rule amber when any of its registers is missing", () => {
    show(mk({ type: "condition", join: "all", conditions: [
      { unit: 1, bank: 1, address: 3, op: "==", value: 1 },
      { unit: 1, bank: 1, address: 9, op: "==", value: 0 },
    ] }));
    const el = screen.getByText("All of: Run = On, coil 9 = Off");
    expect(el).toHaveAttribute("title", "No such register");
  });

  it("formats actions in the target's engineering units", () => {
    show(mk({ type: "interval", ms: 1000 }, [
      { type: "set", unit: 1, bank: 1, address: 2, value: 1 },
      { type: "inc", unit: 1, bank: 3, address: 10, by: 0.5 },
      { type: "dec", unit: 1, bank: 3, address: 10, by: 1 },
      { type: "set", unit: 1, bank: 3, address: 10, value: 25.5 },
    ]));
    expect(screen.getByText("Set Fan relay = On")).toBeInTheDocument();
    expect(screen.getByText("Increment Setpoint by 0.5 °C")).toBeInTheDocument();
    expect(screen.getByText("Decrement Setpoint by 1.0 °C")).toBeInTheDocument();
    expect(screen.getByText("Set Setpoint = 25.5 °C")).toBeInTheDocument();
  });

  it("keeps a value's own extra decimals rather than hiding them", () => {
    show(mk({ type: "interval", ms: 1000 }, [{ type: "set", unit: 1, bank: 3, address: 10, value: 25.57 }]));
    expect(screen.getByText("Set Setpoint = 25.57 °C")).toBeInTheDocument();
  });

  it("disambiguates duplicate aliases with the address", () => {
    const dup = [...regs, { id: 9, unitId: 2, functionCode: 4, address: 1, alias: "Temperature", dataType: "u16" }];
    show(mk({ type: "condition", unit: 2, bank: 4, address: 1, op: ">", value: 30 }), dup);
    expect(screen.getByText("Temperature (input 1) > 30")).toBeInTheDocument();
  });

  it("ruleSummary handles the new multi-condition shape", () => {
    const r = mk({ type: "condition", join: "any", conditions: [
      { unit: 1, bank: 3, address: 5, op: ">", value: 60 },
      { unit: 1, bank: 1, address: 0, op: "==", value: 1 },
    ] });
    expect(ruleSummary(r as any)).toBe("holding[5] > 60 or coil[0] == 1");
  });
});
