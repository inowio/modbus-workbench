import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
const setAnalyzerTilePollingEnabledMock = vi.fn();
const deleteAnalyzerTileMock = vi.fn();
const createAnalyzerTileMock = vi.fn();
const listAnalyzerTabsMock = vi.fn();
const createAnalyzerTabMock = vi.fn();
const renameAnalyzerTabMock = vi.fn();
const reorderAnalyzerTabsMock = vi.fn();
const deleteAnalyzerTabMock = vi.fn();
let lastTilesCardProps: any = null;

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
    }),
  };
});

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
  setAnalyzerTilePollingEnabled: (...args: unknown[]) => setAnalyzerTilePollingEnabledMock(...args),
  deleteAnalyzerTile: (...args: unknown[]) => deleteAnalyzerTileMock(...args),
  createAnalyzerTile: (...args: unknown[]) => createAnalyzerTileMock(...args),
  listAnalyzerTabs: (...args: unknown[]) => listAnalyzerTabsMock(...args),
  createAnalyzerTab: (...args: unknown[]) => createAnalyzerTabMock(...args),
  renameAnalyzerTab: (...args: unknown[]) => renameAnalyzerTabMock(...args),
  reorderAnalyzerTabs: (...args: unknown[]) => reorderAnalyzerTabsMock(...args),
  deleteAnalyzerTab: (...args: unknown[]) => deleteAnalyzerTabMock(...args),
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

vi.mock("./analyzer/AnalyzerTilesCard", () => ({
  __esModule: true,
  default: (props: any) => {
    lastTilesCardProps = props;
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
}));

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
    setupAnalyzerData();
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

      act(() => {
        handlers["analyzer_signal_update"](update("a"));
      });
      // Let the 250 ms history flush happen while the trend tile is hidden.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 350));
      });

      fireEvent.click(screen.getByRole("tab", { name: "Boiler" }));
      const points = JSON.parse(screen.getByTestId("trend-2").textContent ?? "[]");
      expect(points).toHaveLength(1);
      expect(points[0].value).toBe(0.968);
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
  });
});
