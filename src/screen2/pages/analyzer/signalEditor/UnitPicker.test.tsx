import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import UnitPicker from "./UnitPicker";
import { UNIT_GROUPS } from "./units";

function Harness({ initial, spy }: { initial: string; spy?: (u: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <UnitPicker
      id="u"
      value={v}
      onChange={(u) => {
        spy?.(u);
        setV(u);
      }}
    />
  );
}

describe("UnitPicker", () => {
  it("lists grouped units with None and Custom", () => {
    render(<UnitPicker id="u" value="" onChange={() => {}} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const options = Array.from(select.options);
    expect(options[0].textContent).toBe("None");
    expect(options[0].value).toBe("");
    expect(options[options.length - 1].textContent).toBe("Custom…");
    expect(select.querySelectorAll("optgroup").length).toBe(UNIT_GROUPS.length);
    const expected = ["None", ...UNIT_GROUPS.flatMap((g) => g.units), "Custom…"];
    expect(options.map((o) => o.textContent)).toEqual(expected);
    const groups = Array.from(select.querySelectorAll("optgroup"));
    expect(groups.map((g) => g.label)).toEqual(UNIT_GROUPS.map((g) => g.label));
    groups.forEach((g, i) =>
      expect(Array.from(g.querySelectorAll("option")).map((o) => o.textContent)).toEqual([...UNIT_GROUPS[i].units]),
    );
  });

  it('selecting °C calls onChange("°C")', () => {
    const onChange = vi.fn();
    render(<UnitPicker id="u" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "°C" } });
    expect(onChange).toHaveBeenCalledWith("°C");
  });

  it("unknown unit opens as Custom with its text", () => {
    const onChange = vi.fn();
    render(<UnitPicker id="u" value="degC" onChange={onChange} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe("Custom…");
    const input = screen.getByLabelText("Custom unit") as HTMLInputElement;
    expect(input.value).toBe("degC");
    fireEvent.change(input, { target: { value: "degCx" } });
    expect(onChange).toHaveBeenCalledWith("degCx");
  });

  it("custom text is capped at 16 characters", () => {
    render(<Harness initial="degC" />);
    const input = screen.getByLabelText("Custom unit") as HTMLInputElement;
    expect(input.maxLength).toBe(16);
  });

  it("choosing Custom keeps the current unit until the user types", () => {
    const spy = vi.fn();
    render(<Harness initial="°C" spy={spy} />);
    expect(screen.queryByLabelText("Custom unit")).toBeNull();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "__custom__" } });
    expect(spy).not.toHaveBeenCalled();
    const input = screen.getByLabelText("Custom unit") as HTMLInputElement;
    expect(input.value).toBe("°C");
    fireEvent.change(input, { target: { value: "degC" } });
    expect(spy).toHaveBeenCalledWith("degC");
  });

  it("follows value changes from the parent", () => {
    const { rerender } = render(<UnitPicker id="u" value="°C" onChange={() => {}} />);
    expect(screen.queryByLabelText("Custom unit")).toBeNull();
    rerender(<UnitPicker id="u" value="degC" onChange={() => {}} />);
    expect((screen.getByLabelText("Custom unit") as HTMLInputElement).value).toBe("degC");
    rerender(<UnitPicker id="u" value="bar" onChange={() => {}} />);
    expect(screen.queryByLabelText("Custom unit")).toBeNull();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("bar");
  });

  it('None calls onChange("")', () => {
    const onChange = vi.fn();
    render(<UnitPicker id="u" value="°C" onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith("");
  });
});
