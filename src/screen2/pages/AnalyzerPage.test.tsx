import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnalyzerPage from "./AnalyzerPage";

const invokeMock = vi.fn();
const listenMock = vi.fn();
const pushToastMock = vi.fn();
const logEventMock = vi.fn();
const listAnalyzerSignalsMock = vi.fn();
const listSlavesMock = vi.fn();
const listAnalyzerTilesMock = vi.fn();
const listAnalyzerTileSignalsMock = vi.fn();
const listAnalyzerTileLayoutsMock = vi.fn();
const saveAnalyzerTileLayoutsMock = vi.fn();
const startAnalyzerPollingMock = vi.fn();
const stopAnalyzerPollingMock = vi.fn();
const isAnalyzerPollingRunningMock = vi.fn();
const setAnalyzerTilePollingEnabledMock = vi.fn();
const deleteAnalyzerTileMock = vi.fn();
const createAnalyzerTileMock = vi.fn();
const listAnalyzerTabsMock = vi.fn();
const createAnalyzerTabMock = vi.fn();
const renameAnalyzerTabMock = vi.fn();
const reorderAnalyzerTabsMock = vi.fn();
const deleteAnalyzerTabMock = vi.fn();
const moveAnalyzerTileToTabMock = vi.fn();
const duplicateAnalyzerTileMock = vi.fn();
const setFocusModeMock = vi.fn();
const setWindowFullscreenMock = vi.fn();
const isWindowFullscreenMock = vi.fn();
const onWindowResizedMock = vi.fn();
let lastTilesCardProps: any = null;
/** Render the real AnalyzerTilesCard instead of the light mock below (Review Focus 4). */
let useRealTilesCard = false;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useOutletContext: () => ({
      workspace: { name: "UnitTest", created_at: "", updated_at: "" },
      setFocusMode: setFocusModeMock,
    }),
  };
});

vi.mock("../utils/windowFullscreen", () => ({
  setWindowFullscreen: (...args: unknown[]) => setWindowFullscreenMock(...args),
  isWindowFullscreen: (...args: unknown[]) => isWindowFullscreenMock(...args),
  onWindowResized: (...args: unknown[]) => onWindowResizedMock(...args),
}));

vi.mock("react-grid-layout", () => ({
  Responsive: (props: any) => <div>{props.children}</div>,
}));

vi.mock("../../components/ToastProvider", () => ({
  useToast: () => ({ pushToast: pushToastMock }),
  useErrorToast: () => undefined,
}));

vi.mock("../api/logs", async () => {
  const actual = await vi.importActual<typeof import("../api/logs")>("../api/logs");
  return {
    ...actual,
    logEvent: (...args: unknown[]) => Promise.resolve(logEventMock(...args)),
  };
});

vi.mock("../api/slaves", () => ({
  listSlaves: (...args: unknown[]) => listSlavesMock(...args),
}));

vi.mock("../api/analyzer", () => ({
  listAnalyzerTiles: (...args: unknown[]) => listAnalyzerTilesMock(...args),
  listAnalyzerTileSignals: (...args: unknown[]) => listAnalyzerTileSignalsMock(...args),
  listAnalyzerTileLayouts: (...args: unknown[]) => listAnalyzerTileLayoutsMock(...args),
  saveAnalyzerTileLayouts: (...args: unknown[]) => saveAnalyzerTileLayoutsMock(...args),
  startAnalyzerPolling: (...args: unknown[]) => startAnalyzerPollingMock(...args),
  stopAnalyzerPolling: (...args: unknown[]) => stopAnalyzerPollingMock(...args),
  isAnalyzerPollingRunning: (...args: unknown[]) => isAnalyzerPollingRunningMock(...args),
  setAnalyzerTilePollingEnabled: (...args: unknown[]) => setAnalyzerTilePollingEnabledMock(...args),
  deleteAnalyzerTile: (...args: unknown[]) => deleteAnalyzerTileMock(...args),
  createAnalyzerTile: (...args: unknown[]) => createAnalyzerTileMock(...args),
  listAnalyzerTabs: (...args: unknown[]) => listAnalyzerTabsMock(...args),
  createAnalyzerTab: (...args: unknown[]) => createAnalyzerTabMock(...args),
  renameAnalyzerTab: (...args: unknown[]) => renameAnalyzerTabMock(...args),
  reorderAnalyzerTabs: (...args: unknown[]) => reorderAnalyzerTabsMock(...args),
  deleteAnalyzerTab: (...args: unknown[]) => deleteAnalyzerTabMock(...args),
  moveAnalyzerTileToTab: (...args: unknown[]) => moveAnalyzerTileToTabMock(...args),
  duplicateAnalyzerTile: (...args: unknown[]) => duplicateAnalyzerTileMock(...args),
  updateAnalyzerTile: vi.fn(),
  listAnalyzerSignals: (...args: unknown[]) => listAnalyzerSignalsMock(...args),
}));

vi.mock("./analyzer/AnalyzerControlBar", () => ({
  __esModule: true,
  default: (props: any) => (
    <div>
      <button type="button" onClick={props.onRefresh}>
        Refresh
      </button>
      <button type="button" onClick={props.onRun}>
        Start Polling
      </button>
      <button type="button" onClick={props.onStop}>
        Stop Polling
      </button>
      <button type="button" onClick={props.onOpenConnectionSettings}>
        Open Connection
      </button>
      <button type="button" onClick={props.onAddTile}>
        Add Tile
      </button>
      <button type="button" onClick={props.onEnterFocus}>
        Focus view
      </button>
      {props.children}
    </div>
  ),
}));

vi.mock("./analyzer/AnalyzerConfigureSignalsModal", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("./analyzer/AnalyzerAddEditTileModal", () => ({
  __esModule: true,
  default: (props: any) =>
    props.open ? (
      <button type="button" onClick={() => props.onSubmit({ kind: "value", title: "New", signalId: "sig-1" })}>
        Submit Tile
      </button>
    ) : null,
}));

vi.mock("../components/ConnectionSettingsForm", async () => {
  const actual = await vi.importActual<typeof import("../components/ConnectionSettingsForm")>("../components/ConnectionSettingsForm");
  return {
    ...actual,
    ConnectionSettingsForm: () => <div data-testid="connection-form" />,
  };
});

vi.mock("./analyzer/AnalyzerTilesCard", async () => {
  const actual = await vi.importActual<typeof import("./analyzer/AnalyzerTilesCard")>("./analyzer/AnalyzerTilesCard");
  return {
  __esModule: true,
  default: (props: any) => {
    lastTilesCardProps = props;
    if (useRealTilesCard) return <actual.default {...props} />;
    return (
    <div>
      {props.tiles.map((t: any) => (
        <span key={`marker-${t.id}`} data-testid={`tile-${t.id}`} />
      ))}
      <button
        type="button"
        onClick={() => props.tiles[0] && props.onToggleTilePolling(props.tiles[0])}
      >
        Toggle Tile
      </button>
      <button
        type="button"
        onClick={() => props.tiles[0] && props.onDeleteTile(props.tiles[0])}
      >
        Delete Tile
      </button>
      {props.tiles.map((t: any) =>
        t.kind === "trend" ? (
          <div key={t.id} data-testid={`trend-${t.id}`}>
            {JSON.stringify(props.renderTrendTile(t, props.pollingWanted).points)}
          </div>
        ) : t.kind === "value" ? (
          <div key={t.id}>
            <div data-testid={`value-${t.id}`}>{props.renderTileValue(t, props.pollingWanted).label}</div>
            <div data-testid={`info-${t.id}`}>{JSON.stringify(props.getTileInfo(t.id))}</div>
          </div>
        ) : null,
      )}
    </div>
    );
  },
  };
});

const MAIN = { id: 1, name: "Main", position: 0 };
const BOILER = { id: 2, name: "Boiler", position: 1 };
const POWER = { id: 3, name: "Power", position: 2 };

function setupAnalyzerData(options?: { tiles?: any[]; tabs?: any[] }) {
  const tiles =
    options?.tiles ?? [
      {
        id: 1,
        kind: "widget",
        title: "Voltage",
        configJson: "{}",
        pollingEnabled: true,
        createdAt: "",
        updatedAt: "",
        tabId: 1,
      },
    ];

  const signal = {
    id: "sig-1",
    kind: "register",
    inputSignalIds: [],
    slaveId: 1,
    connectionKind: "serial",
    functionKind: "holding",
    registerRowId: 1,
    address: 0,
    decoderJson: "{}",
    state: "OK",
  };

  const link = {
    tileId: 1,
    signalId: "sig-1",
    kind: "register",
    role: "primary",
    functionCode: 3,
    address: 0,
    alias: "",
    dataType: "u16",
    order: "abcd",
    displayFormat: "value",
    decoderJson: "{}",
    state: "OK",
  };

  listAnalyzerSignalsMock.mockResolvedValue([signal]);
  listSlavesMock.mockResolvedValue([
    {
      id: 1,
      name: "S1",
      unitId: 1,
      connectionKind: "serial",
      pollIntervalMs: 1000,
      addressOffset: 0,
      createdAt: "",
      updatedAt: "",
    },
  ]);
  listAnalyzerTilesMock.mockResolvedValue(tiles);
  listAnalyzerTileSignalsMock.mockResolvedValue([link]);
  listAnalyzerTileLayoutsMock.mockResolvedValue([]);
  saveAnalyzerTileLayoutsMock.mockResolvedValue(undefined);
  startAnalyzerPollingMock.mockResolvedValue(undefined);
  stopAnalyzerPollingMock.mockResolvedValue(undefined);
  setAnalyzerTilePollingEnabledMock.mockResolvedValue({ ...tiles[0], pollingEnabled: !tiles[0]?.pollingEnabled });
  deleteAnalyzerTileMock.mockResolvedValue(undefined);
  createAnalyzerTileMock.mockResolvedValue({ ...tiles[0], id: 99 });
  listAnalyzerTabsMock.mockResolvedValue(options?.tabs ?? [MAIN]);
  createAnalyzerTabMock.mockResolvedValue(undefined);
  renameAnalyzerTabMock.mockResolvedValue(undefined);
  reorderAnalyzerTabsMock.mockResolvedValue(undefined);
  deleteAnalyzerTabMock.mockResolvedValue(undefined);
  moveAnalyzerTileToTabMock.mockResolvedValue(undefined);
  duplicateAnalyzerTileMock.mockResolvedValue({ ...tiles[0], id: 98 });
  listenMock.mockResolvedValue(() => {});

  invokeMock.mockImplementation((command: string) => {
    switch (command) {
      case "get_connection_settings":
        return Promise.resolve({ kind: "serial" });
      case "list_serial_ports":
        return Promise.resolve([{ port: "COM1", label: "COM1" }]);
      case "test_connection":
        return Promise.resolve();
      case "set_connection_settings":
        return Promise.resolve();
      default:
        return Promise.resolve(null);
    }
  });
}

describe("AnalyzerPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    lastTilesCardProps = null;
    useRealTilesCard = false;
    setWindowFullscreenMock.mockResolvedValue(undefined);
    isWindowFullscreenMock.mockResolvedValue(false);
    onWindowResizedMock.mockResolvedValue(() => {});
    isAnalyzerPollingRunningMock.mockResolvedValue(false);
    setupAnalyzerData();
  });

  describe("polling state when the page opens", () => {
    it("shows polling as running when it kept running while the page was closed, without restarting it", async () => {
      isAnalyzerPollingRunningMock.mockResolvedValue(true);
      render(<AnalyzerPage />);

      await waitFor(() => expect(lastTilesCardProps?.pollingWanted).toBe(true));
      expect(isAnalyzerPollingRunningMock).toHaveBeenCalledWith("UnitTest");
      await waitFor(() => expect(listAnalyzerTilesMock).toHaveBeenCalled());
      expect(startAnalyzerPollingMock).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: /stop polling/i }));
      await waitFor(() => expect(stopAnalyzerPollingMock).toHaveBeenCalledWith("UnitTest"));
      await waitFor(() => expect(lastTilesCardProps?.pollingWanted).toBe(false));
    });

    it("shows polling as stopped when the backend is not polling", async () => {
      render(<AnalyzerPage />);

      await waitFor(() => expect(isAnalyzerPollingRunningMock).toHaveBeenCalledWith("UnitTest"));
      await waitFor(() => expect(listAnalyzerTilesMock).toHaveBeenCalled());
      expect(lastTilesCardProps?.pollingWanted).toBe(false);
      expect(startAnalyzerPollingMock).not.toHaveBeenCalled();
    });

    it("treats a failed status check as stopped and still loads the page", async () => {
      isAnalyzerPollingRunningMock.mockRejectedValue(new Error("boom"));
      render(<AnalyzerPage />);

      await waitFor(() => expect(listAnalyzerTilesMock).toHaveBeenCalled());
      expect(lastTilesCardProps?.pollingWanted).toBe(false);
    });
  });

  it("loads analyzer data on mount", async () => {
    render(<AnalyzerPage />);

    await waitFor(() => expect(listAnalyzerTilesMock).toHaveBeenCalledTimes(1));
    expect(listAnalyzerSignalsMock).toHaveBeenCalledWith("UnitTest");
    expect(listSlavesMock).toHaveBeenCalledWith("UnitTest");
    expect(listAnalyzerTileSignalsMock).toHaveBeenCalledWith("UnitTest", 1);
    expect(listAnalyzerTileLayoutsMock).toHaveBeenCalledWith("UnitTest");
  });

  it("starts and stops polling with toasts", async () => {
    render(<AnalyzerPage />);
    await waitFor(() => expect(listAnalyzerTilesMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /start polling/i }));
    await waitFor(() => expect(startAnalyzerPollingMock).toHaveBeenCalledWith("UnitTest"));
    expect(pushToastMock).toHaveBeenCalledWith("Polling started", "info");

    fireEvent.click(screen.getByRole("button", { name: /stop polling/i }));
    await waitFor(() => expect(stopAnalyzerPollingMock).toHaveBeenCalledWith("UnitTest"));
    expect(pushToastMock).toHaveBeenCalledWith("Polling stopped", "info");
  });

  it("prevents polling start when no tiles exist", async () => {
    setupAnalyzerData({ tiles: [] });
    render(<AnalyzerPage />);
    await waitFor(() => expect(listAnalyzerTilesMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /start polling/i }));
    expect(startAnalyzerPollingMock).not.toHaveBeenCalled();
    expect(pushToastMock).toHaveBeenCalledWith("Add a tile to start polling", "info");
  });

  it("opens connection modal and tests connection", async () => {
    render(<AnalyzerPage />);
    await waitFor(() => expect(listAnalyzerTilesMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /open connection/i }));
    await screen.findByText(/Connection settings/i);
    expect(invokeMock).toHaveBeenCalledWith("get_connection_settings", { name: "UnitTest" });
    expect(invokeMock).toHaveBeenCalledWith("list_serial_ports");

    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("test_connection", expect.objectContaining({ name: "UnitTest" })),
    );
  });

  it("toggles tile polling state", async () => {
    render(<AnalyzerPage />);
    await waitFor(() => expect(listAnalyzerTilesMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /toggle tile/i }));
    await waitFor(() =>
      expect(setAnalyzerTilePollingEnabledMock).toHaveBeenCalledWith("UnitTest", 1, expect.any(Boolean)),
    );
  });

  describe("calculated signals", () => {
    const power = JSON.stringify({
      math: {
        version: 1,
        inputs: [
          { name: "V", signalId: "a", value: "shown" },
          { name: "A", signalId: "b", value: "shown" },
        ],
        variables: [
          { name: "P", kind: "calc", start: { ref: "V" }, steps: [{ op: "mul", operand: { ref: "A" } }, { op: "div", operand: { num: 1000 } }] },
        ],
      },
      show: "P",
      decimals: 3,
    });

    const longAgo = () => Date.now() - 3_600_000;
    const regSignal = (id: string, raw: number, lastUpdatedTsMs: number = Date.now()) => ({
      id,
      kind: "register",
      inputSignalIds: [],
      slaveId: 1,
      connectionKind: "serial",
      functionKind: "holding",
      registerRowId: 1,
      address: 0,
      functionCode: 3,
      alias: null,
      dataType: "u16",
      order: "ABCD",
      displayFormat: "dec",
      decoderJson: JSON.stringify({ scale: 0.1, decimals: 1 }),
      lastValueJson: JSON.stringify({ rawWords: [raw] }),
      lastUpdatedTsMs,
      state: "OK",
    });

    const calcSignal = {
      id: "p",
      kind: "calculated",
      inputSignalIds: ["a", "b"],
      slaveId: null,
      connectionKind: "serial",
      functionKind: "holding",
      registerRowId: null,
      address: null,
      functionCode: null,
      alias: null,
      dataType: null,
      order: null,
      displayFormat: null,
      decoderJson: power,
      state: "OK",
    };

    const tile = (id: number, kind: string, tabId = 1) => ({
      id,
      kind,
      title: `T${id}`,
      configJson: "{}",
      pollingEnabled: true,
      createdAt: "",
      updatedAt: "",
      tabId,
    });

    const link = (tileId: number) => ({
      tileId,
      signalId: "p",
      kind: "calculated",
      role: "primary",
      functionCode: 0,
      address: -1,
      alias: "",
      dataType: "",
      order: "",
      displayFormat: "dec",
      decoderJson: power,
      state: "OK",
    });

    const handlers: Record<string, (event: { payload: unknown }) => void> = {};

    function setupCalculated(
      tiles: any[],
      opts?: { tsA?: number; tsB?: number; signalFor?: (tileId: number) => string; tabs?: any[] },
    ) {
      setupAnalyzerData({ tiles, tabs: opts?.tabs });
      listAnalyzerSignalsMock.mockResolvedValue([
        regSignal("a", 2304, opts?.tsA),
        regSignal("b", 42, opts?.tsB),
        calcSignal,
      ]);
      listAnalyzerTileSignalsMock.mockImplementation((_ws: string, tileId: number) =>
        Promise.resolve([{ ...link(tileId), signalId: opts?.signalFor?.(tileId) ?? "p" }]),
      );
      for (const k of Object.keys(handlers)) delete handlers[k];
      listenMock.mockImplementation((name: string, cb: (event: { payload: unknown }) => void) => {
        handlers[name] = cb;
        return Promise.resolve(() => {});
      });
    }

    const update = (signalId: string, extra: Record<string, unknown> = {}) => ({
      payload: { workspace: "UnitTest", signalId, tsMs: Date.now(), state: "OK", rawWords: [2304], ...extra },
    });

    async function startPolling() {
      await waitFor(() => expect(handlers["analyzer_signal_update"]).toBeDefined());
      fireEvent.click(screen.getByRole("button", { name: /start polling/i }));
      await waitFor(() => expect(startAnalyzerPollingMock).toHaveBeenCalled());
    }

    it("value tile on a calculated signal renders its computed label", async () => {
      setupCalculated([tile(1, "value")]);
      render(<AnalyzerPage />);
      await waitFor(() => expect(screen.getByTestId("value-1").textContent).toBe("0.968"));
    });

    it("tile information names a calculated signal's inputs instead of a register", async () => {
      setupCalculated([tile(1, "value"), tile(3, "value")], { signalFor: (id) => (id === 3 ? "a" : "p") });
      render(<AnalyzerPage />);
      await waitFor(() => expect(screen.getByTestId("value-1").textContent).toBe("0.968"));
      const info = (id: number) => JSON.parse(screen.getByTestId(`info-${id}`).textContent ?? "null");
      expect(info(1).calculatedSource).toBe("Calculated · inputs: a, b");
      expect(info(3).calculatedSource).toBeNull();
    });

    it("at rest with old timestamps, register and calculated tiles show last values (no stale label)", async () => {
      setupCalculated([tile(1, "value"), tile(3, "value")], {
        tsA: longAgo(),
        tsB: longAgo(),
        signalFor: (id) => (id === 3 ? "a" : "p"),
      });
      render(<AnalyzerPage />);
      await waitFor(() => expect(screen.getByTestId("value-1").textContent).toBe("0.968"));
      expect(screen.getByTestId("value-3").textContent).toBe("230.4");
    });

    it("trend history appends for a calculated tile when an input updates", async () => {
      setupCalculated([tile(2, "trend")]);
      render(<AnalyzerPage />);
      await startPolling();
      await waitFor(() => expect(listAnalyzerTileSignalsMock).toHaveBeenCalled());

      act(() => {
        handlers["analyzer_signal_update"](update("a"));
      });
      await waitFor(() => {
        const points = JSON.parse(screen.getByTestId("trend-2").textContent ?? "[]");
        expect(points).toHaveLength(1);
        expect(points[0].value).toBe(0.968);
      });
    });

    it("trend history appends a null point for a calculated tile when an input is stale", async () => {
      // B never updates and its last value is an hour old, so while polling it is age-STALE.
      setupCalculated([tile(2, "trend")], { tsB: longAgo() });
      render(<AnalyzerPage />);
      await startPolling();

      act(() => {
        handlers["analyzer_signal_update"](update("a"));
      });
      await waitFor(() => {
        const points = JSON.parse(screen.getByTestId("trend-2").textContent ?? "[]");
        expect(points).toHaveLength(1);
        expect(points[0].value).toBeNull();
      });
    });

    it("a trend tile on a hidden tab keeps its history while running (Review Focus 1)", async () => {
      setupCalculated([tile(1, "value", 1), tile(2, "trend", 2)], { tabs: [MAIN, BOILER] });
      render(<AnalyzerPage />);
      await screen.findByTestId("tile-1");
      await startPolling();
      expect(screen.queryByTestId("trend-2")).not.toBeInTheDocument();

      vi.useFakeTimers();
      try {
        act(() => {
          handlers["analyzer_signal_update"](update("a"));
        });
        // Let the 250 ms history flush happen while the trend tile is hidden.
        act(() => {
          vi.advanceTimersByTime(350);
        });

        fireEvent.click(screen.getByRole("tab", { name: "Boiler" }));
        const points = JSON.parse(screen.getByTestId("trend-2").textContent ?? "[]");
        expect(points).toHaveLength(1);
        expect(points[0].value).toBe(0.968);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("tabs", () => {
    const widget = (id: number, tabId: number) => ({
      id,
      kind: "widget",
      title: `W${id}`,
      configJson: "{}",
      pollingEnabled: true,
      createdAt: "",
      updatedAt: "",
      tabId,
    });

    function selectedTabName() {
      return screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")?.textContent;
    }

    it("shows only the selected tab's tiles and switches tabs", async () => {
      setupAnalyzerData({ tiles: [widget(1, 1), widget(2, 2)], tabs: [MAIN, BOILER] });
      render(<AnalyzerPage />);
      await screen.findByTestId("tile-1");
      expect(screen.queryByTestId("tile-2")).not.toBeInTheDocument();
      expect(selectedTabName()).toBe("Main");

      fireEvent.click(screen.getByRole("tab", { name: "Boiler" }));
      expect(screen.getByTestId("tile-2")).toBeInTheDocument();
      expect(screen.queryByTestId("tile-1")).not.toBeInTheDocument();
      expect(window.localStorage.getItem("inowio.analyzer.lastTab.UnitTest")).toBe("2");
    });

    it("passes only the selected tab's layouts to the grid and keeps other tabs' layouts", async () => {
      setupAnalyzerData({ tiles: [widget(1, 1), widget(2, 2)], tabs: [MAIN, BOILER] });
      render(<AnalyzerPage />);
      await screen.findByTestId("tile-1");
      expect(lastTilesCardProps.gridLayouts.desktop.map((l: any) => l.i)).toEqual(["1"]);

      act(() => {
        lastTilesCardProps.onGridLayoutsChange({
          desktop: [{ i: "1", x: 4, y: 0, w: 4, h: 5 }],
          mobile: [{ i: "1", x: 0, y: 0, w: 4, h: 5 }],
        });
      });

      fireEvent.click(screen.getByRole("tab", { name: "Boiler" }));
      expect(lastTilesCardProps.gridLayouts.desktop.map((l: any) => l.i)).toEqual(["2"]);

      fireEvent.click(screen.getByRole("tab", { name: "Main" }));
      expect(lastTilesCardProps.gridLayouts.desktop).toEqual([{ i: "1", x: 4, y: 0, w: 4, h: 5 }]);
    });

    it("restores the last tab from local preferences", async () => {
      window.localStorage.setItem("inowio.analyzer.lastTab.UnitTest", "2");
      setupAnalyzerData({ tiles: [widget(1, 1), widget(2, 2)], tabs: [MAIN, BOILER] });
      render(<AnalyzerPage />);
      await screen.findByTestId("tile-2");
      expect(selectedTabName()).toBe("Boiler");
    });

    it("falls back to the first tab when the remembered tab is gone", async () => {
      window.localStorage.setItem("inowio.analyzer.lastTab.UnitTest", "77");
      setupAnalyzerData({ tiles: [widget(1, 1), widget(2, 2)], tabs: [MAIN, BOILER] });
      render(<AnalyzerPage />);
      await screen.findByTestId("tile-1");
      expect(selectedTabName()).toBe("Main");
    });

    it("creates a new tile on the selected tab", async () => {
      setupAnalyzerData({ tiles: [widget(1, 1)], tabs: [MAIN, BOILER] });
      render(<AnalyzerPage />);
      await screen.findByTestId("tile-1");
      fireEvent.click(screen.getByRole("tab", { name: "Boiler" }));

      fireEvent.click(screen.getByRole("button", { name: "Add Tile" }));
      fireEvent.click(screen.getByRole("button", { name: "Submit Tile" }));
      await waitFor(() =>
        expect(createAnalyzerTileMock).toHaveBeenCalledWith("UnitTest", expect.objectContaining({ tabId: 2 })),
      );
      await waitFor(() => expect(screen.queryByRole("button", { name: "Submit Tile" })).not.toBeInTheDocument());
    });

    it("starts polling when only another tab has tiles", async () => {
      setupAnalyzerData({ tiles: [widget(2, 2)], tabs: [MAIN, BOILER] });
      render(<AnalyzerPage />);
      await screen.findByRole("tab", { name: "Main" });
      await waitFor(() => expect(listAnalyzerTileSignalsMock).toHaveBeenCalled());
      expect(screen.queryByTestId("tile-2")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /start polling/i }));
      await waitFor(() => expect(startAnalyzerPollingMock).toHaveBeenCalledWith("UnitTest"));
      expect(pushToastMock).not.toHaveBeenCalledWith("Add a tile to start polling", "info");
    });

    it("creates a tab from the strip and selects it", async () => {
      createAnalyzerTabMock.mockResolvedValue({ id: 5, name: "Extra", position: 1 });
      render(<AnalyzerPage />);
      await screen.findByRole("tab", { name: "Main" });

      fireEvent.click(screen.getByRole("button", { name: "Add tab" }));
      const input = screen.getByRole("textbox", { name: "New tab name" });
      fireEvent.change(input, { target: { value: "Extra" } });
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
      });
      expect(createAnalyzerTabMock).toHaveBeenCalledWith("UnitTest", "Extra");
      expect(selectedTabName()).toBe("Extra");
    });

    describe("deleting the selected tab (Review Focus 2)", () => {
      async function openDeleteFor(name: string) {
        await screen.findByRole("tab", { name });
        fireEvent.click(screen.getByRole("tab", { name }));
        fireEvent.click(screen.getByRole("button", { name: `Tab options for ${name}` }));
        fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
        return screen.getByRole("dialog");
      }

      it("moving its tiles lands on the move target", async () => {
        setupAnalyzerData({ tiles: [widget(1, 1), widget(2, 2)], tabs: [MAIN, BOILER, POWER] });
        deleteAnalyzerTabMock.mockImplementation(async () => {
          listAnalyzerTabsMock.mockResolvedValue([MAIN, POWER]);
          listAnalyzerTilesMock.mockResolvedValue([widget(1, 1), widget(2, 1)]);
        });
        render(<AnalyzerPage />);
        await openDeleteFor("Boiler");

        expect(screen.getByRole("radio", { name: /Move 1 tile to/ })).toBeChecked();
        expect(screen.getByRole("combobox", { name: "Target tab" })).toHaveValue("1");
        fireEvent.click(screen.getByRole("button", { name: "Delete tab" }));

        await waitFor(() => expect(deleteAnalyzerTabMock).toHaveBeenCalledWith("UnitTest", 2, { moveTilesTo: MAIN.id }));
        await waitFor(() => expect(screen.queryByRole("tab", { name: "Boiler" })).not.toBeInTheDocument());
        expect(selectedTabName()).toBe("Main");
        await screen.findByTestId("tile-2");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(window.localStorage.getItem("inowio.analyzer.lastTab.UnitTest")).toBe("1");
      });

      it("moving to a chosen tab lands on that tab", async () => {
        setupAnalyzerData({ tiles: [widget(1, 1), widget(2, 2)], tabs: [MAIN, BOILER, POWER] });
        deleteAnalyzerTabMock.mockImplementation(async () => {
          listAnalyzerTabsMock.mockResolvedValue([MAIN, POWER]);
          listAnalyzerTilesMock.mockResolvedValue([widget(1, 1), widget(2, 3)]);
        });
        render(<AnalyzerPage />);
        await openDeleteFor("Boiler");

        fireEvent.change(screen.getByRole("combobox", { name: "Target tab" }), { target: { value: "3" } });
        fireEvent.click(screen.getByRole("button", { name: "Delete tab" }));

        await waitFor(() => expect(deleteAnalyzerTabMock).toHaveBeenCalledWith("UnitTest", 2, { moveTilesTo: POWER.id }));
        await waitFor(() => expect(selectedTabName()).toBe("Power"));
        await screen.findByTestId("tile-2");
      });

      it("deleting its tiles lands on the first tab", async () => {
        setupAnalyzerData({ tiles: [widget(1, 1), widget(3, 3)], tabs: [MAIN, BOILER, POWER] });
        deleteAnalyzerTabMock.mockImplementation(async () => {
          listAnalyzerTabsMock.mockResolvedValue([MAIN, BOILER]);
          listAnalyzerTilesMock.mockResolvedValue([widget(1, 1)]);
        });
        render(<AnalyzerPage />);
        await openDeleteFor("Power");

        fireEvent.click(screen.getByRole("radio", { name: "Delete 1 tile" }));
        fireEvent.click(screen.getByRole("button", { name: "Delete tab" }));

        await waitFor(() => expect(deleteAnalyzerTabMock).toHaveBeenCalledWith("UnitTest", 3, { deleteTiles: true }));
        await waitFor(() => expect(screen.queryByRole("tab", { name: "Power" })).not.toBeInTheDocument());
        expect(selectedTabName()).toBe("Main");
        await screen.findByTestId("tile-1");
      });

      it("an empty tab gets a plain confirm", async () => {
        setupAnalyzerData({ tiles: [widget(1, 1)], tabs: [MAIN, BOILER] });
        deleteAnalyzerTabMock.mockImplementation(async () => {
          listAnalyzerTabsMock.mockResolvedValue([MAIN]);
        });
        render(<AnalyzerPage />);
        await openDeleteFor("Boiler");

        expect(screen.queryByRole("radio")).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Delete tab" }));
        await waitFor(() => expect(deleteAnalyzerTabMock).toHaveBeenCalledWith("UnitTest", 2, {}));
        await waitFor(() => expect(selectedTabName()).toBe("Main"));
      });

      it("shows the backend error and keeps the dialog open", async () => {
        setupAnalyzerData({ tiles: [widget(1, 1)], tabs: [MAIN, BOILER] });
        deleteAnalyzerTabMock.mockRejectedValue("Tab not found");
        render(<AnalyzerPage />);
        await openDeleteFor("Boiler");

        fireEvent.click(screen.getByRole("button", { name: "Delete tab" }));
        expect(await screen.findByText("Tab not found")).toBeInTheDocument();
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(selectedTabName()).toBe("Boiler");
      });
    });

    describe("move and duplicate", () => {
      it("moving a tile reloads tiles and layouts and drops it from the grid", async () => {
        setupAnalyzerData({ tiles: [widget(1, 1), widget(2, 1)], tabs: [MAIN, BOILER] });
        moveAnalyzerTileToTabMock.mockImplementation(async () => {
          listAnalyzerTilesMock.mockResolvedValue([widget(1, 1), widget(2, 2)]);
        });
        render(<AnalyzerPage />);
        await screen.findByTestId("tile-2");
        const layoutCalls = listAnalyzerTileLayoutsMock.mock.calls.length;

        await act(async () => {
          lastTilesCardProps.onMoveTile(lastTilesCardProps.tiles[1], 2);
        });

        expect(moveAnalyzerTileToTabMock).toHaveBeenCalledWith("UnitTest", 2, 2);
        await waitFor(() => expect(screen.queryByTestId("tile-2")).not.toBeInTheDocument());
        expect(screen.getByTestId("tile-1")).toBeInTheDocument();
        expect(listAnalyzerTileLayoutsMock.mock.calls.length).toBeGreaterThan(layoutCalls);
      });

      it("duplicating into the current tab shows the new tile", async () => {
        setupAnalyzerData({ tiles: [widget(1, 1)], tabs: [MAIN, BOILER] });
        duplicateAnalyzerTileMock.mockImplementation(async () => {
          listAnalyzerTilesMock.mockResolvedValue([widget(1, 1), widget(7, 1)]);
          return widget(7, 1);
        });
        render(<AnalyzerPage />);
        await screen.findByTestId("tile-1");

        await act(async () => {
          lastTilesCardProps.onDuplicateTile(lastTilesCardProps.tiles[0], 1);
        });

        expect(duplicateAnalyzerTileMock).toHaveBeenCalledWith("UnitTest", 1, 1);
        await screen.findByTestId("tile-7");
      });

      describe("pins current positions before the backend places tiles at the bottom (no saved rows)", () => {
        // Default widget placement (no saved rows): desktop 3 per row at x 0/4/8, h 5; mobile one column, y 0/5/10.
        const at = (desktop: [number, number], mobileY: number) => [
          { breakpoint: "desktop", x: desktop[0], y: desktop[1], w: 4, h: 5 },
          { breakpoint: "mobile", x: 0, y: mobileY, w: 4, h: 5 },
        ];
        let events: string[];

        /** Call after setupAnalyzerData (it resets the save mock); a save is logged when it resolves. */
        function trackSaves() {
          events = [];
          saveAnalyzerTileLayoutsMock.mockImplementation(async (_ws: string, tileId: number) => {
            await Promise.resolve();
            events.push(`save:${tileId}`);
          });
        }

        const savedRows = () =>
          Object.fromEntries(saveAnalyzerTileLayoutsMock.mock.calls.map(([, id, rows]) => [id, rows]));

        it("move: saves the target tab's and the moving tile's rows, then moves", async () => {
          setupAnalyzerData({ tiles: [widget(1, 1), widget(2, 1), widget(3, 1), widget(5, 2)], tabs: [MAIN, BOILER] });
          trackSaves();
          moveAnalyzerTileToTabMock.mockImplementation(async () => {
            events.push("move");
          });
          render(<AnalyzerPage />);
          await screen.findByTestId("tile-2");
          saveAnalyzerTileLayoutsMock.mockClear();

          await act(async () => {
            await lastTilesCardProps.onMoveTile(lastTilesCardProps.tiles[1], 2);
          });

          expect(savedRows()).toEqual({ 5: at([0, 0], 0), 2: at([4, 0], 5) });
          // Every save finished before the move was sent.
          expect(events).toHaveLength(3);
          expect(events[2]).toBe("move");
        });

        it("move into a tab with some saved rows pins the saved ones as saved and the rest as shown", async () => {
          setupAnalyzerData({ tiles: [widget(1, 1), widget(2, 1), widget(5, 2), widget(6, 2)], tabs: [MAIN, BOILER] });
          listAnalyzerTileLayoutsMock.mockResolvedValue([{ tileId: 5, breakpoint: "desktop", x: 2, y: 7, w: 6, h: 8 }]);
          trackSaves();
          render(<AnalyzerPage />);
          await screen.findByTestId("tile-2");
          saveAnalyzerTileLayoutsMock.mockClear();

          await act(async () => {
            await lastTilesCardProps.onMoveTile(lastTilesCardProps.tiles[0], 2);
          });

          expect(savedRows()).toEqual({
            5: [
              { breakpoint: "desktop", x: 2, y: 7, w: 6, h: 8 },
              { breakpoint: "mobile", x: 0, y: 0, w: 4, h: 5 },
            ],
            6: at([4, 0], 5),
            1: at([0, 0], 0),
          });
          expect(moveAnalyzerTileToTabMock).toHaveBeenCalledWith("UnitTest", 1, 2);
        });

        it("duplicate: saves the target tab's and the source tile's rows, then duplicates", async () => {
          setupAnalyzerData({ tiles: [widget(1, 1), widget(2, 1), widget(5, 2), widget(6, 2)], tabs: [MAIN, BOILER] });
          trackSaves();
          duplicateAnalyzerTileMock.mockImplementation(async () => {
            events.push("duplicate");
            return widget(9, 2);
          });
          render(<AnalyzerPage />);
          await screen.findByTestId("tile-2");
          saveAnalyzerTileLayoutsMock.mockClear();

          await act(async () => {
            await lastTilesCardProps.onDuplicateTile(lastTilesCardProps.tiles[1], 2);
          });

          expect(savedRows()).toEqual({ 5: at([0, 0], 0), 6: at([4, 0], 5), 2: at([4, 0], 5) });
          expect(events).toHaveLength(4);
          expect(events[3]).toBe("duplicate");
        });

        it("delete tab with move: saves the target tab's and every moving tile's rows, then deletes", async () => {
          setupAnalyzerData({ tiles: [widget(1, 1), widget(5, 2), widget(6, 2)], tabs: [MAIN, BOILER] });
          trackSaves();
          deleteAnalyzerTabMock.mockImplementation(async () => {
            events.push("delete");
          });
          render(<AnalyzerPage />);
          await screen.findByRole("tab", { name: "Boiler" });
          fireEvent.click(screen.getByRole("tab", { name: "Boiler" }));
          fireEvent.click(screen.getByRole("button", { name: "Tab options for Boiler" }));
          fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
          saveAnalyzerTileLayoutsMock.mockClear();
          fireEvent.click(screen.getByRole("button", { name: "Delete tab" }));

          await waitFor(() => expect(deleteAnalyzerTabMock).toHaveBeenCalledWith("UnitTest", 2, { moveTilesTo: MAIN.id }));
          expect(savedRows()).toEqual({ 1: at([0, 0], 0), 5: at([0, 0], 0), 6: at([4, 0], 5) });
          expect(events).toHaveLength(4);
          expect(events[3]).toBe("delete");
        });

        it("delete tab without move saves nothing", async () => {
          setupAnalyzerData({ tiles: [widget(1, 1), widget(5, 2)], tabs: [MAIN, BOILER] });
          render(<AnalyzerPage />);
          await screen.findByRole("tab", { name: "Boiler" });
          fireEvent.click(screen.getByRole("tab", { name: "Boiler" }));
          fireEvent.click(screen.getByRole("button", { name: "Tab options for Boiler" }));
          fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
          fireEvent.click(screen.getByRole("radio", { name: "Delete 1 tile" }));
          saveAnalyzerTileLayoutsMock.mockClear();
          fireEvent.click(screen.getByRole("button", { name: "Delete tab" }));

          await waitFor(() => expect(deleteAnalyzerTabMock).toHaveBeenCalledWith("UnitTest", 2, { deleteTiles: true }));
          expect(saveAnalyzerTileLayoutsMock).not.toHaveBeenCalled();
        });
      });

      it("shows the backend error when moving fails", async () => {
        setupAnalyzerData({ tiles: [widget(1, 1)], tabs: [MAIN, BOILER] });
        moveAnalyzerTileToTabMock.mockRejectedValue("boom");
        render(<AnalyzerPage />);
        await screen.findByTestId("tile-1");
        await act(async () => {
          lastTilesCardProps.onMoveTile(lastTilesCardProps.tiles[0], 2);
        });
        expect(await screen.findByText("boom")).toBeInTheDocument();
      });
    });

    describe("status dots", () => {
      const valueTile = (id: number, tabId: number) => ({ ...widget(id, tabId), kind: "value" });

      async function setupStatus(state: string) {
        setupAnalyzerData({ tiles: [valueTile(1, 2)], tabs: [MAIN, BOILER] });
        listAnalyzerSignalsMock.mockResolvedValue([
          {
            id: "sig-1",
            kind: "register",
            inputSignalIds: [],
            slaveId: 1,
            connectionKind: "serial",
            functionKind: "holding",
            registerRowId: 1,
            address: 0,
            functionCode: 3,
            alias: null,
            dataType: "u16",
            order: "ABCD",
            displayFormat: "dec",
            decoderJson: "{}",
            lastValueJson: JSON.stringify({ rawWords: [1] }),
            lastUpdatedTsMs: Date.now(),
            state,
          },
        ]);
        render(<AnalyzerPage />);
        await screen.findByRole("tab", { name: "Boiler" });
        await waitFor(() => expect(listAnalyzerTileSignalsMock).toHaveBeenCalled());
      }

      it("dots a tab with an errored tile while running, and clears when stopped", async () => {
        await setupStatus("ERROR");
        expect(screen.queryByLabelText("has errors")).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: /start polling/i }));
        await waitFor(() => expect(startAnalyzerPollingMock).toHaveBeenCalled());
        expect(await screen.findByLabelText("has errors")).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /Boiler/ })).toContainElement(screen.getByLabelText("has errors"));

        fireEvent.click(screen.getByRole("button", { name: /stop polling/i }));
        await waitFor(() => expect(screen.queryByLabelText("has errors")).not.toBeInTheDocument());
      });
    });

    describe("Ctrl+digit shortcuts", () => {
      async function setupThree() {
        setupAnalyzerData({ tiles: [widget(1, 1)], tabs: [MAIN, BOILER, POWER] });
        render(<AnalyzerPage />);
        await screen.findByRole("tab", { name: "Power" });
      }
      const press = (key: string, target: Element = document.body) =>
        fireEvent.keyDown(target, { key, ctrlKey: true });

      it("Ctrl+2 selects the second tab; Ctrl+9 with 3 tabs does nothing", async () => {
        await setupThree();
        press("2");
        expect(selectedTabName()).toBe("Boiler");
        press("9");
        expect(selectedTabName()).toBe("Boiler");
        press("1");
        expect(selectedTabName()).toBe("Main");
      });

      it("is ignored while a tab-rename input has focus", async () => {
        await setupThree();
        fireEvent.doubleClick(screen.getByRole("tab", { name: "Main" }));
        const input = screen.getByRole("textbox", { name: "Rename tab" });
        input.focus();
        press("2", input);
        fireEvent.keyDown(input, { key: "Escape" });
        expect(selectedTabName()).toBe("Main");
      });

      it("is ignored while a modal dialog is open", async () => {
        await setupThree();
        fireEvent.click(screen.getByRole("tab", { name: "Boiler" }));
        fireEvent.click(screen.getByRole("button", { name: "Tab options for Boiler" }));
        fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        press("3");
        expect(selectedTabName()).toBe("Boiler");
      });

      it("is ignored while the connection settings modal is open", async () => {
        await setupThree();
        fireEvent.click(screen.getByRole("button", { name: "Open Connection" }));
        expect(await screen.findByRole("dialog", { name: "Connection settings" })).toBeInTheDocument();
        press("2");
        expect(selectedTabName()).toBe("Main");
      });
    });
  });

  describe("focus view", () => {
    const widget = (id: number, tabId: number) => ({
      id,
      kind: "widget",
      title: `W${id}`,
      configJson: "{}",
      pollingEnabled: true,
      createdAt: "",
      updatedAt: "",
      tabId,
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function renderThreeTabs() {
      setupAnalyzerData({ tiles: [widget(1, 1), widget(2, 2), widget(3, 3)], tabs: [MAIN, BOILER, POWER] });
      const view = render(<AnalyzerPage />);
      await screen.findByTestId("tile-1");
      return view;
    }

    function enterFocus() {
      fireEvent.click(screen.getByRole("button", { name: "Focus view" }));
    }

    /** The overlay hides after 2 s idle; a mouse move brings it back. */
    function overlayButton(name: string) {
      fireEvent.mouseMove(window);
      return screen.getByRole("button", { name });
    }

    const shownTiles = () => screen.queryAllByTestId(/^tile-/).map((el) => el.getAttribute("data-testid"));
    const chromeShown = () =>
      screen.queryByRole("tablist") != null && screen.queryByRole("button", { name: "Refresh" }) != null;
    const pressEscape = () => fireEvent.keyDown(document.body, { key: "Escape" });

    it("enters from the control bar, hides the control bar and tabs strip, and Exit restores them", async () => {
      await renderThreeTabs();
      expect(chromeShown()).toBe(true);

      enterFocus();
      expect(setFocusModeMock).toHaveBeenLastCalledWith(true);
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
      expect(lastTilesCardProps.focusMode).toBe(true);
      expect(shownTiles()).toEqual(["tile-1"]);

      fireEvent.click(overlayButton("Exit focus view"));
      expect(setFocusModeMock).toHaveBeenLastCalledWith(false);
      expect(chromeShown()).toBe(true);
      expect(lastTilesCardProps.focusMode).toBe(false);
      expect(screen.queryByRole("button", { name: "Exit focus view" })).not.toBeInTheDocument();
    });

    it("Esc exits focus view; without full screen the window is left alone", async () => {
      await renderThreeTabs();
      enterFocus();
      pressEscape();
      expect(setFocusModeMock).toHaveBeenLastCalledWith(false);
      expect(chromeShown()).toBe(true);
      expect(setWindowFullscreenMock).not.toHaveBeenCalled();
    });

    it("full screen toggles the window, and exiting focus view with Esc leaves full screen", async () => {
      await renderThreeTabs();
      enterFocus();
      fireEvent.click(overlayButton("Full screen"));
      expect(setWindowFullscreenMock).toHaveBeenLastCalledWith(true);
      await waitFor(() => expect(overlayButton("Full screen")).toHaveAttribute("aria-pressed", "true"));

      pressEscape();
      expect(setWindowFullscreenMock).toHaveBeenLastCalledWith(false);
      expect(setFocusModeMock).toHaveBeenLastCalledWith(false);
      expect(chromeShown()).toBe(true);
    });

    it("when the OS leaves full screen by itself, the toggle turns off and focus view stays", async () => {
      let resized: (() => void) | null = null;
      onWindowResizedMock.mockImplementation(async (cb: () => void) => {
        resized = cb;
        return () => {};
      });
      await renderThreeTabs();
      enterFocus();
      fireEvent.click(overlayButton("Full screen"));
      await waitFor(() => expect(overlayButton("Full screen")).toHaveAttribute("aria-pressed", "true"));
      await waitFor(() => expect(resized).not.toBeNull());

      isWindowFullscreenMock.mockResolvedValue(false);
      await act(async () => {
        resized!();
      });
      await waitFor(() => expect(overlayButton("Full screen")).toHaveAttribute("aria-pressed", "false"));
      expect(setFocusModeMock).not.toHaveBeenCalledWith(false);
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();

      // Exiting now has no full screen to leave.
      setWindowFullscreenMock.mockClear();
      pressEscape();
      expect(setFocusModeMock).toHaveBeenLastCalledWith(false);
      expect(setWindowFullscreenMock).not.toHaveBeenCalled();
    });

    it("leaving the page while in focus view resets focus mode and full screen", async () => {
      const { unmount } = await renderThreeTabs();
      enterFocus();
      fireEvent.click(overlayButton("Full screen"));
      await waitFor(() => expect(overlayButton("Full screen")).toHaveAttribute("aria-pressed", "true"));

      unmount();
      expect(setFocusModeMock).toHaveBeenLastCalledWith(false);
      expect(setWindowFullscreenMock).toHaveBeenLastCalledWith(false);
    });

    it("previous / next switch tabs with wrap-around, and Ctrl+digit still works", async () => {
      await renderThreeTabs();
      enterFocus();
      fireEvent.click(overlayButton("Previous tab"));
      expect(shownTiles()).toEqual(["tile-3"]);
      expect(screen.getByRole("toolbar", { name: "Focus view controls" })).toHaveTextContent("Power");
      fireEvent.click(overlayButton("Next tab"));
      expect(shownTiles()).toEqual(["tile-1"]);

      fireEvent.keyDown(document.body, { key: "2", ctrlKey: true });
      expect(shownTiles()).toEqual(["tile-2"]);
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    });

    it("Run / Stop in the overlay start and stop polling", async () => {
      await renderThreeTabs();
      enterFocus();
      fireEvent.click(overlayButton("Run"));
      await waitFor(() => expect(startAnalyzerPollingMock).toHaveBeenCalledWith("UnitTest"));
      fireEvent.click(overlayButton("Stop"));
      await waitFor(() => expect(stopAnalyzerPollingMock).toHaveBeenCalledWith("UnitTest"));
    });

    it("cycles tabs every 10 s with wrap-around, pauses while hovered, persists the choice, and keeps polling", async () => {
      await renderThreeTabs();
      fireEvent.click(screen.getByRole("button", { name: /start polling/i }));
      await waitFor(() => expect(startAnalyzerPollingMock).toHaveBeenCalled());
      enterFocus();

      vi.useFakeTimers();
      fireEvent.mouseMove(window);
      fireEvent.change(screen.getByRole("combobox", { name: "Cycle tabs" }), { target: { value: "10" } });
      expect(window.localStorage.getItem("inowio.analyzer.cycle.UnitTest")).toBe("10");

      act(() => vi.advanceTimersByTime(9999));
      expect(shownTiles()).toEqual(["tile-1"]);
      act(() => vi.advanceTimersByTime(1));
      expect(shownTiles()).toEqual(["tile-2"]);
      act(() => vi.advanceTimersByTime(10_000));
      expect(shownTiles()).toEqual(["tile-3"]);
      act(() => vi.advanceTimersByTime(10_000));
      expect(shownTiles()).toEqual(["tile-1"]);

      // Hovering the overlay pauses cycling; leaving it starts a fresh period.
      fireEvent.mouseMove(window);
      const bar = screen.getByRole("toolbar", { name: "Focus view controls" });
      fireEvent.mouseEnter(bar);
      act(() => vi.advanceTimersByTime(30_000));
      expect(shownTiles()).toEqual(["tile-1"]);
      fireEvent.mouseLeave(bar);
      act(() => vi.advanceTimersByTime(10_000));
      expect(shownTiles()).toEqual(["tile-2"]);

      expect(stopAnalyzerPollingMock).not.toHaveBeenCalled();
    });

    it("cycling pauses while a tile's Info dialog is open and starts a fresh period when it closes", async () => {
      useRealTilesCard = true;
      const realResizeObserver = globalThis.ResizeObserver;
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
      const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
      try {
        window.localStorage.setItem("inowio.analyzer.cycle.UnitTest", "10");
        setupAnalyzerData({ tiles: [widget(1, 1), widget(2, 2), widget(3, 3)], tabs: [MAIN, BOILER, POWER] });
        render(<AnalyzerPage />);
        await screen.findByTitle("Tile menu");
        vi.useFakeTimers();
        enterFocus();
        const currentTab = () => {
          fireEvent.mouseMove(window);
          return screen.getByRole("toolbar", { name: "Focus view controls" }).textContent ?? "";
        };

        fireEvent.click(screen.getByRole("button", { name: "Tile information" }));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        act(() => vi.advanceTimersByTime(30_000));
        expect(currentTab()).toContain("Main");

        fireEvent.keyDown(document.body, { key: "Escape" });
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        act(() => vi.advanceTimersByTime(9_999));
        expect(currentTab()).toContain("Main");
        act(() => vi.advanceTimersByTime(1));
        expect(currentTab()).toContain("Boiler");
      } finally {
        rect.mockRestore();
        globalThis.ResizeObserver = realResizeObserver;
      }
    });

    it("reads the remembered cycle value and does not cycle outside focus view", async () => {
      window.localStorage.setItem("inowio.analyzer.cycle.UnitTest", "30");
      await renderThreeTabs();
      enterFocus();
      fireEvent.mouseMove(window);
      expect(screen.getByRole("combobox", { name: "Cycle tabs" })).toHaveValue("30");
      fireEvent.click(overlayButton("Exit focus view"));

      vi.useFakeTimers();
      act(() => vi.advanceTimersByTime(60_000));
      expect(shownTiles()).toEqual(["tile-1"]);
    });

    it("Esc closes a tile's Info popover first and keeps focus view; the next Esc exits (Review Focus 4)", async () => {
      useRealTilesCard = true;
      const realResizeObserver = globalThis.ResizeObserver;
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
      const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
      try {
        render(<AnalyzerPage />);
        await screen.findByTitle("Tile menu");
        enterFocus();
        expect(screen.queryByTitle("Tile menu")).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Tile information" }));
        expect(screen.getByRole("dialog")).toBeInTheDocument();

        pressEscape();
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(setFocusModeMock).not.toHaveBeenCalledWith(false);
        expect(screen.queryByRole("tablist")).not.toBeInTheDocument();

        pressEscape();
        expect(setFocusModeMock).toHaveBeenLastCalledWith(false);
        expect(chromeShown()).toBe(true);
      } finally {
        rect.mockRestore();
        globalThis.ResizeObserver = realResizeObserver;
      }
    });
  });
});
