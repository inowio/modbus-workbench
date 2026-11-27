import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionSettingsForm, refreshSerialPortList } from "./ConnectionSettingsForm";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function renderForm(onRefreshSerialPorts: () => void | Promise<void>) {
  render(
    <ConnectionSettingsForm
      value={{ kind: "serial", serialPort: "COM3" }}
      onChange={vi.fn()}
      serialPortOptions={[{ port: "COM3", label: "COM3" }]}
      onRefreshSerialPorts={onRefreshSerialPorts}
    />,
  );
}

describe("ConnectionSettingsForm serial port refresh", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("says why when listing the serial ports fails", async () => {
    renderForm(() => Promise.reject("Access is denied"));

    fireEvent.click(screen.getByRole("button", { name: "Refresh serial ports" }));

    expect(await screen.findByText("Could not list serial ports: Access is denied")).toBeInTheDocument();
  });

  it("clears the message once a refresh works", async () => {
    let fail = true;
    renderForm(() => (fail ? Promise.reject("Access is denied") : Promise.resolve()));
    fireEvent.click(screen.getByRole("button", { name: "Refresh serial ports" }));
    await screen.findByText(/Could not list serial ports/);

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Refresh serial ports" }));

    await waitFor(() => expect(screen.queryByText(/Could not list serial ports/)).not.toBeInTheDocument());
  });
});

describe("refreshSerialPortList", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("stores the listed ports", async () => {
    invokeMock.mockResolvedValue([{ port: "COM5", label: "COM5" }]);
    const setPorts = vi.fn();

    await refreshSerialPortList(setPorts);

    expect(invokeMock).toHaveBeenCalledWith("list_serial_ports");
    expect(setPorts).toHaveBeenCalledWith([{ port: "COM5", label: "COM5" }]);
  });

  it("empties the list and passes the error on when listing fails", async () => {
    invokeMock.mockRejectedValue("Access is denied");
    const setPorts = vi.fn();

    await expect(refreshSerialPortList(setPorts)).rejects.toBe("Access is denied");
    expect(setPorts).toHaveBeenCalledWith([]);
  });
});
