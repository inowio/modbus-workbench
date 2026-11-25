import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnalyzerFocusOverlay from "./AnalyzerFocusOverlay";

function setup(overrides: Partial<Parameters<typeof AnalyzerFocusOverlay>[0]> = {}) {
  const props = {
    tabName: "Boiler",
    pollingWanted: false,
    onRun: vi.fn(),
    onStop: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    cycleSeconds: 0 as const,
    onCycleChange: vi.fn(),
    fullscreen: false,
    onToggleFullscreen: vi.fn(),
    onExit: vi.fn(),
    onHoverChange: vi.fn(),
    ...overrides,
  };
  render(<AnalyzerFocusOverlay {...props} />);
  return props;
}

const toolbar = () => screen.queryByRole("toolbar", { name: "Focus view controls" });

describe("AnalyzerFocusOverlay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows on mouse move and hides 2000 ms after the last move", () => {
    setup();
    act(() => vi.advanceTimersByTime(2000));
    expect(toolbar()).toBeNull();

    fireEvent.mouseMove(window);
    expect(toolbar()).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1500));
    fireEvent.mouseMove(window);
    act(() => vi.advanceTimersByTime(1999));
    expect(toolbar()).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(toolbar()).toBeNull();
  });

  it("is shown when focus view opens so the exit control is visible", () => {
    setup();
    expect(screen.getByRole("button", { name: "Exit focus view" })).toBeInTheDocument();
  });

  it("stays shown while hovered and reports hover changes", () => {
    const props = setup();
    const bar = toolbar()!;
    fireEvent.mouseEnter(bar);
    expect(props.onHoverChange).toHaveBeenLastCalledWith(true);
    act(() => vi.advanceTimersByTime(5000));
    expect(toolbar()).toBeInTheDocument();

    fireEvent.mouseLeave(bar);
    expect(props.onHoverChange).toHaveBeenLastCalledWith(false);
    act(() => vi.advanceTimersByTime(2000));
    expect(toolbar()).toBeNull();
  });

  it("each control calls its handler", () => {
    const props = setup();
    expect(screen.getByText("Boiler")).toBeInTheDocument();
    expect(screen.getByText("Stopped")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous tab" }));
    expect(props.onPrev).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Next tab" }));
    expect(props.onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(props.onRun).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(props.onToggleFullscreen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Exit focus view" }));
    expect(props.onExit).toHaveBeenCalledTimes(1);

    const cycle = screen.getByRole("combobox", { name: "Cycle tabs" });
    expect(Array.from(cycle.querySelectorAll("option")).map((o) => o.textContent)).toEqual(["Off", "10 s", "30 s", "60 s"]);
    expect(cycle).toHaveValue("0");
    fireEvent.change(cycle, { target: { value: "30" } });
    expect(props.onCycleChange).toHaveBeenCalledWith(30);
  });

  it("shows Stop and Running while polling, and the full screen state", () => {
    const props = setup({ pollingWanted: true, fullscreen: true });
    expect(screen.getByText("Running")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(props.onStop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Full screen" })).toHaveAttribute("aria-pressed", "true");
  });
});
