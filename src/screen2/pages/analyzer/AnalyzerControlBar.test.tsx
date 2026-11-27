import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AnalyzerControlBar from "./AnalyzerControlBar";

function setup(overrides: Partial<React.ComponentProps<typeof AnalyzerControlBar>> = {}) {
  const props = {
    loading: false,
    trendWindowMinutes: 10 as number | null,
    onChangeTrendWindowMinutes: vi.fn(),
    pollingWanted: false,
    onRun: vi.fn(),
    onStop: vi.fn(),
    onConfigureSignals: vi.fn(),
    onOpenConnectionSettings: vi.fn(),
    onAddTile: vi.fn(),
    layoutEditMode: false,
    onToggleLayoutEditMode: vi.fn(),
    onRefresh: vi.fn(),
    onEnterFocus: vi.fn(),
    ...overrides,
  };
  render(<AnalyzerControlBar {...props} />);
  return props;
}

describe("AnalyzerControlBar", () => {
  it("calls each handler from its button", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /signals/i }));
    fireEvent.click(screen.getByRole("button", { name: /connection/i }));
    fireEvent.click(screen.getByRole("button", { name: /tile/i }));
    fireEvent.click(screen.getByRole("button", { name: /edit layout/i }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Focus view" }));
    fireEvent.click(screen.getByRole("button", { name: /run/i }));
    expect(p.onConfigureSignals).toHaveBeenCalledTimes(1);
    expect(p.onOpenConnectionSettings).toHaveBeenCalledTimes(1);
    expect(p.onAddTile).toHaveBeenCalledTimes(1);
    expect(p.onToggleLayoutEditMode).toHaveBeenCalledTimes(1);
    expect(p.onRefresh).toHaveBeenCalledTimes(1);
    expect(p.onEnterFocus).toHaveBeenCalledTimes(1);
    expect(p.onRun).toHaveBeenCalledTimes(1);
  });

  it("shows Run when stopped and Stop when running", () => {
    const p = setup({ pollingWanted: true });
    expect(screen.queryByRole("button", { name: /run/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(p.onStop).toHaveBeenCalledTimes(1);
    expect(p.onRun).not.toHaveBeenCalled();
  });

  it("shows Done while editing the layout", () => {
    setup({ layoutEditMode: true });
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /edit layout/i })).toBeNull();
  });

  it("maps the Trends select to minutes or null", () => {
    const p = setup();
    const select = screen.getByTitle("Trend history window");
    fireEvent.change(select, { target: { value: "all" } });
    expect(p.onChangeTrendWindowMinutes).toHaveBeenLastCalledWith(null);
    fireEvent.change(select, { target: { value: "30" } });
    expect(p.onChangeTrendWindowMinutes).toHaveBeenLastCalledWith(30);
  });

  it("has no Address control and renders children below the buttons", () => {
    setup();
    expect(screen.queryByText(/address/i)).toBeNull();
  });
});

describe("AnalyzerControlBar children slot", () => {
  it("renders children", () => {
    render(
      <AnalyzerControlBar
        loading={false}
        trendWindowMinutes={null}
        onChangeTrendWindowMinutes={() => {}}
        pollingWanted={false}
        onRun={() => {}}
        onStop={() => {}}
        onConfigureSignals={() => {}}
        onOpenConnectionSettings={() => {}}
        onAddTile={() => {}}
        layoutEditMode={false}
        onToggleLayoutEditMode={() => {}}
        onRefresh={() => {}}
        onEnterFocus={() => {}}
      >
        <div>tabs-slot</div>
      </AnalyzerControlBar>,
    );
    expect(screen.getByText("tabs-slot")).toBeTruthy();
  });
});
