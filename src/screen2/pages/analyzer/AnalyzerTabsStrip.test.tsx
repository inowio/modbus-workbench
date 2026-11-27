import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AnalyzerTabsStrip from "./AnalyzerTabsStrip";

const TABS = [
  { id: 1, name: "Main", position: 0 },
  { id: 2, name: "Boiler", position: 1 },
  { id: 3, name: "Power", position: 2 },
];

function setup(overrides: Partial<React.ComponentProps<typeof AnalyzerTabsStrip>> = {}) {
  const props = {
    tabs: TABS,
    selectedTabId: 2,
    statusByTabId: {} as Record<number, "error" | "stale" | null>,
    onSelect: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onRename: vi.fn().mockResolvedValue(undefined),
    onReorder: vi.fn().mockResolvedValue(undefined),
    onRequestDelete: vi.fn(),
    ...overrides,
  };
  render(<AnalyzerTabsStrip {...props} />);
  return props;
}

describe("AnalyzerTabsStrip", () => {
  it("renders tabs in order with the selected one marked", () => {
    const p = setup({ tabs: [TABS[2], TABS[0], TABS[1]] });
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Main", "Boiler", "Power"]);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");

    fireEvent.click(tabs[2]);
    expect(p.onSelect).toHaveBeenCalledWith(3);
  });

  it("adds a tab from the inline input on Enter", async () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add tab" }));
    const input = screen.getByRole("textbox", { name: "New tab name" });
    fireEvent.change(input, { target: { value: "  Boiler  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(p.onCreate).toHaveBeenCalledWith("Boiler"));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "New tab name" })).not.toBeInTheDocument());
  });

  it("Escape cancels adding a tab", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add tab" }));
    const input = screen.getByRole("textbox", { name: "New tab name" });
    fireEvent.change(input, { target: { value: "X" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "New tab name" })).not.toBeInTheDocument();
    expect(p.onCreate).not.toHaveBeenCalled();
  });

  it("keeps a rejected rename's error visible under the input", async () => {
    const onRename = vi.fn().mockRejectedValue('A tab named "Power" already exists');
    setup({ onRename });
    fireEvent.doubleClick(screen.getByRole("tab", { name: "Boiler" }));
    const input = screen.getByRole("textbox", { name: "Rename tab" });
    expect(input).toHaveValue("Boiler");
    fireEvent.change(input, { target: { value: "Power" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(onRename).toHaveBeenCalledWith(2, "Power");
    expect(screen.getByRole("alert")).toHaveTextContent('A tab named "Power" already exists');
    expect(screen.getByRole("textbox", { name: "Rename tab" })).toHaveValue("Power");
  });

  it("renames from the tab menu and commits on blur", async () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Tab options for Main" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Rename tab" });
    fireEvent.change(input, { target: { value: "Overview" } });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(p.onRename).toHaveBeenCalledWith(1, "Overview");
    expect(screen.queryByRole("textbox", { name: "Rename tab" })).not.toBeInTheDocument();
  });

  it("asks to delete from the tab menu", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Tab options for Power" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(p.onRequestDelete).toHaveBeenCalledWith(3);
  });

  it("disables Delete when only one tab is left", () => {
    setup({ tabs: [TABS[0]], selectedTabId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Tab options for Main" }));
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeDisabled();
  });

  it("reorders by dragging a tab onto another", () => {
    const p = setup();
    const tabs = screen.getAllByRole("tab");
    fireEvent.dragStart(tabs[2]);
    fireEvent.dragOver(tabs[0]);
    fireEvent.drop(tabs[0]);
    expect(p.onReorder).toHaveBeenCalledWith([3, 1, 2]);
  });

  it("renders status dots with their labels", () => {
    setup({ statusByTabId: { 1: "error", 3: "stale", 2: null } });
    expect(screen.getByRole("tab", { name: /Main/ })).toContainElement(screen.getByLabelText("has errors"));
    expect(screen.getByRole("tab", { name: /Power/ })).toContainElement(screen.getByLabelText("stale"));
    expect(screen.getAllByLabelText(/has errors|stale/)).toHaveLength(2);
  });
});
