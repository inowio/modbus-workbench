import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AnalyzerTilesCard from "./AnalyzerTilesCard";

vi.mock("react-grid-layout", () => ({
  Responsive: (props: any) => <div>{props.children}</div>,
}));

const MAIN = { id: 1, name: "Main", position: 0 };
const BOILER = { id: 2, name: "Boiler", position: 1 };
const POWER = { id: 3, name: "Power", position: 2 };
const tile = { id: 5, kind: "value", title: "Voltage", configJson: "{}", pollingEnabled: true, createdAt: "", updatedAt: "", tabId: 2 };

function setup(tabs = [MAIN, BOILER, POWER]) {
  const onMoveTile = vi.fn();
  const onDuplicateTile = vi.fn();
  render(
    <AnalyzerTilesCard
      tiles={[tile]}
      workspaceHasTiles
      pollingWanted={false}
      gridReady
      layoutEditMode={false}
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
      getTileInfo={() => null}
      onConfigureSignals={() => {}}
      onAddTile={() => {}}
      onToggleTilePolling={() => {}}
      onEditTile={() => {}}
      onDeleteTile={() => {}}
      tabs={tabs}
      onMoveTile={onMoveTile}
      onDuplicateTile={onDuplicateTile}
    />,
  );
  fireEvent.click(screen.getByTitle("Tile menu"));
  return { onMoveTile, onDuplicateTile };
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
