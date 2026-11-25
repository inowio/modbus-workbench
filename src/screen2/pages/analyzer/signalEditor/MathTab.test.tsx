import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MathTab from "./MathTab";
import type { MathResult, SignalMath } from "../../../utils/analyzerMath";
import type { SignalEvaluation } from "../../../utils/analyzerSignalEval";
import type { AnalyzerSignal } from "../../../api/analyzer";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

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

function evaluation(over: Partial<SignalEvaluation>): SignalEvaluation {
  return { state: "OK", formatted: "", shown: ok(0), register: null, variables: {}, sample: null, valueType: "number", ...over };
}

function signal(id: string, over: Partial<AnalyzerSignal> = {}): AnalyzerSignal {
  return {
    id, kind: "register", slaveId: 1, connectionKind: "tcp", functionKind: "holding", registerRowId: 1, address: 0,
    functionCode: 3, alias: id, dataType: "u16", order: null, displayFormat: null, inputSignalIds: [], decoderJson: "{}",
    state: "OK", ...over,
  };
}

function Harness(props: { kind?: "register" | "calculated"; initial?: SignalMath; signals?: AnalyzerSignal[]; evaluations?: Record<string, SignalEvaluation>; selfSignalId?: string | null; polling?: boolean }) {
  const [math, setMath] = useState(props.initial ?? EXAMPLE);
  return (
    <MathTab
      kind={props.kind ?? "register"}
      math={math}
      onChange={setMath}
      signals={props.signals ?? []}
      evaluations={props.evaluations ?? {}}
      selfSignalId={props.selfSignalId ?? null}
      issues={[]}
      polling={props.polling ?? true}
    />
  );
}

const text = (label: string) => {
  const name = label.replace(/^Result /, "");
  return document.querySelector(`[data-result="${name}"]`)?.textContent ?? "";
};

beforeEach(() => invoke.mockClear());

describe("MathTab", () => {
  it("try it recomputes as the user types", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Try it register value"), { target: { value: "328" } });
    expect(text("Result y")).toContain("32.8");
    expect(text("Result z")).toContain("Medium");
    expect(text("Result z")).not.toContain("Low");
  });

  it("typing unchecks Use live values", () => {
    render(<Harness selfSignalId="s1" evaluations={{ s1: evaluation({ register: ok(100) }) }} />);
    const box = screen.getByLabelText("Use live values") as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Try it register value"), { target: { value: "5" } });
    expect(box.checked).toBe(false);
    expect(text("Result y")).toContain("0.5");
  });

  it("use live values fills from evaluations", () => {
    render(<Harness selfSignalId="s1" evaluations={{ s1: evaluation({ register: ok(328) }) }} />);
    expect((screen.getByLabelText("Try it register value") as HTMLInputElement).value).toBe("328");
    expect(text("Result y")).toContain("32.8");
    expect(text("Result z")).toContain("Medium");
  });

  it("defaults Use live values to off when there is no live data", () => {
    render(<Harness />);
    expect((screen.getByLabelText("Use live values") as HTMLInputElement).checked).toBe(false);
  });

  it("defaults Use live values to off while the analyzer is stopped, but it can be ticked", () => {
    render(<Harness polling={false} selfSignalId="s1" evaluations={{ s1: evaluation({ register: ok(328) }) }} />);
    const box = screen.getByLabelText("Use live values") as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(false);
    expect((screen.getByLabelText("Try it register value") as HTMLInputElement).value).toBe("");
    fireEvent.click(box);
    expect((screen.getByLabelText("Try it register value") as HTMLInputElement).value).toBe("328");
  });

  it("calculated inputs pick register signals only and list a source's variables", () => {
    const srcMath = { version: 1, inputs: [], variables: [{ name: "temp", kind: "calc", start: { ref: "register" }, steps: [] }] };
    const signals = [
      signal("r1", { alias: "Boiler", decoderJson: JSON.stringify({ math: srcMath }) }),
      signal("c1", { kind: "calculated", alias: "Derived" }),
    ];
    render(
      <Harness
        kind="calculated"
        initial={{ version: 1, inputs: [{ name: "in1", signalId: "r1", value: "shown" }], variables: [] }}
        signals={signals}
      />,
    );
    const sigOptions = Array.from((screen.getByLabelText("Input 1 signal") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(sigOptions).toEqual(["Boiler (r1)"]);
    const valOptions = Array.from((screen.getByLabelText("Input 1 value") as HTMLSelectElement).options).map((o) => o.value);
    expect(valOptions).toEqual(["shown", "register", "temp"]);
  });

  it("an input naming a missing source variable shows it as missing", () => {
    const srcMath = { version: 1, inputs: [], variables: [{ name: "temp", kind: "calc", start: { ref: "register" }, steps: [] }] };
    render(
      <Harness
        kind="calculated"
        initial={{ version: 1, inputs: [{ name: "in1", signalId: "r1", value: "temp_old" }], variables: [] }}
        signals={[signal("r1", { decoderJson: JSON.stringify({ math: srcMath }) })]}
      />,
    );
    const select = screen.getByLabelText("Input 1 value") as HTMLSelectElement;
    expect(select.value).toBe("temp_old");
    expect(select.options[select.selectedIndex].textContent).toBe("temp_old · missing");
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["shown", "register", "temp", "temp_old"]);
  });

  it("the input signal picker shows alias (id), or the id without an alias", () => {
    render(
      <Harness
        kind="calculated"
        initial={{ version: 1, inputs: [{ name: "in1", signalId: "r1", value: "shown" }], variables: [] }}
        signals={[signal("r1", { alias: "Boiler" }), signal("r2", { alias: null }), signal("r3", { alias: "  " })]}
      />,
    );
    const labels = Array.from((screen.getByLabelText("Input 1 signal") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(labels).toEqual(["Boiler (r1)", "r2", "r3"]);
  });

  it("adds, renames and removes inputs, with a limit of 20", () => {
    render(<Harness kind="calculated" initial={{ version: 1, inputs: [], variables: [] }} signals={[signal("r1")]} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add input" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add input" }));
    expect((screen.getByLabelText("Input 2 name") as HTMLInputElement).value).toBe("in2");
    const chip = screen.getByLabelText("Input 1 name");
    fireEvent.change(chip, { target: { value: "boiler" } });
    fireEvent.blur(chip);
    expect((screen.getByLabelText("Input 1 name") as HTMLInputElement).value).toBe("boiler");
    fireEvent.click(screen.getByRole("button", { name: "Remove input boiler" }));
    expect(screen.queryByLabelText("Input 2 name")).toBeNull();
    for (let i = 0; i < 25; i++) {
      const b = screen.getByRole("button", { name: "+ Add input" }) as HTMLButtonElement;
      if (!b.disabled) fireEvent.click(b);
    }
    expect(screen.getAllByLabelText(/^Input \d+ name$/)).toHaveLength(20);
    expect((screen.getByRole("button", { name: "+ Add input" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("unticking Use live values seeds the exact live value, never a rounded one", () => {
    const evals = { r1: evaluation({ shown: ok(1234567890123), register: ok(1234567890123) }) };
    render(
      <Harness
        kind="calculated"
        initial={{
          version: 1,
          inputs: [{ name: "in1", signalId: "r1", value: "shown" }],
          variables: [{ name: "d", kind: "calc", start: { ref: "in1" }, steps: [{ op: "add", operand: { num: 1 } }] }],
        }}
        signals={[signal("r1")]}
        evaluations={evals}
      />,
    );
    expect((screen.getByLabelText("Try it in1 value") as HTMLInputElement).value).toBe("1234567890123");
    fireEvent.click(screen.getByLabelText("Use live values"));
    expect((screen.getByLabelText("Use live values") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Try it in1 value") as HTMLInputElement).value).toBe("1234567890123");
    expect(text("Result d")).toBe("d1234567890124");
  });

  it("calculated try it takes live values from the picked source", () => {
    const evals = { r1: evaluation({ shown: ok(80), register: ok(800) }) };
    render(
      <Harness
        kind="calculated"
        initial={{
          version: 1,
          inputs: [{ name: "in1", signalId: "r1", value: "shown" }],
          variables: [{ name: "d", kind: "calc", start: { ref: "in1" }, steps: [{ op: "mul", operand: { num: 2 } }] }],
        }}
        signals={[signal("r1")]}
        evaluations={evals}
      />,
    );
    expect((screen.getByLabelText("Try it in1 value") as HTMLInputElement).value).toBe("80");
    expect(text("Result d")).toContain("160");
  });

  it("typing into one live box keeps the other live values", () => {
    const evals = { a: evaluation({ shown: ok(2) }), b: evaluation({ shown: ok(3) }) };
    render(
      <Harness
        kind="calculated"
        initial={{
          version: 1,
          inputs: [{ name: "V", signalId: "a", value: "shown" }, { name: "A", signalId: "b", value: "shown" }],
          variables: [{ name: "p", kind: "calc", start: { ref: "V" }, steps: [{ op: "mul", operand: { ref: "A" } }] }],
        }}
        signals={[signal("a"), signal("b")]}
        evaluations={evals}
      />,
    );
    expect(text("Result p")).toContain("6");
    fireEvent.change(screen.getByLabelText("Try it V value"), { target: { value: "10" } });
    expect((screen.getByLabelText("Try it A value") as HTMLInputElement).value).toBe("3");
    expect(text("Result p")).toContain("30");
  });

  it("switching live -> manual -> live -> manual reseeds from fresh live values", () => {
    const mathV: SignalMath = { version: 1, inputs: [{ name: "V", signalId: "a", value: "shown" }], variables: [] };
    const sigs = [signal("a")];
    const { rerender } = render(<Harness kind="calculated" initial={mathV} signals={sigs} evaluations={{ a: evaluation({ shown: ok(2) }) }} />);
    fireEvent.change(screen.getByLabelText("Try it V value"), { target: { value: "3" } });
    fireEvent.click(screen.getByLabelText("Use live values"));
    rerender(<Harness kind="calculated" initial={mathV} signals={sigs} evaluations={{ a: evaluation({ shown: ok(7) }) }} />);
    fireEvent.click(screen.getByLabelText("Use live values"));
    expect((screen.getByLabelText("Try it V value") as HTMLInputElement).value).toBe("7");
  });

  it("unchecking live keeps the live values as editable text", () => {
    render(<Harness selfSignalId="s1" evaluations={{ s1: evaluation({ register: ok(328) }) }} />);
    fireEvent.click(screen.getByLabelText("Use live values"));
    expect((screen.getByLabelText("Try it register value") as HTMLInputElement).value).toBe("328");
  });

  it("renaming an input rewrites variables that use it", () => {
    render(
      <Harness
        kind="calculated"
        initial={{
          version: 1,
          inputs: [{ name: "V", signalId: "a", value: "shown" }],
          variables: [{ name: "p", kind: "calc", start: { ref: "V" }, steps: [] }],
        }}
        signals={[signal("a")]}
      />,
    );
    const chip = screen.getByLabelText("Input 1 name");
    fireEvent.change(chip, { target: { value: "W" } });
    fireEvent.blur(chip);
    expect((screen.getByLabelText("p start") as HTMLSelectElement).value).toBe("W");
  });

  it("explains an empty live box and names the status dot", () => {
    render(
      <Harness
        kind="calculated"
        initial={{ version: 1, inputs: [{ name: "V", signalId: "a", value: "shown" }, { name: "A", signalId: "b", value: "shown" }], variables: [] }}
        signals={[signal("a"), signal("b")]}
        evaluations={{ a: evaluation({ shown: ok(1) }) }}
      />,
    );
    expect((screen.getByLabelText("Try it A value") as HTMLInputElement).placeholder).toBe("no value");
    expect(screen.getByLabelText("V status: OK")).toBeTruthy();
  });

  it("try it never calls invoke", () => {
    render(<Harness selfSignalId="s1" evaluations={{ s1: evaluation({ register: ok(328) }) }} />);
    fireEvent.change(screen.getByLabelText("Try it register value"), { target: { value: "12" } });
    fireEvent.click(screen.getByLabelText("Use live values"));
    expect(invoke).not.toHaveBeenCalled();
  });
});
