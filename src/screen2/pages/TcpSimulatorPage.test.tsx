import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const listenMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...a: unknown[]) => listenMock(...a) }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useOutletContext: () => ({ workspace: { name: "WS1" } }) };
});

import TcpSimulatorPage from "./TcpSimulatorPage";
import { ToastProvider } from "../../components/ToastProvider";

const renderPage = () => render(<ToastProvider><TcpSimulatorPage /></ToastProvider>);

const device = { id: 1, templateKey: "temp-humidity", name: "Roof Sensor", unitId: 1, baseAddress: 100, sortOrder: 0 };
const reg = { id: 1, unitId: 1, functionCode: 3, address: 100, alias: "temp", dataType: "u16", holdValue: 0, sortOrder: 0, valueSource: "hold", byteOrder: "ABCD", sourceParams: "{}", intervalMs: 1000, deviceInstanceId: 1 };

describe("TcpSimulatorPage (tabbed shell)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    window.localStorage.clear();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "simulator_get_config") return Promise.resolve({ enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 });
      if (cmd === "simulator_list_registers") return Promise.resolve([reg]);
      if (cmd === "simulator_list_devices") return Promise.resolve([device]);
      if (cmd === "simulator_list_rules") return Promise.resolve([]);
      if (cmd === "simulator_list_device_templates") return Promise.resolve([]);
      if (cmd === "simulator_status") return Promise.resolve({ running: false, listen: null, clientCount: 0 });
      return Promise.resolve(null);
    });
    listenMock.mockResolvedValue(() => {});
  });

  it("loads config and shows the Start control + tab bar", async () => {
    renderPage();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("simulator_get_config", { name: "WS1" }));
    expect(await screen.findByRole("button", { name: /start/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /registers/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /devices/i })).toBeTruthy();
  });

  it("subscribes to the simulator_values event for live values", async () => {
    renderPage();
    await waitFor(() => expect(listenMock).toHaveBeenCalledWith("simulator_values", expect.any(Function)));
  });

  it("shows the register on the default Registers tab", async () => {
    renderPage();
    expect(await screen.findByText("temp")).toBeTruthy();
  });

  it("switches to the Devices tab and shows the device", async () => {
    renderPage();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("simulator_list_devices", { name: "WS1" }));
    fireEvent.click(screen.getByRole("tab", { name: /devices/i }));
    expect(await screen.findByText("Roof Sensor")).toBeTruthy();
  });

  it("switches to the Rules tab and shows Add Rule", async () => {
    renderPage();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("simulator_list_rules", { name: "WS1" }));
    fireEvent.click(screen.getByRole("tab", { name: /rules/i }));
    expect(await screen.findByRole("button", { name: /add rule/i })).toBeTruthy();
  });

  it("opens the inspector when a register row is selected", async () => {
    renderPage();
    const row = await screen.findByText("temp");
    fireEvent.click(row);
    // Inspector shows the alias as a heading and a Save button
    expect(await screen.findByRole("button", { name: /save/i })).toBeTruthy();
  });

  it("makes the inspector panel sticky on wide layouts so its actions stay on screen", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("temp"));
    const save = await screen.findByRole("button", { name: /^save$/i });
    const wrapper = save.parentElement!.parentElement!.parentElement as HTMLElement;
    expect(wrapper.className).toMatch(/lg:sticky/);
    expect(wrapper.className).toMatch(/lg:top-0/);
    expect(wrapper.className).toMatch(/lg:inset-auto/); // cancels the drawer's inset-y-0 / right-0
  });

  it("opens the inspector as a right-side drawer below lg, closable from the backdrop (S9)", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("temp"));
    const save = await screen.findByRole("button", { name: /^save$/i });
    const wrapper = save.parentElement!.parentElement!.parentElement as HTMLElement;
    expect(wrapper.className).toMatch(/fixed/);
    expect(wrapper.className).toMatch(/inset-y-0/);
    expect(wrapper.className).toMatch(/right-0/);
    expect(wrapper.className).toMatch(/max-w-md/);
    expect(wrapper.className).toMatch(/lg:static/);
    fireEvent.click(screen.getByTestId("inspector-backdrop"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull());
  });

  it("highlights the selected row and closes the inspector on Escape (S5/S6)", async () => {
    renderPage();
    const row = (await screen.findByText("temp")).closest("tr") as HTMLElement;
    expect(row).not.toHaveAttribute("aria-current");
    fireEvent.click(row);
    await screen.findByRole("button", { name: /^save$/i });
    expect(row).toHaveAttribute("aria-current", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull());
  });

  it("moves focus into the drawer when it opens below lg (M3)", async () => {
    const mm = vi.fn((q: string) => ({ matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal("matchMedia", mm);
    window.matchMedia = mm as unknown as typeof window.matchMedia;
    try {
      renderPage();
      fireEvent.click(await screen.findByText("temp"));
      const close = await screen.findByRole("button", { name: "Close" });
      await waitFor(() => expect(close).toHaveFocus());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("names the register in the discard prompt using the Hex address format and on tab change (M4)", async () => {
    window.localStorage.setItem("inowio.addressFormat", "hex");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "simulator_get_config") return Promise.resolve({ enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 });
      if (cmd === "simulator_list_registers") return Promise.resolve([{ ...reg, alias: "", address: 255 }]);
      if (cmd === "simulator_list_devices") return Promise.resolve([device]);
      if (cmd === "simulator_status") return Promise.resolve({ running: false, listen: null, clientCount: 0 });
      return Promise.resolve([]);
    });
    renderPage();
    fireEvent.click(await screen.findByText("0x00FF"));
    fireEvent.change(await screen.findByLabelText("Unit"), { target: { value: "V" } });
    fireEvent.click(screen.getByRole("tab", { name: /devices/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/Discard changes to unit 1 address 0x00FF\?/);
  });

  it("asks before discarding unsaved inspector edits when selecting another row (S5)", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "simulator_get_config") return Promise.resolve({ enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 });
      if (cmd === "simulator_list_registers") return Promise.resolve([reg, { ...reg, id: 2, address: 101, alias: "other" }]);
      if (cmd === "simulator_list_devices") return Promise.resolve([device]);
      if (cmd === "simulator_list_rules") return Promise.resolve([]);
      if (cmd === "simulator_list_device_templates") return Promise.resolve([]);
      if (cmd === "simulator_status") return Promise.resolve({ running: false, listen: null, clientCount: 0 });
      return Promise.resolve(null);
    });
    renderPage();
    fireEvent.click(await screen.findByText("temp"));
    fireEvent.change(await screen.findByDisplayValue("temp"), { target: { value: "temp edited" } });
    fireEvent.click(screen.getByText("other"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/Discard changes to temp\?/);
    fireEvent.click(within(dialog).getByRole("button", { name: /keep editing/i }));
    expect(screen.getByDisplayValue("temp edited")).toBeTruthy();
    fireEvent.click(screen.getByText("other"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /^discard$/i }));
    expect(await screen.findByDisplayValue("other")).toBeTruthy();
  });
});

describe("TcpSimulatorPage dialogs keep open on failed saves", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    window.localStorage.clear();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "simulator_get_config") return Promise.resolve({ enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 });
      if (cmd === "simulator_list_registers") return Promise.resolve([reg]);
      if (cmd === "simulator_list_devices") return Promise.resolve([device]);
      if (cmd === "simulator_list_rules") return Promise.resolve([]);
      if (cmd === "simulator_list_device_templates") return Promise.resolve([]);
      if (cmd === "simulator_status") return Promise.resolve({ running: false, listen: null, clientCount: 0 });
      if (cmd === "simulator_add_register") return Promise.reject("UNIQUE constraint failed: sim_registers");
      if (cmd === "simulator_add_rule") return Promise.reject("rule is invalid");
      return Promise.resolve(null);
    });
    listenMock.mockResolvedValue(() => {});
  });

  it("keeps the new-register panel open and shows the error when the create fails", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /add register/i }));
    expect(await screen.findByText("New register")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Alias") as HTMLInputElement, { target: { value: "My reg" } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/already exists/i);
    expect(screen.getByText("New register")).toBeTruthy();
    expect((screen.getByLabelText("Alias") as HTMLInputElement).value).toBe("My reg");
    expect((screen.getByLabelText("Address") as HTMLInputElement).value).toBe("7");
  });

  it("routes unrelated page errors (failed Start) to the page banner, not the open draft (M10)", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "simulator_get_config") return Promise.resolve({ enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 });
      if (cmd === "simulator_list_registers") return Promise.resolve([reg]);
      if (cmd === "simulator_list_devices") return Promise.resolve([device]);
      if (cmd === "simulator_status") return Promise.resolve({ running: false, listen: null, clientCount: 0 });
      if (cmd === "simulator_start") return Promise.reject("boom start failed");
      return Promise.resolve([]);
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /add register/i }));
    await screen.findByText("New register");
    fireEvent.click(screen.getByRole("button", { name: /^start/i }));
    const dismiss = await screen.findByRole("button", { name: "Dismiss error" });
    expect(dismiss.parentElement!.textContent).toMatch(/boom start failed/);
    // Draft panel has no alert of its own.
    expect(screen.getByText("New register").closest("div[class*='rounded-2xl']")!.querySelector("[role='alert']")).toBeNull();
  });

  it("never flashes an 'already used' alert for the register it just created (M6)", async () => {
    let registers = [reg];
    invokeMock.mockImplementation((cmd: string, args?: any) => {
      if (cmd === "simulator_get_config") return Promise.resolve({ enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 });
      if (cmd === "simulator_list_registers") return Promise.resolve(registers);
      if (cmd === "simulator_list_devices") return Promise.resolve([device]);
      if (cmd === "simulator_status") return Promise.resolve({ running: false, listen: null, clientCount: 0 });
      if (cmd === "simulator_add_register") { registers = [...registers, { ...args.register, id: 9 }]; return Promise.resolve(9); }
      return Promise.resolve([]);
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /add register/i }));
    fireEvent.change(await screen.findByLabelText("Alias"), { target: { value: "Fresh" } });
    let sawConflict = false;
    const obs = new MutationObserver(() => { if (/already used/i.test(document.body.textContent ?? "")) sawConflict = true; });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await screen.findByRole("button", { name: /^save$/i });
    obs.disconnect();
    expect(sawConflict).toBe(false);
  });

  it("switches the panel to editing the new register after a successful create", async () => {
    let registers = [reg];
    invokeMock.mockImplementation((cmd: string, args?: any) => {
      if (cmd === "simulator_get_config") return Promise.resolve({ enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 });
      if (cmd === "simulator_list_registers") return Promise.resolve(registers);
      if (cmd === "simulator_list_devices") return Promise.resolve([device]);
      if (cmd === "simulator_list_rules") return Promise.resolve([]);
      if (cmd === "simulator_status") return Promise.resolve({ running: false, listen: null, clientCount: 0 });
      if (cmd === "simulator_add_register") { registers = [...registers, { ...args.register, id: 9 }]; return Promise.resolve(9); }
      return Promise.resolve(null);
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /add register/i }));
    fireEvent.change(await screen.findByLabelText("Alias"), { target: { value: "Fresh" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    expect(await screen.findByRole("button", { name: /^save$/i })).toBeTruthy();
    expect(screen.queryByText("New register")).toBeNull();
    expect(screen.getByDisplayValue("Fresh")).toBeTruthy();
  });

  it("keeps the rule dialog open and shows the error when the save fails", async () => {
    renderPage();
    await screen.findByText("temp");
    fireEvent.click(screen.getByRole("tab", { name: /rules/i }));
    fireEvent.click(await screen.findByRole("button", { name: /add rule/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/rule name/i), { target: { value: "r1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /add action/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toMatch(/rule is invalid/i);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
