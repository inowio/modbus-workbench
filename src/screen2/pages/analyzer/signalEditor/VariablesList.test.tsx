import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import VariablesList from "./VariablesList";
import { emptySignalMath, validateSignalMath, type SignalMath } from "../../../utils/analyzerMath";

function Harness({ initial, spy, hasRegister = true, inputTypes }: { initial: SignalMath; spy?: (m: SignalMath) => void; hasRegister?: boolean; inputTypes?: Record<string, "number" | "text"> }) {
  const [math, setMath] = useState(initial);
  return (
    <VariablesList
      math={math}
      hasRegister={hasRegister}
      inputTypes={inputTypes}
      results={{}}
      issues={validateSignalMath(math, { hasRegister, inputTypes })}
      onChange={(next) => {
        spy?.(next);
        setMath(next);
      }}
    />
  );
}

const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const rename = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.blur(screen.getByLabelText(label));
};
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const last = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls[spy.mock.calls.length - 1][0] as SignalMath;

const EXAMPLE_1: SignalMath = {
  version: 1,
  inputs: [],
  variables: [
    { name: "x", kind: "calc", start: { ref: "register" }, steps: [] },
    { name: "y", kind: "calc", start: { ref: "x" }, steps: [{ op: "div", operand: { num: 10 } }] },
  ],
};

describe("VariablesList", () => {
  it("builds example 1 through the UI", () => {
    const spy = vi.fn();
    render(<Harness initial={emptySignalMath()} spy={spy} />);
    click("+ Add variable");
    click("Calculation");
    rename("Variable 1 name", "x");
    pick("x start", "register");
    click("+ Add variable");
    click("Calculation");
    rename("Variable 2 name", "y");
    pick("y start", "x");
    click("Add operation to y");
    pick("y step 1 operation", "div");
    pick("y step 1 value", "#num");
    type("y step 1 value number", "10");
    expect(last(spy)).toEqual(EXAMPLE_1);
  });

  it("builds example 2 rules through the UI", () => {
    const spy = vi.fn();
    render(<Harness initial={EXAMPLE_1} spy={spy} />);
    click("+ Add variable");
    click("Rules");
    rename("Variable 3 name", "z");
    const thresholds: Array<[string, number, string, number | null, string]> = [
      ["lt", 20, "", null, "Low"],
      ["ge", 20, "lt", 40, "Medium"],
      ["ge", 40, "lt", 60, "High"],
      ["ge", 60, "lt", 80, "Critical"],
    ];
    thresholds.forEach(([cmp, n, cmp2, n2, text], i) => {
      const r = i + 1;
      click("Add rule to z");
      pick(`z rule ${r} condition 1 left`, "y");
      pick(`z rule ${r} condition 1 comparison`, cmp);
      pick(`z rule ${r} condition 1 right`, "#num");
      type(`z rule ${r} condition 1 right number`, String(n));
      if (n2 !== null) {
        click(`Add condition to z rule ${r}`);
        pick(`z rule ${r} condition 2 left`, "y");
        pick(`z rule ${r} condition 2 comparison`, cmp2);
        pick(`z rule ${r} condition 2 right`, "#num");
        type(`z rule ${r} condition 2 right number`, String(n2));
      }
      pick(`z rule ${r} then`, "#text");
      type(`z rule ${r} then text`, text);
    });
    pick("z otherwise", "#text");
    type("z otherwise text", "Unknown");
    const z = last(spy).variables[2];
    expect(z).toEqual({
      name: "z",
      kind: "rules",
      rules: [
        { join: "and", conds: [{ left: { ref: "y" }, cmp: "lt", right: { num: 20 } }], then: { text: "Low" } },
        {
          join: "and",
          conds: [
            { left: { ref: "y" }, cmp: "ge", right: { num: 20 } },
            { left: { ref: "y" }, cmp: "lt", right: { num: 40 } },
          ],
          then: { text: "Medium" },
        },
        {
          join: "and",
          conds: [
            { left: { ref: "y" }, cmp: "ge", right: { num: 40 } },
            { left: { ref: "y" }, cmp: "lt", right: { num: 60 } },
          ],
          then: { text: "High" },
        },
        {
          join: "and",
          conds: [
            { left: { ref: "y" }, cmp: "ge", right: { num: 60 } },
            { left: { ref: "y" }, cmp: "lt", right: { num: 80 } },
          ],
          then: { text: "Critical" },
        },
      ],
      otherwise: { text: "Unknown" },
    });
  });

  it("renaming a variable updates references below it", () => {
    const spy = vi.fn();
    render(<Harness initial={EXAMPLE_1} spy={spy} />);
    rename("Variable 1 name", "raw");
    const m = last(spy);
    expect(m.variables[0].name).toBe("raw");
    expect(m.variables[1]).toMatchObject({ kind: "calc", start: { ref: "raw" } });
  });

  it("move up is disabled when it would break a reference", () => {
    const spy = vi.fn();
    render(<Harness initial={EXAMPLE_1} spy={spy} />);
    const up = screen.getByRole("button", { name: "Move y up" }) as HTMLButtonElement;
    expect(up.disabled).toBe(true);
    expect(up.title).toMatch(/uses x/i);
    const down = screen.getByRole("button", { name: "Move x down" }) as HTMLButtonElement;
    expect(down.disabled).toBe(true);
    expect(down.title).toMatch(/y uses x/i);
    fireEvent.click(up);
    expect(spy).not.toHaveBeenCalled();
  });

  it("moves an unreferenced variable", () => {
    const spy = vi.fn();
    const math: SignalMath = {
      version: 1,
      inputs: [],
      variables: [
        { name: "a", kind: "calc", start: { num: 1 }, steps: [] },
        { name: "b", kind: "calc", start: { num: 2 }, steps: [] },
      ],
    };
    render(<Harness initial={math} spy={spy} />);
    click("Move b up");
    expect(last(spy).variables.map((v) => v.name)).toEqual(["b", "a"]);
  });

  it("deleting a referenced variable shows the broken reference", () => {
    render(<Harness initial={EXAMPLE_1} />);
    click("Delete x");
    const msg = screen.getByText("unknown name x");
    expect(msg.className).toMatch(/red/);
  });

  it("duplicates a variable with a fresh name", () => {
    const spy = vi.fn();
    render(<Harness initial={EXAMPLE_1} spy={spy} />);
    click("Duplicate x");
    expect(last(spy).variables.map((v) => v.name)).toEqual(["x", "x_2", "y"]);
  });

  it("text left operand limits comparisons to = and ≠", () => {
    const math: SignalMath = {
      version: 1,
      inputs: [],
      variables: [
        {
          name: "t",
          kind: "rules",
          rules: [{ join: "and", conds: [{ left: { text: "a" }, cmp: "eq", right: { text: "b" } }], then: { num: 1 } }],
          otherwise: { num: 0 },
        },
      ],
    };
    render(<Harness initial={math} />);
    const select = screen.getByLabelText("t rule 1 condition 1 comparison") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["eq", "ne"]);
  });

  it("limits: Add variable is disabled at 30 variables", () => {
    const variables = Array.from({ length: 30 }, (_, i) => ({
      name: `v${i}`,
      kind: "calc" as const,
      start: { num: i },
      steps: [],
    }));
    render(<Harness initial={{ version: 1, inputs: [], variables }} />);
    expect((screen.getByRole("button", { name: "+ Add variable" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("rename commits on blur: typing through an existing name keeps references", () => {
    const spy = vi.fn();
    const math: SignalMath = {
      version: 1,
      inputs: [],
      variables: [
        { name: "v1", kind: "calc", start: { num: 1 }, steps: [] },
        { name: "y", kind: "calc", start: { num: 2 }, steps: [] },
        { name: "w", kind: "calc", start: { ref: "y" }, steps: [{ op: "add", operand: { ref: "y" } }] },
      ],
    };
    render(<Harness initial={math} spy={spy} />);
    const input = screen.getByLabelText("Variable 2 name");
    fireEvent.change(input, { target: { value: "v1" } });
    fireEvent.change(input, { target: { value: "v1x" } });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(last(spy).variables[2]).toEqual({
      name: "w",
      kind: "calc",
      start: { ref: "v1x" },
      steps: [{ op: "add", operand: { ref: "v1x" } }],
    });
  });

  it("renaming to an existing name reverts and shows the message", () => {
    const spy = vi.fn();
    render(<Harness initial={EXAMPLE_1} spy={spy} />);
    rename("Variable 2 name", "x");
    expect(spy).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Variable 2 name") as HTMLInputElement).value).toBe("y");
    expect(screen.getByText('name "x" is already used')).toBeTruthy();
  });

  it("Escape cancels a rename draft", () => {
    const spy = vi.fn();
    render(<Harness initial={EXAMPLE_1} spy={spy} />);
    const input = screen.getByLabelText("Variable 2 name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "q" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("y");
  });

  it("a variable named __num__ is selectable as a reference", () => {
    const spy = vi.fn();
    const math: SignalMath = {
      version: 1,
      inputs: [],
      variables: [
        { name: "__num__", kind: "calc", start: { num: 1 }, steps: [] },
        { name: "b", kind: "calc", start: { num: 2 }, steps: [] },
      ],
    };
    render(<Harness initial={math} spy={spy} />);
    pick("b start", "__num__");
    expect(last(spy).variables[1]).toMatchObject({ start: { ref: "__num__" } });
  });

  it("text-typed inputs are not offered to calculations but are to rules", () => {
    const math: SignalMath = {
      version: 1,
      inputs: [{ name: "V", signalId: "s", value: "shown" }],
      variables: [
        { name: "c", kind: "calc", start: { num: 1 }, steps: [] },
        {
          name: "r",
          kind: "rules",
          rules: [{ join: "and", conds: [{ left: { ref: "V" }, cmp: "eq", right: { text: "a" } }], then: { num: 1 } }],
          otherwise: { num: 0 },
        },
      ],
    };
    render(<Harness initial={math} inputTypes={{ V: "text" }} />);
    const opts = (label: string) => Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.value);
    expect(opts("c start")).not.toContain("V");
    expect(opts("r rule 1 condition 1 left")).toContain("V");
  });

  it("a new Calculation starts on Register value for register signals", () => {
    const spy = vi.fn();
    render(<Harness initial={emptySignalMath()} spy={spy} />);
    click("+ Add variable");
    click("Calculation");
    expect(last(spy).variables[0]).toEqual({ name: "v1", kind: "calc", start: { ref: "register" }, steps: [] });
  });

  it("a new Calculation starts on the first number input for calculated signals, else Number 0", () => {
    const spy = vi.fn();
    const math: SignalMath = {
      version: 1,
      inputs: [
        { name: "T", signalId: "s1", value: "shown" },
        { name: "A", signalId: "s2", value: "shown" },
      ],
      variables: [],
    };
    const { unmount } = render(<Harness initial={math} spy={spy} hasRegister={false} inputTypes={{ T: "text", A: "number" }} />);
    click("+ Add variable");
    click("Calculation");
    expect(last(spy).variables[0]).toMatchObject({ kind: "calc", start: { ref: "A" } });
    unmount();

    render(<Harness initial={{ ...math, inputs: [] }} spy={spy} hasRegister={false} />);
    click("+ Add variable");
    click("Calculation");
    expect(last(spy).variables[0]).toMatchObject({ kind: "calc", start: { num: 0 } });
  });

  it("a new rule condition starts on a number option", () => {
    const spy = vi.fn();
    const math: SignalMath = {
      version: 1,
      inputs: [{ name: "V", signalId: "s", value: "shown" }],
      variables: [{ name: "r", kind: "rules", rules: [], otherwise: { num: 0 } }],
    };
    render(<Harness initial={math} spy={spy} inputTypes={{ V: "text" }} />);
    click("Add rule to r");
    expect(last(spy).variables[0]).toMatchObject({ rules: [{ conds: [{ left: { ref: "register" } }] }] });
  });
});
