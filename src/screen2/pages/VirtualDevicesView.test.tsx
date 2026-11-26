import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import VirtualDevicesView from "./VirtualDevicesView";

const tmpl = (templateKey: string, name: string, category = "Custom", description = "") => ({
  templateKey, name, category, description, icon: "📟", registers: [],
});

describe("VirtualDevicesView", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "simulator_list_device_templates")
        return Promise.resolve([tmpl("temp_humidity", "Temp Humidity", "Sensor"), tmpl("custom_pump", "Pump Meter")]);
      if (cmd === "simulator_list_custom_templates") return Promise.resolve([tmpl("custom_pump", "Pump Meter")]);
      return Promise.resolve(null);
    });
  });

  it("shows built-in and custom devices split into sections", async () => {
    render(<VirtualDevicesView search="" />);
    expect(await screen.findByText("Pump Meter")).toBeInTheDocument();
    expect(screen.getByText("Temp Humidity")).toBeInTheDocument();
  });

  it("filters both sections by the search prop", async () => {
    const { rerender } = render(<VirtualDevicesView search="" />);
    await screen.findByText("Pump Meter");
    rerender(<VirtualDevicesView search="pump" />);
    await waitFor(() => expect(screen.queryByText("Temp Humidity")).not.toBeInTheDocument());
    expect(screen.getByText("Pump Meter")).toBeInTheDocument();
    expect(screen.getByText(/no built-in devices match/i)).toBeInTheDocument();
  });

  it("Clone & edit opens a NEW device with an editable, prefilled unique key", async () => {
    render(<VirtualDevicesView search="" />);
    await screen.findByText("Temp Humidity");
    fireEvent.click(screen.getByRole("button", { name: /clone & edit/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("New virtual device")).toBeInTheDocument();
    const key = within(dialog).getByLabelText("Template key") as HTMLInputElement;
    expect(key.value).toBe("custom_temp_humidity");
    expect(key).not.toBeDisabled();
  });

  it("Clone & edit picks the next free key when an earlier clone exists", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "simulator_list_device_templates")
        return Promise.resolve([tmpl("temp_humidity", "Temp Humidity", "Sensor"), tmpl("custom_temp_humidity", "Temp Humidity (copy)"), tmpl("custom_temp_humidity_2", "Temp Humidity (copy)")]);
      if (cmd === "simulator_list_custom_templates")
        return Promise.resolve([tmpl("custom_temp_humidity", "Temp Humidity (copy)"), tmpl("custom_temp_humidity_2", "Temp Humidity (copy)")]);
      return Promise.resolve(null);
    });
    render(<VirtualDevicesView search="" />);
    fireEvent.click(await screen.findByRole("button", { name: /clone & edit/i }));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText("Template key") as HTMLInputElement).value).toBe("custom_temp_humidity_3");
  });

  it("shows a banner with the backend error instead of an empty state when listing fails", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "simulator_list_custom_templates" ? Promise.reject("custom templates file is corrupt; backed up") : Promise.resolve([]));
    render(<VirtualDevicesView search="" />);
    expect(await screen.findByText(/custom templates file is corrupt/i)).toBeInTheDocument();
    expect(screen.queryByText(/no custom devices yet/i)).toBeNull();
  });

  it("still lists built-ins (with the error banner) when only the custom list fails (M3)", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "simulator_list_device_templates") return Promise.resolve([tmpl("temp_humidity", "Temp Humidity", "Sensor")]);
      if (cmd === "simulator_list_custom_templates") return Promise.reject("custom templates file is corrupt; backed up");
      return Promise.resolve(null);
    });
    render(<VirtualDevicesView search="" />);
    expect(await screen.findByText(/custom templates file is corrupt/i)).toBeInTheDocument();
    expect(await screen.findByText("Temp Humidity")).toBeInTheDocument();
    expect(screen.queryByText(/no built-in devices match/i)).toBeNull();
  });

  it("preserves unit/displayFormat/intervalMs/holdValue on a template register when saving from the editor", async () => {
    const rich = { ...tmpl("custom_rich", "Rich"), registers: [{ offset: 0, bank: 3, dataType: "u16", byteOrder: "ABCD", valueSource: "hold", sourceParams: "{}", alias: "T", unit: "°C", displayFormat: "dec2", intervalMs: 250, holdValue: 7 }] };
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "simulator_list_device_templates") return Promise.resolve([rich]);
      if (cmd === "simulator_list_custom_templates") return Promise.resolve([rich]);
      return Promise.resolve(null);
    });
    render(<VirtualDevicesView search="" />);
    fireEvent.click(await screen.findByRole("button", { name: /^edit/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^save/i }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("simulator_save_custom_template", expect.anything()));
    const call = invokeMock.mock.calls.find((c) => c[0] === "simulator_save_custom_template")!;
    expect(call[1].template.registers[0]).toMatchObject({ unit: "°C", displayFormat: "dec2", intervalMs: 250, holdValue: 7 });
  });
});
