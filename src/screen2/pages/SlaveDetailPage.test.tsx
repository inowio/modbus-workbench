import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SlaveDetailPage from "./SlaveDetailPage";

const invokeMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ workspaceName: "ws", slaveId: "1" }),
    useOutletContext: () => ({
      workspace: { name: "ws", created_at: "", updated_at: "" },
      setHasUnsavedChanges: vi.fn(),
      setInspectorContext: vi.fn(),
    }),
  };
});

vi.mock("../../components/ToastProvider", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
  useErrorToast: () => undefined,
}));

vi.mock("../api/logs", async () => {
  const actual = await vi.importActual<typeof import("../api/logs")>("../api/logs");
  return { ...actual, logEvent: () => Promise.resolve() };
});

vi.mock("../components/SlaveAttachmentsCard", () => ({ __esModule: true, default: () => null }));

const SLAVE = {
  id: 1,
  name: "SHT20",
  unitId: 1,
  connectionKind: "serial",
  pollIntervalMs: 1000,
  addressOffset: 0,
  createdAt: "",
  updatedAt: "",
};

function listSlavesCalls() {
  return invokeMock.mock.calls.filter((c) => c[0] === "list_slaves").length;
}

async function renderLoaded() {
  render(<SlaveDetailPage />);
  const poll = (await screen.findByLabelText("Poll interval (ms)")) as HTMLInputElement;
  await waitFor(() => expect(poll.value).toBe("1000"));
  return poll;
}

const RELOAD = { name: "Reload from saved configuration" };

describe("SlaveDetailPage reload button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "list_slaves":
          return Promise.resolve([SLAVE]);
        case "get_connection_settings":
          return Promise.resolve({ kind: "serial", serialPort: "COM3", serialBaud: 9600 });
        case "list_slave_register_rows":
          return Promise.resolve([]);
        case "list_serial_ports":
          return Promise.resolve([]);
        default:
          return Promise.resolve(null);
      }
    });
  });

  it("reloads straight away when nothing is unsaved", async () => {
    await renderLoaded();
    const before = listSlavesCalls();

    fireEvent.click(screen.getByRole("button", RELOAD));

    await waitFor(() => expect(listSlavesCalls()).toBe(before + 1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks before discarding unsaved changes; Keep editing keeps them", async () => {
    const poll = await renderLoaded();
    fireEvent.change(poll, { target: { value: "2500" } });
    const before = listSlavesCalls();

    fireEvent.click(screen.getByRole("button", RELOAD));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Discard unsaved changes?")).toBeInTheDocument();
    expect(listSlavesCalls()).toBe(before);

    fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(poll.value).toBe("2500");
    expect(listSlavesCalls()).toBe(before);
  });

  it("discards unsaved changes and reloads when confirmed", async () => {
    const poll = await renderLoaded();
    fireEvent.change(poll, { target: { value: "2500" } });
    const before = listSlavesCalls();

    fireEvent.click(screen.getByRole("button", RELOAD));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard and reload" }));

    await waitFor(() => expect(listSlavesCalls()).toBe(before + 1));
    await waitFor(() => expect(poll.value).toBe("1000"));
  });
});
