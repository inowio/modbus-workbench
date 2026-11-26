import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useOutletContext } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Screen2Layout, { type Screen2OutletContext } from "./Screen2Layout";

const invokeMock = vi.fn();
const listenMock = vi.fn();
const setTitleMock = vi.fn();
const listWorkspaceLogsMock = vi.fn();
const listAppLogsMock = vi.fn();
const clearTrafficEventsMock = vi.fn();
const setTrafficCaptureEnabledMock = vi.fn();

const globalAny = globalThis as typeof globalThis & { __APP_VERSION__?: string };
globalAny.__APP_VERSION__ = "test";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    setTitle: (...args: unknown[]) => setTitleMock(...args),
  }),
}));

vi.mock("../components/ThemeToggleButton", () => ({
  __esModule: true,
  default: () => <div data-testid="theme-toggle" />,
}));

vi.mock("../components/ToastProvider", () => ({
  useErrorToast: () => undefined,
}));

vi.mock("../help/HelpProvider", () => ({
  useHelp: () => ({ openHelp: vi.fn() }),
}));

vi.mock("./components/TrafficMonitorPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="traffic-panel" />,
}));

vi.mock("./api/logs", () => ({
  listWorkspaceLogs: (...args: unknown[]) => listWorkspaceLogsMock(...args),
  listAppLogs: (...args: unknown[]) => listAppLogsMock(...args),
}));

vi.mock("./api/traffic", () => ({
  clearTrafficEvents: (...args: unknown[]) => clearTrafficEventsMock(...args),
  setTrafficCaptureEnabled: (...args: unknown[]) => setTrafficCaptureEnabledMock(...args),
}));

const workspace = {
  name: "UnitTest",
  description: "Test workspace",
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-02T00:00:00.000Z",
};

function setupInvoke(options?: { logsPaneOpen?: boolean }) {
  const logsPaneOpen = options?.logsPaneOpen ?? false;

  invokeMock.mockImplementation((command: string) => {
    switch (command) {
      case "get_workspace":
        return Promise.resolve(workspace);
      case "get_client_settings":
        return Promise.resolve({ logsPaneOpen });
      case "set_client_settings":
        return Promise.resolve();
      case "prune_app_logs":
        return Promise.resolve();
      case "close_workspace_connections":
        return Promise.resolve();
      default:
        return Promise.resolve(null);
    }
  });
}

describe("Screen2Layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listWorkspaceLogsMock.mockResolvedValue([]);
    listAppLogsMock.mockResolvedValue([]);
    clearTrafficEventsMock.mockResolvedValue(0);
    setTrafficCaptureEnabledMock.mockResolvedValue(undefined);
    listenMock.mockResolvedValue(() => {});
  });

  it("loads logs when the panel is persisted open and persists closing it", async () => {
    setupInvoke({ logsPaneOpen: true });
    render(
      <MemoryRouter initialEntries={["/app/UnitTest/workspace"]}>
        <Routes>
          <Route path="/app/:workspaceName/*" element={<Screen2Layout />}>
            <Route path="workspace" element={<div />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(listWorkspaceLogsMock).toHaveBeenCalled());
    await waitFor(() => expect(listAppLogsMock).toHaveBeenCalled());

    const hideButton = await screen.findByRole("button", { name: /hide this panel/i });
    fireEvent.click(hideButton);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "set_client_settings",
        expect.objectContaining({
          name: "UnitTest",
          settings: expect.objectContaining({ logsPaneOpen: false }),
        }),
      ),
    );
  });

  it("Exit Workspace closes the workspace's connections (polling, simulator, serial port)", async () => {
    setupInvoke();
    render(
      <MemoryRouter initialEntries={["/app/UnitTest/workspace"]}>
        <Routes>
          <Route path="/app/:workspaceName/*" element={<Screen2Layout />}>
            <Route path="workspace" element={<div />} />
          </Route>
          <Route path="/" element={<div>Picker</div>} />
        </Routes>
      </MemoryRouter>,
    );

    const [exitButton] = await screen.findAllByRole("button", { name: /exit workspace/i });
    fireEvent.click(exitButton);

    await screen.findByText("Picker");
    expect(invokeMock).toHaveBeenCalledWith("close_workspace_connections", { name: "UnitTest" });
    expect(invokeMock).not.toHaveBeenCalledWith("modbus_rtu_disconnect", expect.anything());
  });

  it("focus mode hides the sidebar navigation and the app header", async () => {
    setupInvoke();
    function FocusChild() {
      const { setFocusMode } = useOutletContext<Screen2OutletContext>();
      return (
        <>
          <button type="button" onClick={() => setFocusMode?.(true)}>Enter focus</button>
          <button type="button" onClick={() => setFocusMode?.(false)}>Leave focus</button>
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={["/app/UnitTest/analyzer"]}>
        <Routes>
          <Route path="/app/:workspaceName/*" element={<Screen2Layout />}>
            <Route path="analyzer" element={<FocusChild />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: "Enter focus" });
    expect(screen.getByRole("link", { name: "Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Analyzer" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enter focus" }));
    expect(screen.queryByRole("link", { name: "Workspace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Analyzer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).not.toHaveClass("sm:px-4");

    fireEvent.click(screen.getByRole("button", { name: "Leave focus" }));
    expect(screen.getByRole("link", { name: "Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });
});
