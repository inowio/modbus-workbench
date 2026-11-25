import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalyzerTab, AnalyzerTile } from "../../api/analyzer";
import {
  nextTabId,
  readCycleSeconds,
  readLastTabId,
  resolveSelectedTab,
  tabStatus,
  writeCycleSeconds,
  writeLastTabId,
} from "./tabs";

const tab = (id: number, position: number, name = `T${id}`): AnalyzerTab => ({ id, name, position });

const tile = (id: number, pollingEnabled = true): AnalyzerTile => ({
  id,
  kind: "widget",
  title: `Tile ${id}`,
  configJson: "{}",
  pollingEnabled,
  createdAt: "",
  updatedAt: "",
  tabId: 1,
});

describe("resolveSelectedTab", () => {
  const tabs = [tab(7, 1), tab(3, 0), tab(9, 2)];

  it("keeps the wanted tab when it exists", () => {
    expect(resolveSelectedTab(tabs, 9)).toBe(9);
  });

  it("falls back to the first tab by position when wanted is missing or null", () => {
    expect(resolveSelectedTab(tabs, 42)).toBe(3);
    expect(resolveSelectedTab(tabs, null)).toBe(3);
  });
});

describe("nextTabId", () => {
  const tabs = [tab(5, 2), tab(1, 0), tab(2, 1)];

  it("moves forward and wraps to the first tab", () => {
    expect(nextTabId(tabs, 1, 1)).toBe(2);
    expect(nextTabId(tabs, 5, 1)).toBe(1);
  });

  it("moves backward and wraps to the last tab", () => {
    expect(nextTabId(tabs, 2, -1)).toBe(1);
    expect(nextTabId(tabs, 1, -1)).toBe(5);
  });
});

describe("tabStatus", () => {
  const states: Record<number, string> = {};
  const stateOf = (t: AnalyzerTile) => states[t.id] ?? "OK";

  afterEach(() => {
    for (const k of Object.keys(states)) delete states[Number(k)];
  });

  it("is null when not running", () => {
    states[1] = "ERROR";
    expect(tabStatus([tile(1)], stateOf, false)).toBeNull();
  });

  it("is null when every tile is OK", () => {
    expect(tabStatus([tile(1), tile(2)], stateOf, true)).toBeNull();
  });

  it("error beats stale", () => {
    states[1] = "STALE";
    states[2] = "ERROR";
    expect(tabStatus([tile(1), tile(2)], stateOf, true)).toBe("error");
  });

  it("reports stale when no tile errors", () => {
    states[2] = "stale";
    expect(tabStatus([tile(1), tile(2)], stateOf, true)).toBe("stale");
  });

  it("ignores disconnected and polling-disabled tiles", () => {
    states[1] = "DISCONNECTED";
    states[2] = "ERROR";
    states[3] = "STALE";
    expect(tabStatus([tile(1), tile(2, false), tile(3, false)], stateOf, true)).toBeNull();
  });
});

describe("local preferences", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("round-trips the last tab per workspace", () => {
    expect(readLastTabId("WS")).toBeNull();
    writeLastTabId("WS", 4);
    expect(window.localStorage.getItem("inowio.analyzer.lastTab.WS")).toBe("4");
    expect(readLastTabId("WS")).toBe(4);
    expect(readLastTabId("Other")).toBeNull();
  });

  it("ignores a garbage last tab", () => {
    window.localStorage.setItem("inowio.analyzer.lastTab.WS", "nope");
    expect(readLastTabId("WS")).toBeNull();
  });

  it("round-trips the cycle seconds and rejects unknown values", () => {
    expect(readCycleSeconds("WS")).toBe(0);
    writeCycleSeconds("WS", 30);
    expect(window.localStorage.getItem("inowio.analyzer.cycle.WS")).toBe("30");
    expect(readCycleSeconds("WS")).toBe(30);
    window.localStorage.setItem("inowio.analyzer.cycle.WS", "15");
    expect(readCycleSeconds("WS")).toBe(0);
  });

  it("survives a throwing localStorage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => writeLastTabId("WS", 2)).not.toThrow();
    expect(() => writeCycleSeconds("WS", 10)).not.toThrow();
    expect(readLastTabId("WS")).toBeNull();
    expect(readCycleSeconds("WS")).toBe(0);
  });
});
