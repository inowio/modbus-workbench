import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AnalyzerTilesCard from "./AnalyzerTilesCard";

let lastGridProps: any = null;
vi.mock("react-grid-layout", () => ({
  Responsive: (props: any) => {
    lastGridProps = props;
    return <div>{props.children}</div>;
  },
}));

const MAIN = { id: 1, name: "Main", position: 0 };
const BOILER = { id: 2, name: "Boiler", position: 1 };
const POWER = { id: 3, name: "Power", position: 2 };
const tile = { id: 5, kind: "value", title: "Voltage", configJson: "{}", pollingEnabled: true, createdAt: "", updatedAt: "", tabId: 2 };

function renderCard(opts: { tabs?: typeof MAIN[]; focusMode?: boolean; layoutEditMode?: boolean } = {}) {
  const tabs = opts.tabs ?? [MAIN, BOILER, POWER];
  const onMoveTile = vi.fn();
  const onDuplicateTile = vi.fn();
  const card = (focusMode: boolean) => (
    <AnalyzerTilesCard
      tiles={[tile]}
      workspaceHasTiles
      pollingWanted={false}
      gridReady
      layoutEditMode={opts.layoutEditMode ?? false}
      focusMode={focusMode}
      gridHostRef={{ current: null }}
      effectiveGridWidth={800}
      gridLayouts={{ desktop: [], mobile: [] }}
      onGridLayoutsChange={() => {}}
      derivedBreakpoint="desktop"
      schedulePersistLayouts={() => {}}
      renderTileValue={() => ({ label: "1", state: "OK" })}
      renderTrendTile={() => ({ points: [], state: "OK" })}
      nowTsMs={0}
      trendWindowMs={null}
      getTilePollingIntervalMs={() => null}
      getTilePrimarySignalId={() => null}
      getTileInfo={() => ({
        tileType: "Value",
        tileName: "Voltage",
        signalId: "sig-1",
        connection: "SERIAL",
        slaveId: 1,
        unitId: 1,
        registerAddress: 0,
        registerAddressFormatted: "0",
        registerType: "Holding",
        calculatedSource: null,
        pollIntervalMs: 1000,
      })}
      onConfigureSignals={() => {}}
      onAddTile={() => {}}
      onToggleTilePolling={() => {}}
      onEditTile={() => {}}
      onDeleteTile={() => {}}
      tabs={tabs}
      onMoveTile={onMoveTile}
      onDuplicateTile={onDuplicateTile}
    />
  );
  const view = render(card(opts.focusMode ?? false));
  return { onMoveTile, onDuplicateTile, setFocusMode: (on: boolean) => view.rerender(card(on)) };
}

function setup(tabs = [MAIN, BOILER, POWER]) {
  const handlers = renderCard({ tabs });
  fireEvent.click(screen.getByTitle("Tile menu"));
  return handlers;
}

/** Presses Escape on the body and reports whether a handler called preventDefault. */
function pressEscape(): boolean {
  const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => {
    document.body.dispatchEvent(ev);
  });
  return ev.defaultPrevented;
}

describe("AnalyzerTilesCard move / duplicate", () => {
  it("Move defaults to the first other tab and confirms the chosen tab", () => {
    const { onMoveTile } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Move to tab/ }));
    const select = screen.getByRole("combobox", { name: "Target tab" });
    expect(select).toHaveValue("1");
    expect(Array.from(select.querySelectorAll("option")).map((o) => o.textContent)).toEqual(["Main", "Power"]);
    fireEvent.change(select, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(onMoveTile).toHaveBeenCalledWith(tile, 3);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Duplicate defaults to the current tab", () => {
    const { onDuplicateTile } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Duplicate/ }));
    expect(screen.getByRole("combobox", { name: "Target tab" })).toHaveValue("2");
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(onDuplicateTile).toHaveBeenCalledWith(tile, 2);
  });

  it("Cancel closes without calling anything", () => {
    const { onMoveTile } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Move to tab/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onMoveTile).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hides Move when there is only one tab", () => {
    setup([BOILER]);
    expect(screen.queryByRole("button", { name: /Move to tab/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Duplicate/ })).toBeInTheDocument();
  });
});

describe("AnalyzerTilesCard Escape and focus view", () => {
  it("Escape closes an open tile menu and marks the event handled", () => {
    setup();
    expect(screen.getByRole("button", { name: "Information" })).toBeInTheDocument();
    expect(pressEscape()).toBe(true);
    expect(screen.queryByRole("button", { name: "Information" })).not.toBeInTheDocument();
  });

  it("entering focus view closes an open tile menu, so the first Escape is free for the page", () => {
    const { setFocusMode } = setup();
    expect(screen.getByRole("button", { name: "Information" })).toBeInTheDocument();
    setFocusMode(true);
    expect(pressEscape()).toBe(false);
    setFocusMode(false);
    expect(screen.queryByRole("button", { name: "Information" })).not.toBeInTheDocument();
  });

  it("in focus view there is no tile menu, and the grid is not editable even in layout edit mode", () => {
    renderCard({ focusMode: true, layoutEditMode: true });
    expect(screen.queryByTitle("Tile menu")).not.toBeInTheDocument();
    expect(lastGridProps.isDraggable).toBe(false);
    expect(lastGridProps.isResizable).toBe(false);
    expect(screen.queryByText(/Drag tiles to move/)).not.toBeInTheDocument();
  });

  it("in focus view a tile's information opens read-only; Escape closes it first (Review Focus 4)", () => {
    renderCard({ focusMode: true });
    fireEvent.click(screen.getByRole("button", { name: "Tile information" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("sig-1");

    // A page-level focus-view handler on window sees the first Escape as already handled.
    expect(pressEscape()).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(pressEscape()).toBe(false);
  });
});
