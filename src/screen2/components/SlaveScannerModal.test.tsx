import { act, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScanFoundEvent, ScanRequest } from "../api/slaveScan";
import SlaveScannerModal from "./SlaveScannerModal";

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

type Handler = (event: { payload: unknown }) => void;

let handlers: Record<string, Handler> = {};
let unlistens: Record<string, ReturnType<typeof vi.fn>> = {};

const WS = "ws";

const SERIAL_SETTINGS = {
  kind: "serial",
  serialPort: "COM3",
  serialBaud: 9600,
  serialParity: "none",
  serialDataBits: 8,
  serialStopBits: 1,
  serialFlowControl: "none",
  tcpHost: "192.168.1.10",
  tcpPort: 502,
};

const PORTS = [
  { port: "COM3", label: "COM3 (USB Serial)" },
  { port: "COM5", label: "COM5" },
];

function setup(options?: {
  settings?: Record<string, unknown>;
  start?: (request: ScanRequest) => Promise<string>;
}) {
  const settings = options?.settings ?? SERIAL_SETTINGS;
  invokeMock.mockImplementation((command: string, args?: { request?: ScanRequest }) => {
    switch (command) {
      case "get_connection_settings":
        return Promise.resolve(settings);
      case "list_serial_ports":
        return Promise.resolve(PORTS);
      case "start_slave_scan":
        return options?.start ? options.start(args!.request!) : Promise.resolve(args!.request!.scanId);
      case "cancel_slave_scan":
        return Promise.resolve();
      default:
        return Promise.resolve(null);
    }
  });
}

function renderModal(props?: { onClose?: () => void; onAdd?: (pick: unknown) => void }) {
  const onClose = props?.onClose ?? vi.fn();
  const onAdd = props?.onAdd ?? vi.fn();
  const utils = render(
    <SlaveScannerModal
      open
      workspaceName={WS}
      existingSlaves={[{ unitId: 3, connectionKind: "serial", name: "Slave 3" }]}
      onClose={onClose}
      onAdd={onAdd}
    />,
  );
  return { ...utils, onClose, onAdd };
}

async function loaded() {
  await waitFor(() => expect(screen.getByLabelText("Start")).toHaveValue(1));
}

function startCalls() {
  return invokeMock.mock.calls.filter((c) => c[0] === "start_slave_scan");
}

function cancelCalls() {
  return invokeMock.mock.calls.filter((c) => c[0] === "cancel_slave_scan");
}

async function startScan(): Promise<string> {
  fireEvent.click(screen.getByRole("button", { name: "Scan" }));
  await waitFor(() => expect(startCalls()).toHaveLength(1));
  await screen.findByRole("button", { name: "Cancel" });
  return (startCalls()[0][1] as { request: ScanRequest }).request.scanId;
}

function fire(eventName: string, payload: unknown) {
  act(() => {
    handlers[eventName]({ payload });
  });
}

function foundEvent(scanId: string, partial: Partial<ScanFoundEvent>): ScanFoundEvent {
  return {
    workspace: WS,
    scanId,
    target: "COM3",
    unitId: 1,
    settings: { baud: 9600, parity: "none", dataBits: 8, stopBits: 1, flowControl: "none" },
    category: "found",
    detail: "value",
    functionCode: 3,
    responseMs: 14,
    ...partial,
  };
}

describe("SlaveScannerModal", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    handlers = {};
    unlistens = {};
    listenMock.mockImplementation((name: string, handler: Handler) => {
      handlers[name] = handler;
      const unlisten = vi.fn();
      unlistens[name] = unlisten;
      return Promise.resolve(unlisten);
    });
    setup();
  });

  it("renders nothing and loads nothing while closed", () => {
    const { container } = render(
      <SlaveScannerModal open={false} workspaceName={WS} existingSlaves={[]} onClose={vi.fn()} onAdd={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("defaults from workspace serial settings", async () => {
    renderModal();
    await loaded();
    expect(invokeMock).toHaveBeenCalledWith("get_connection_settings", { name: WS });
    expect(invokeMock).toHaveBeenCalledWith("list_serial_ports");
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("Quantity")).toHaveValue(247);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /COM3/ })).toBeChecked());
    expect(screen.getByRole("checkbox", { name: /COM5/ })).not.toBeChecked();
    expect(screen.getByLabelText("Baud")).toHaveValue("9600");
    expect(screen.getByLabelText("Parity")).toHaveValue("none");
    expect(screen.getByLabelText("Check with")).toHaveDisplayValue("03, then 04");
    expect(screen.getByLabelText("Wait (ms)")).toHaveValue(200);
    expect(screen.getByLabelText("Retries")).toHaveValue(0);
  });

  it("defaults from workspace TCP settings with a 1000 ms wait", async () => {
    setup({ settings: { ...SERIAL_SETTINGS, kind: "tcp" } });
    renderModal();
    await loaded();
    expect(screen.getByLabelText("Host")).toHaveValue("192.168.1.10");
    expect(screen.getByLabelText("TCP port")).toHaveValue(502);
    expect(screen.getByLabelText("Parallel checks")).toHaveValue(4);
    expect(screen.getByLabelText("Quantity")).toHaveValue(255);
    expect(screen.getByLabelText("Wait (ms)")).toHaveValue(1000);
  });

  it("switching kind resets an untouched wait but keeps an edited one", async () => {
    renderModal();
    await loaded();
    fireEvent.click(screen.getByRole("radio", { name: "TCP" }));
    expect(screen.getByLabelText("Wait (ms)")).toHaveValue(1000);
    expect(screen.getByLabelText("Quantity")).toHaveValue(255);
    fireEvent.click(screen.getByRole("radio", { name: "Serial (RTU)" }));
    expect(screen.getByLabelText("Wait (ms)")).toHaveValue(200);

    fireEvent.change(screen.getByLabelText("Wait (ms)"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("radio", { name: "TCP" }));
    expect(screen.getByLabelText("Wait (ms)")).toHaveValue(300);
  });

  it("sweep checkbox shows baud and parity choices with workspace values ticked", async () => {
    renderModal();
    await loaded();
    const sweep = screen.getByRole("checkbox", { name: "Also try other baud rates & parity" });
    expect(sweep).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "1200" })).toBeNull();

    fireEvent.click(sweep);
    expect(screen.getByRole("checkbox", { name: "9600" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "19200" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "115200" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "N" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "E" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "O" })).not.toBeChecked();

    fireEvent.click(sweep);
    expect(screen.queryByRole("checkbox", { name: "1200" })).toBeNull();
  });

  it("shows estimated duration", async () => {
    renderModal();
    await loaded();
    expect(screen.getByText(/about 1 min 39 s/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Also try other baud rates & parity" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "19200" }));
    expect(screen.getByText(/about 3 min 18 s/)).toBeInTheDocument();
  });

  it("Scan sends request with generated scanId and disables Scan while scanning", async () => {
    renderModal();
    await loaded();
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /COM3/ })).toBeChecked());
    const scanId = await startScan();

    expect(scanId).not.toBe("");
    expect(startCalls()[0][1]).toEqual({
      name: WS,
      request: {
        scanId,
        kind: "serial",
        startUnitId: 1,
        quantity: 247,
        probe: "holdingThenInput",
        waitMs: 200,
        retries: 0,
        ports: ["COM3"],
        serial: { baud: 9600, parity: "none", dataBits: 8, stopBits: 1, flowControl: "none" },
        sweep: null,
        tcp: null,
        concurrency: null,
      },
    });

    // All five listeners were registered before start was invoked.
    expect(listenMock.mock.calls.map((c) => c[0]).sort()).toEqual(
      ["slave_scan_done", "slave_scan_found", "slave_scan_host", "slave_scan_notice", "slave_scan_progress"],
    );
    const startOrder = invokeMock.mock.invocationCallOrder[invokeMock.mock.calls.findIndex((c) => c[0] === "start_slave_scan")];
    expect(Math.max(...listenMock.mock.invocationCallOrder)).toBeLessThan(startOrder);

    expect(screen.queryByRole("button", { name: "Scan" })).toBeNull();
    expect(screen.getByLabelText("Start")).toBeDisabled();
    expect(startCalls()).toHaveLength(1);
  });

  it("sends a TCP request with the sweep off and the concurrency set", async () => {
    setup({ settings: { ...SERIAL_SETTINGS, kind: "tcp" } });
    renderModal();
    await loaded();
    fireEvent.change(screen.getByLabelText("Parallel checks"), { target: { value: "8" } });
    await startScan();
    expect((startCalls()[0][1] as { request: ScanRequest }).request).toMatchObject({
      kind: "tcp",
      startUnitId: 1,
      quantity: 255,
      waitMs: 1000,
      ports: [],
      serial: null,
      sweep: null,
      tcp: { host: "192.168.1.10", port: 502 },
      concurrency: 8,
    });
  });

  it("shows progress for the current address and settings", async () => {
    renderModal();
    await loaded();
    const scanId = await startScan();
    fire("slave_scan_progress", {
      workspace: WS,
      scanId,
      checked: 17,
      total: 247,
      current: { target: "COM3", unitId: 18, settings: { baud: 9600, parity: "none", dataBits: 8, stopBits: 1, flowControl: "none" } },
    });
    expect(screen.getByText(/unit 18 on COM3 at 9600 8N1/)).toBeInTheDocument();
    expect(screen.getByText("17 / 247")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "17");
  });

  it("groups results and marks existing slaves", async () => {
    renderModal();
    await loaded();
    const scanId = await startScan();
    fire("slave_scan_found", foundEvent(scanId, { unitId: 17, detail: "exception 02" }));
    fire("slave_scan_found", foundEvent(scanId, { unitId: 3 }));
    fire("slave_scan_found", foundEvent(scanId, { unitId: 9, category: "garbled", detail: "CRC error" }));
    fire("slave_scan_found", foundEvent(scanId, { unitId: 40, category: "gatewayNoDevice", detail: "exception 0B" }));

    const unit3 = screen.getByRole("listitem", { name: "Unit 3 on COM3" });
    expect(within(unit3).getByText("already in workspace")).toBeInTheDocument();
    expect(within(unit3).queryByRole("button", { name: "Add" })).toBeNull();

    const unit17 = screen.getByRole("listitem", { name: "Unit 17 on COM3" });
    expect(within(unit17).getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(within(unit17).getByText("exception 02")).toBeInTheDocument();
    expect(within(unit17).getByText("9600 8N1")).toBeInTheDocument();
    expect(within(unit17).getByText("14 ms")).toBeInTheDocument();

    // Garbled replies start collapsed to a one-line summary, so they don't crowd out real devices.
    const garbledToggle = screen.getByRole("button", { name: /Answered but garbled — maybe wrong baud rate \(1\)/ });
    expect(garbledToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listitem", { name: "Unit 9 on COM3" })).toBeNull();
    expect(screen.getByText(/COM3 at 9600 8N1: 1 address/)).toBeInTheDocument();
    fireEvent.click(garbledToggle);
    const unit9 = screen.getByRole("listitem", { name: "Unit 9 on COM3" });
    expect(within(unit9).getByText("CRC error")).toBeInTheDocument();

    const gatewayToggle = screen.getByRole("button", { name: /Gateway reported no device/ });
    expect(gatewayToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listitem", { name: "Unit 40 on COM3" })).toBeNull();
    fireEvent.click(gatewayToggle);
    expect(screen.getByRole("listitem", { name: "Unit 40 on COM3" })).toBeInTheDocument();
  });

  it("ignores events from another scanId", async () => {
    renderModal();
    await loaded();
    const scanId = await startScan();
    fire("slave_scan_found", foundEvent("someone-else", { unitId: 17 }));
    fire("slave_scan_found", { ...foundEvent(scanId, { unitId: 18 }), workspace: "other-ws" });
    fire("slave_scan_notice", { workspace: WS, scanId: "someone-else", message: "not mine" });
    fire("slave_scan_done", { workspace: WS, scanId: "someone-else", reason: "completed", error: null, checked: 1, found: 1 });
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.queryByText("not mine")).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    fire("slave_scan_found", foundEvent(scanId, { unitId: 19 }));
    expect(screen.getByRole("listitem", { name: "Unit 19 on COM3" })).toBeInTheDocument();
  });

  it("Cancel calls cancel_slave_scan", async () => {
    renderModal();
    await loaded();
    const scanId = await startScan();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(cancelCalls()).toEqual([["cancel_slave_scan", { name: WS, scanId }]]));
    expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();
  });

  it("done(cancelled) returns to the idle form", async () => {
    renderModal();
    await loaded();
    const scanId = await startScan();
    fire("slave_scan_found", foundEvent(scanId, { unitId: 17 }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fire("slave_scan_done", { workspace: WS, scanId, reason: "cancelled", error: null, checked: 20, found: 1 });

    expect(screen.getByRole("button", { name: "Scan" })).toBeEnabled();
    expect(screen.getByLabelText("Start")).toBeEnabled();
    expect(screen.getByText(/Scan cancelled/)).toBeInTheDocument();
    // Results stay so the user can still add what was found.
    expect(screen.getByRole("listitem", { name: "Unit 17 on COM3" })).toBeInTheDocument();
  });

  it("done(failed) shows the error inline", async () => {
    renderModal();
    await loaded();
    const scanId = await startScan();
    fire("slave_scan_done", {
      workspace: WS,
      scanId,
      reason: "failed",
      error: "could not connect to 10.0.0.5:502",
      checked: 0,
      found: 0,
    });
    expect(screen.getByText(/could not connect to 10.0.0.5:502/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan" })).toBeEnabled();
  });

  it("accepts done that arrives before start resolves", async () => {
    let resolveStart: (id: string) => void = () => {};
    setup({ start: () => new Promise<string>((resolve) => (resolveStart = resolve)) });
    renderModal();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    await waitFor(() => expect(startCalls()).toHaveLength(1));
    const scanId = (startCalls()[0][1] as { request: ScanRequest }).request.scanId;

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(cancelCalls()).toHaveLength(1));
    fire("slave_scan_done", { workspace: WS, scanId, reason: "cancelled", error: null, checked: 0, found: 0 });
    expect(screen.getByRole("button", { name: "Scan" })).toBeEnabled();

    await act(async () => {
      resolveStart(scanId);
    });
    expect(screen.getByRole("button", { name: "Scan" })).toBeEnabled();
    expect(cancelCalls()).toHaveLength(1);
  });

  it("closing while start is pending cancels again once start resolves", async () => {
    let resolveStart: (id: string) => void = () => {};
    setup({ start: () => new Promise<string>((resolve) => (resolveStart = resolve)) });
    renderModal();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    await waitFor(() => expect(startCalls()).toHaveLength(1));
    const scanId = (startCalls()[0][1] as { request: ScanRequest }).request.scanId;

    // The backend may not have registered the scan yet, so this cancel can be a no-op.
    fireEvent.click(screen.getByRole("button", { name: "Close scanner" }));
    expect(cancelCalls()).toHaveLength(1);

    await act(async () => {
      resolveStart(scanId);
    });
    expect(cancelCalls()).toEqual([
      ["cancel_slave_scan", { name: WS, scanId }],
      ["cancel_slave_scan", { name: WS, scanId }],
    ]);
  });

  it("Cancel while start is pending cancels again once start resolves", async () => {
    let resolveStart: (id: string) => void = () => {};
    setup({ start: () => new Promise<string>((resolve) => (resolveStart = resolve)) });
    renderModal();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    await waitFor(() => expect(startCalls()).toHaveLength(1));
    const scanId = (startCalls()[0][1] as { request: ScanRequest }).request.scanId;

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(cancelCalls()).toHaveLength(1));

    await act(async () => {
      resolveStart(scanId);
    });
    expect(cancelCalls()).toEqual([
      ["cancel_slave_scan", { name: WS, scanId }],
      ["cancel_slave_scan", { name: WS, scanId }],
    ]);
  });

  it("a scan that is neither cancelled nor closed sends no cancel", async () => {
    let resolveStart: (id: string) => void = () => {};
    setup({ start: () => new Promise<string>((resolve) => (resolveStart = resolve)) });
    renderModal();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    await waitFor(() => expect(startCalls()).toHaveLength(1));
    const scanId = (startCalls()[0][1] as { request: ScanRequest }).request.scanId;
    await act(async () => {
      resolveStart(scanId);
    });
    fire("slave_scan_done", { workspace: WS, scanId, reason: "completed", error: null, checked: 247, found: 0 });
    expect(screen.getByText(/Scan complete/)).toBeInTheDocument();
    // The Checked counter keeps the final count once the scan has ended.
    expect(screen.getByText("Checked").parentElement).toHaveTextContent("247");
    expect(cancelCalls()).toHaveLength(0);
  });

  it("keeps a non-standard workspace baud in the sweep list, ticked and sorted", async () => {
    setup({ settings: { ...SERIAL_SETTINGS, serialBaud: 230400 } });
    renderModal();
    await loaded();
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /COM3/ })).toBeChecked());
    fireEvent.click(screen.getByRole("checkbox", { name: "Also try other baud rates & parity" }));

    const baud230400 = screen.getByRole("checkbox", { name: "230400" });
    expect(baud230400).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "9600" })).not.toBeChecked();
    const order = screen
      .getAllByRole("checkbox")
      .map((c) => c.closest("label")?.textContent ?? "")
      .filter((t) => /^\d+$/.test(t));
    expect(order).toEqual(["1200", "2400", "4800", "9600", "19200", "38400", "57600", "115200", "230400"]);

    fireEvent.click(screen.getByRole("checkbox", { name: "9600" }));
    await startScan();
    expect((startCalls()[0][1] as { request: ScanRequest }).request.sweep).toEqual({
      bauds: [9600, 230400],
      parities: ["none"],
    });
  });

  it("shows a start refusal inline and returns to the form", async () => {
    setup({ start: () => Promise.reject("A scan is already running in this workspace") });
    renderModal();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(await screen.findByText("A scan is already running in this workspace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan" })).toBeEnabled();
  });

  it("disables Scan with a reason when no serial port is selected", async () => {
    renderModal();
    await loaded();
    const com3 = screen.getByRole("checkbox", { name: /COM3/ });
    await waitFor(() => expect(com3).toBeChecked());
    fireEvent.click(com3);
    expect(screen.getByRole("button", { name: "Scan" })).toBeDisabled();
    expect(screen.getByText("Select at least one serial port")).toBeInTheDocument();
  });

  it("unmount during a scan cancels it", async () => {
    const { unmount } = renderModal();
    await loaded();
    const scanId = await startScan();
    unmount();
    expect(cancelCalls()).toEqual([["cancel_slave_scan", { name: WS, scanId }]]);
    for (const name of ["slave_scan_found", "slave_scan_progress", "slave_scan_notice", "slave_scan_done"]) {
      expect(unlistens[name]).toHaveBeenCalled();
    }
  });

  it("closing the modal while scanning cancels the scan first", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await loaded();
    const scanId = await startScan();
    fireEvent.click(screen.getByRole("button", { name: "Close scanner" }));
    expect(cancelCalls()).toEqual([["cancel_slave_scan", { name: WS, scanId }]]);
    expect(onClose).toHaveBeenCalledTimes(1);
    const cancelOrder = invokeMock.mock.invocationCallOrder[invokeMock.mock.calls.findIndex((c) => c[0] === "cancel_slave_scan")];
    expect(cancelOrder).toBeLessThan(onClose.mock.invocationCallOrder[0]);
  });

  it("Esc while scanning cancels, then closes, and prevents default", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await loaded();
    const scanId = await startScan();
    const esc = createEvent.keyDown(document, { key: "Escape" });
    fireEvent(document, esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(cancelCalls()).toEqual([["cancel_slave_scan", { name: WS, scanId }]]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc while idle just closes without cancelling", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await loaded();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(cancelCalls()).toHaveLength(0);
  });

  it("Add passes a ScanPick", async () => {
    const onAdd = vi.fn();
    renderModal({ onAdd });
    await loaded();
    const scanId = await startScan();
    fire(
      "slave_scan_found",
      foundEvent(scanId, {
        unitId: 17,
        target: "COM5",
        settings: { baud: 19200, parity: "even", dataBits: 8, stopBits: 1, flowControl: "none" },
      }),
    );
    fire("slave_scan_found", foundEvent(scanId, { unitId: 18, target: "COM3" }));

    fireEvent.click(within(screen.getByRole("listitem", { name: "Unit 17 on COM5" })).getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenLastCalledWith({
      unitId: 17,
      connectionKind: "serial",
      suggestedName: "Slave 17",
      serialToSave: {
        port: "COM5",
        params: { baud: 19200, parity: "even", dataBits: 8, stopBits: 1, flowControl: "none" },
        portDiffers: true,
      },
      tcpToSave: null,
    });
    // Adding while a scan runs stops the scan.
    expect(cancelCalls()).toEqual([["cancel_slave_scan", { name: WS, scanId }]]);

    fireEvent.click(within(screen.getByRole("listitem", { name: "Unit 18 on COM3" })).getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenLastCalledWith({
      unitId: 18,
      connectionKind: "serial",
      suggestedName: "Slave 18",
      serialToSave: null,
      tcpToSave: null,
    });
  });

  it("notice events render inline", async () => {
    renderModal();
    await loaded();
    const scanId = await startScan();
    fire("slave_scan_notice", {
      workspace: WS,
      scanId,
      message: "Device accepts 1 connection(s); scanning 1 at a time",
    });
    expect(screen.getByText("Device accepts 1 connection(s); scanning 1 at a time")).toBeInTheDocument();
  });

  describe("IP range mode", () => {
    function setupRange(defaultRange: string | null = "192.168.68.1-254") {
      setup();
      const base = invokeMock.getMockImplementation()!;
      invokeMock.mockImplementation((command: string, args?: { request?: ScanRequest }) =>
        command === "scan_default_ip_range"
          ? Promise.resolve(defaultRange)
          : command === "scan_local_ipv4"
            ? Promise.resolve(defaultRange ? "192.168.68.128" : null)
            : base(command, args),
      );
    }

    function openCustom() {
      fireEvent.click(screen.getByRole("button", { name: "Custom range (CIDR or across subnets)" }));
    }

    async function openRangeMode() {
      renderModal();
      await loaded();
      fireEvent.click(screen.getByRole("radio", { name: "TCP" }));
      fireEvent.click(screen.getByRole("radio", { name: "IP range" }));
    }

    it("shows range fields, pre-filled from scan_default_ip_range", async () => {
      setupRange();
      await openRangeMode();
      await waitFor(() => expect(screen.getByLabelText("Network")).toHaveValue("192.168.68"));
      expect(screen.getByLabelText("From")).toHaveValue(1);
      expect(screen.getByLabelText("To")).toHaveValue(254);
      expect(screen.getByText("This PC: 192.168.68.128")).toBeInTheDocument();
      expect(screen.getByText("192.168.68.1 → 192.168.68.254 · 254 addresses")).toBeInTheDocument();
      expect(screen.getByLabelText("TCP port")).toHaveValue(502);
      expect(screen.queryByLabelText("Range")).toBeNull();
      expect(screen.queryByLabelText("Connect wait (ms)")).toBeNull();
      expect(screen.queryByLabelText("Host")).toBeNull();
      expect(screen.getByLabelText("Start")).toBeInTheDocument();
      expect(screen.getByLabelText("Check with")).toBeInTheDocument();
      expect(screen.getByText(/Finding hosts: about 3 s, then about/)).toBeInTheDocument();
    });

    it("leaves the network empty when there is no default", async () => {
      setupRange(null);
      await openRangeMode();
      expect(screen.getByLabelText("Network")).toHaveValue("");
      expect(screen.getAllByText("Enter the network, like 192.168.68").length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: "Use my network" })).toBeNull();
      expect(screen.getByRole("button", { name: "Scan" })).toBeDisabled();
    });

    it("an invalid range shows the reason and disables Scan", async () => {
      setupRange();
      await openRangeMode();
      await waitFor(() => expect(screen.getByLabelText("Network")).toHaveValue("192.168.68"));
      openCustom();
      fireEvent.change(screen.getByLabelText("Range"), { target: { value: "10.0.0.0/21" } });
      expect(screen.getAllByText("Too many addresses (2046) — the limit is 1024").length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "Scan" })).toBeDisabled();
    });

    it("validates connect wait and parallel hosts", async () => {
      setupRange();
      await openRangeMode();
      await waitFor(() => expect(screen.getByLabelText("Network")).toHaveValue("192.168.68"));
      fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));
      fireEvent.change(screen.getByLabelText("Connect wait (ms)"), { target: { value: "10" } });
      expect(screen.getAllByText("Connect wait must be 50–5000 ms").length).toBeGreaterThan(0);
      fireEvent.change(screen.getByLabelText("Connect wait (ms)"), { target: { value: "300" } });
      fireEvent.change(screen.getByLabelText("Parallel hosts"), { target: { value: "300" } });
      expect(screen.getByText("Parallel hosts must be 1–256")).toBeInTheDocument();
    });

    it("sends a tcpRange request", async () => {
      setupRange();
      await openRangeMode();
      await waitFor(() => expect(screen.getByLabelText("Network")).toHaveValue("192.168.68"));
      fireEvent.change(screen.getByLabelText("To"), { target: { value: "20" } });
      await startScan();
      const req = (startCalls()[0][1] as { request: ScanRequest }).request;
      expect(req).toMatchObject({
        kind: "tcpRange",
        range: "192.168.68.1-20",
        hostConcurrency: 64,
        connectWaitMs: 300,
        tcp: { host: "", port: 502 },
        concurrency: 4,
        serial: null,
        sweep: null,
      });
    });

    it("accepts a From with a leading zero", async () => {
      setupRange();
      await openRangeMode();
      await waitFor(() => expect(screen.getByLabelText("Network")).toHaveValue("192.168.68"));
      fireEvent.change(screen.getByLabelText("From"), { target: { value: "01" } });
      expect(screen.getByRole("button", { name: "Scan" })).toBeEnabled();
      expect(screen.getByText(/^192\.168\.68\.1 → /)).toBeInTheDocument();
    });

    it("invalid simple input disables Scan", async () => {
      setupRange();
      await openRangeMode();
      await waitFor(() => expect(screen.getByLabelText("Network")).toHaveValue("192.168.68"));
      fireEvent.change(screen.getByLabelText("To"), { target: { value: "255" } });
      expect(screen.getAllByText("From and To must be 1–254").length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "Scan" })).toBeDisabled();
      fireEvent.change(screen.getByLabelText("To"), { target: { value: "20" } });
      fireEvent.change(screen.getByLabelText("From"), { target: { value: "30" } });
      expect(screen.getAllByText("From must not be after To").length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "Scan" })).toBeDisabled();
    });

    it("Use my network restores the defaults", async () => {
      setupRange();
      await openRangeMode();
      await waitFor(() => expect(screen.getByLabelText("Network")).toHaveValue("192.168.68"));
      fireEvent.change(screen.getByLabelText("Network"), { target: { value: "10.0.0" } });
      fireEvent.change(screen.getByLabelText("To"), { target: { value: "9" } });
      fireEvent.click(screen.getByRole("button", { name: "Use my network" }));
      expect(screen.getByLabelText("Network")).toHaveValue("192.168.68");
      expect(screen.getByLabelText("From")).toHaveValue(1);
      expect(screen.getByLabelText("To")).toHaveValue(254);
    });

    it("custom range sends the free text", async () => {
      setupRange();
      await openRangeMode();
      await waitFor(() => expect(screen.getByLabelText("Network")).toHaveValue("192.168.68"));
      expect(screen.queryByLabelText("Range")).toBeNull();
      openCustom();
      const toggle = screen.getByRole("button", { name: "Custom range (CIDR or across subnets)" });
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByLabelText("Network")).toBeDisabled();
      fireEvent.change(screen.getByLabelText("Range"), { target: { value: " 10.0.0.0/22 " } });
      expect(screen.getByText("1022 addresses")).toBeInTheDocument();
      await startScan();
      expect((startCalls()[0][1] as { request: ScanRequest }).request.range).toBe("10.0.0.0/22");
    });

    it("collapsing the custom range sends the simple range", async () => {
      setupRange();
      await openRangeMode();
      await waitFor(() => expect(screen.getByLabelText("Network")).toHaveValue("192.168.68"));
      openCustom();
      fireEvent.change(screen.getByLabelText("Range"), { target: { value: "10.0.0.0/22" } });
      openCustom();
      expect(screen.queryByLabelText("Range")).toBeNull();
      expect(screen.getByLabelText("Network")).toBeEnabled();
      await startScan();
      expect((startCalls()[0][1] as { request: ScanRequest }).request.range).toBe("192.168.68.1-254");
    });

    it("Advanced is collapsed with a summary, expands, and opens itself on an invalid value", async () => {
      setupRange();
      await openRangeMode();
      await waitFor(() => expect(screen.getByLabelText("Network")).toHaveValue("192.168.68"));
      const advanced = screen.getByRole("button", { name: /Advanced/ });
      expect(advanced).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText("Connect wait 300 ms · Parallel hosts 64")).toBeInTheDocument();
      expect(screen.queryByLabelText("Connect wait (ms)")).toBeNull();
      fireEvent.click(advanced);
      expect(advanced).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByLabelText("Connect wait (ms)")).toHaveValue(300);
      expect(screen.getByLabelText("Parallel hosts")).toHaveValue(64);
      fireEvent.change(screen.getByLabelText("Connect wait (ms)"), { target: { value: "10" } });
      fireEvent.click(advanced);
      // Still invalid, so it stays open and the error is visible.
      expect(screen.getByLabelText("Connect wait (ms)")).toBeInTheDocument();
      expect(screen.getAllByText("Connect wait must be 50–5000 ms").length).toBeGreaterThan(0);
    });

    it("defaults to 247 units per host in range mode and restores the single-host default", async () => {
      setupRange();
      renderModal();
      await loaded();
      fireEvent.click(screen.getByRole("radio", { name: "TCP" }));
      expect(screen.getByLabelText("Quantity")).toHaveValue(255);
      fireEvent.click(screen.getByRole("radio", { name: "IP range" }));
      expect(screen.getByLabelText("Start")).toHaveValue(1);
      expect(screen.getByLabelText("Quantity")).toHaveValue(247);
      fireEvent.click(screen.getByRole("radio", { name: "Single host" }));
      expect(screen.getByLabelText("Quantity")).toHaveValue(255);
    });

    it("range mode quantity follows the start within 1-247 while unedited", async () => {
      setupRange();
      renderModal();
      await loaded();
      fireEvent.click(screen.getByRole("radio", { name: "TCP" }));
      fireEvent.click(screen.getByRole("radio", { name: "IP range" }));
      fireEvent.change(screen.getByLabelText("Start"), { target: { value: "10" } });
      expect(screen.getByLabelText("Quantity")).toHaveValue(238);
      fireEvent.change(screen.getByLabelText("Start"), { target: { value: "1" } });
      fireEvent.click(screen.getByRole("radio", { name: "Serial (RTU)" }));
      fireEvent.click(screen.getByRole("radio", { name: "TCP" }));
      expect(screen.getByLabelText("Start")).toHaveValue(1);
      expect(screen.getByLabelText("Quantity")).toHaveValue(247);
    });

    it("keeps an edited quantity when switching modes", async () => {
      setupRange();
      renderModal();
      await loaded();
      fireEvent.click(screen.getByRole("radio", { name: "TCP" }));
      fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "10" } });
      fireEvent.click(screen.getByRole("radio", { name: "IP range" }));
      expect(screen.getByLabelText("Quantity")).toHaveValue(10);
    });

    it("single host mode is unchanged", async () => {
      setupRange();
      renderModal();
      await loaded();
      fireEvent.click(screen.getByRole("radio", { name: "TCP" }));
      expect(screen.getByLabelText("Host")).toBeInTheDocument();
      expect(screen.queryByLabelText("Range")).toBeNull();
      await startScan();
      const req = (startCalls()[0][1] as { request: ScanRequest }).request;
      expect(req.kind).toBe("tcp");
      expect(req.range ?? null).toBeNull();
    });

    describe("results and progress", () => {
      const T3 = "192.168.68.3:502";
      const T7 = "192.168.68.7:502";
      const hostEvent = (scanId: string, host: string, status: string, extra: Record<string, unknown> = {}) => ({
        workspace: WS,
        scanId,
        host,
        status,
        connectMs: 12,
        found: 0,
        gateway: false,
        ...extra,
      });
      const tcpFound = (scanId: string, target: string, unitId: number) =>
        foundEvent(scanId, { target, unitId, settings: null });

      async function startRangeScan(): Promise<string> {
        setupRange();
        await openRangeMode();
        await waitFor(() => expect(screen.getByLabelText("Network")).toHaveValue("192.168.68"));
        return startScan();
      }

      it("groups results by host with status badges and an Add per unit", async () => {
        const scanId = await startRangeScan();
        fire("slave_scan_host", hostEvent(scanId, T3, "open"));
        fire("slave_scan_host", hostEvent(scanId, T7, "open"));
        fire("slave_scan_found", tcpFound(scanId, T3, 1));
        fire("slave_scan_host", hostEvent(scanId, T3, "devices", { found: 1 }));
        fire("slave_scan_host", hostEvent(scanId, T7, "noModbus"));
        expect(screen.getByText("1 device(s)")).toBeInTheDocument();
        expect(screen.getByText("port open, no Modbus reply")).toBeInTheDocument();
        expect(screen.getByRole("region", { name: `Host ${T3}` })).toBeInTheDocument();
        expect(screen.getByLabelText("Unit 1 on " + T3)).toBeInTheDocument();
        expect(within(screen.getByLabelText("Unit 1 on " + T3)).getByRole("button", { name: "Add" })).toBeInTheDocument();
        expect(screen.getByText("Hosts")).toBeInTheDocument();
        expect(screen.getByText("2 / 254")).toBeInTheDocument();
      });

      it("a lost host keeps its device count", async () => {
        const scanId = await startRangeScan();
        fire("slave_scan_host", hostEvent(scanId, T3, "lost", { found: 2 }));
        expect(screen.getByText("connection lost during scan · 2 device(s)")).toBeInTheDocument();
      });

      it("Hosts counter counts addresses tried during stage 1", async () => {
        const scanId = await startRangeScan();
        fire("slave_scan_host", hostEvent(scanId, T3, "open"));
        fire("slave_scan_progress", {
          workspace: WS, scanId, checked: 50, total: 254, phase: "hosts", hostIndex: null, hostCount: null,
          current: { target: "192.168.68.50:502", unitId: 1, settings: null },
        });
        expect(screen.getByText("1 / 50")).toBeInTheDocument();
        fire("slave_scan_done", { workspace: WS, scanId, reason: "completed", checked: 3, found: 0, error: null });
        expect(screen.getByText("1 / 254")).toBeInTheDocument();
      });

      it("each host shows only its own interleaved units", async () => {
        const scanId = await startRangeScan();
        fire("slave_scan_found", tcpFound(scanId, T3, 1));
        fire("slave_scan_found", tcpFound(scanId, T7, 2));
        fire("slave_scan_found", tcpFound(scanId, T3, 3));
        fire("slave_scan_found", tcpFound(scanId, T7, 4));
        fire("slave_scan_host", hostEvent(scanId, T3, "devices", { found: 2 }));
        fire("slave_scan_host", hostEvent(scanId, T7, "devices", { found: 2 }));
        const h3 = within(screen.getByRole("region", { name: `Host ${T3}` }));
        const h7 = within(screen.getByRole("region", { name: `Host ${T7}` }));
        expect(h3.getByLabelText("Unit 1 on " + T3)).toBeInTheDocument();
        expect(h3.getByLabelText("Unit 3 on " + T3)).toBeInTheDocument();
        expect(h3.queryByLabelText("Unit 2 on " + T7)).toBeNull();
        expect(h7.getByLabelText("Unit 2 on " + T7)).toBeInTheDocument();
        expect(h7.getByLabelText("Unit 4 on " + T7)).toBeInTheDocument();
        expect(h7.queryByLabelText("Unit 1 on " + T3)).toBeNull();
      });

      it("Cancel during stage 2 calls cancel_slave_scan once", async () => {
        const scanId = await startRangeScan();
        fire("slave_scan_progress", {
          workspace: WS, scanId, checked: 5, total: 20, phase: "units", hostIndex: 1, hostCount: 2,
          current: { target: T3, unitId: 5, settings: null },
        });
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(cancelCalls()).toEqual([["cancel_slave_scan", { name: WS, scanId }]]));
      });

      it("progress shows both phases", async () => {
        const scanId = await startRangeScan();
        const current = { target: "192.168.68.1:502", unitId: 1, settings: null };
        fire("slave_scan_progress", {
          workspace: WS, scanId, checked: 120, total: 254, phase: "hosts", hostIndex: null, hostCount: null, current,
        });
        expect(screen.getByText("Finding hosts — 120 / 254")).toBeInTheDocument();
        fire("slave_scan_progress", {
          workspace: WS, scanId, checked: 5, total: 20, phase: "units", hostIndex: 2, hostCount: 3,
          current: { ...current, target: T3 },
        });
        expect(screen.getByText(`Scanning unit IDs on ${T3} (host 2 of 3)`)).toBeInTheDocument();
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "5");
      });

      it("answers-all host is collapsed behind show N replies", async () => {
        const scanId = await startRangeScan();
        fire("slave_scan_found", tcpFound(scanId, T3, 1));
        fire("slave_scan_found", tcpFound(scanId, T3, 2));
        fire("slave_scan_host", hostEvent(scanId, T3, "answersAll", { found: 2 }));
        expect(screen.getByText("answers every unit ID")).toBeInTheDocument();
        expect(screen.queryByLabelText("Unit 1 on " + T3)).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "show 2 replies" }));
        expect(screen.getByLabelText("Unit 1 on " + T3)).toBeInTheDocument();
      });

      it("open host after cancelled done shows not scanned (cancelled)", async () => {
        const scanId = await startRangeScan();
        fire("slave_scan_host", hostEvent(scanId, T3, "open"));
        expect(screen.getByText("scanning…")).toBeInTheDocument();
        fire("slave_scan_done", { workspace: WS, scanId, reason: "cancelled", checked: 0, found: 0, error: null });
        expect(screen.getByText("not scanned (cancelled)")).toBeInTheDocument();
        expect(screen.queryByText("scanning…")).toBeNull();
      });

      it("Cancel during stage 1 calls cancel_slave_scan", async () => {
        const scanId = await startRangeScan();
        fire("slave_scan_progress", {
          workspace: WS, scanId, checked: 10, total: 254, phase: "hosts", hostIndex: null, hostCount: null,
          current: { target: "192.168.68.1:502", unitId: 1, settings: null },
        });
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(cancelCalls()).toEqual([["cancel_slave_scan", { name: WS, scanId }]]));
      });

      it("a finished range scan leaves no half progress bar", async () => {
        const scanId = await startRangeScan();
        fire("slave_scan_host", hostEvent(scanId, T3, "answersAll", { found: 1 }));
        fire("slave_scan_done", { workspace: WS, scanId, reason: "completed", checked: 3, found: 1, error: null });
        expect(screen.queryByRole("progressbar")).toBeNull();
        expect(screen.getByText("Scan complete — checked 3, found 1")).toBeInTheDocument();
      });

      it("Add on a range unit row passes a TCP pick that saves the new host", async () => {
        const onAdd = vi.fn();
        setupRange();
        renderModal({ onAdd });
        await loaded();
        fireEvent.click(screen.getByRole("radio", { name: "TCP" }));
        fireEvent.click(screen.getByRole("radio", { name: "IP range" }));
        await waitFor(() => expect(screen.getByLabelText("Network")).toHaveValue("192.168.68"));
        const scanId = await startScan();
        const T128 = "192.168.68.128:502";
        fire("slave_scan_found", tcpFound(scanId, T128, 7));
        fire("slave_scan_host", hostEvent(scanId, T128, "devices", { found: 1 }));
        fireEvent.click(within(screen.getByLabelText("Unit 7 on " + T128)).getByRole("button", { name: "Add" }));
        expect(onAdd).toHaveBeenLastCalledWith({
          unitId: 7,
          connectionKind: "tcp",
          suggestedName: "Slave 7",
          serialToSave: null,
          tcpToSave: { host: "192.168.68.128", port: 502 },
        });
      });

      it("single-host TCP Add: no TCP save on the workspace host, a save on another host", async () => {
        const onAdd = vi.fn();
        setupRange();
        renderModal({ onAdd });
        await loaded();
        fireEvent.click(screen.getByRole("radio", { name: "TCP" }));
        const scanId = await startScan();
        fire("slave_scan_found", tcpFound(scanId, "192.168.1.10:502", 8));
        fire("slave_scan_found", tcpFound(scanId, "192.168.1.99:1502", 9));
        fireEvent.click(within(screen.getByLabelText("Unit 8 on 192.168.1.10:502")).getByRole("button", { name: "Add" }));
        expect(onAdd).toHaveBeenLastCalledWith(expect.objectContaining({ unitId: 8, tcpToSave: null }));
        fireEvent.click(within(screen.getByLabelText("Unit 9 on 192.168.1.99:1502")).getByRole("button", { name: "Add" }));
        expect(onAdd).toHaveBeenLastCalledWith(
          expect.objectContaining({ unitId: 9, tcpToSave: { host: "192.168.1.99", port: 1502 } }),
        );
      });

      it("same unit ID on another host is not 'already in workspace'", async () => {
        setupRange();
        render(
          <SlaveScannerModal
            open
            workspaceName={WS}
            existingSlaves={[{ unitId: 8, connectionKind: "tcp", name: "Slave 8" }]}
            onClose={vi.fn()}
            onAdd={vi.fn()}
          />,
        );
        await loaded();
        fireEvent.click(screen.getByRole("radio", { name: "TCP" }));
        const scanId = await startScan();
        fire("slave_scan_found", tcpFound(scanId, "192.168.1.10:502", 8));
        fire("slave_scan_found", tcpFound(scanId, "192.168.1.99:502", 8));
        expect(within(screen.getByLabelText("Unit 8 on 192.168.1.10:502")).getByText("already in workspace")).toBeInTheDocument();
        expect(within(screen.getByLabelText("Unit 8 on 192.168.1.99:502")).getByRole("button", { name: "Add" })).toBeInTheDocument();
      });

      it("single-host mode keeps ScanResultsList with Add", async () => {
        setupRange();
        renderModal();
        await loaded();
        fireEvent.click(screen.getByRole("radio", { name: "TCP" }));
        const scanId = await startScan();
        fire("slave_scan_found", tcpFound(scanId, "192.168.1.10:502", 5));
        expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
        expect(screen.queryByText("Hosts")).toBeNull();
      });
    });
  });
});
