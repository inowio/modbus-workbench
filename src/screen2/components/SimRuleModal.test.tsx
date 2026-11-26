import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SimRuleModal from "./SimRuleModal";

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

  it("warns (but still saves) when an action targets a missing register", () => {
    const onSubmit = vi.fn();
    render(<SimRuleModal open initial={null} registers={regs} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/rule name/i), { target: { value: "r" } });
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    // default action: unit 1, holding(3) address 0 -> nothing there
    expect(screen.getByText("No register at holding 0 on unit 1 — this does nothing until you add one.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Action bank 0"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Action address 0"), { target: { value: "2" } });
    expect(screen.getByText("No register at coil 2 on unit 1 — this does nothing until you add one.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it("does not warn when the target exists, including the tail word of a multi-word register", () => {
    render(<SimRuleModal open initial={null} registers={regs} onClose={() => {}} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    fireEvent.change(screen.getByLabelText("Action address 0"), { target: { value: "11" } });
    expect(screen.queryByText(/no register at/i)).toBeNull();
  });

  it("warns about a missing register in a condition trigger", () => {
    render(<SimRuleModal open initial={null} registers={regs} onClose={() => {}} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/trigger type/i), { target: { value: "condition" } });
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
