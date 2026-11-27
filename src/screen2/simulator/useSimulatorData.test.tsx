import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
const listeners: Record<string, (e: any) => void> = {};
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: any[]) => invokeMock(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (name: string, cb: any) => { listeners[name] = cb; return Promise.resolve(() => {}); } }));

import { useSimulatorData } from "./useSimulatorData";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "simulator_get_config": return Promise.resolve({ enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 });
      case "simulator_list_registers": return Promise.resolve([{ id: 1, unitId: 1, functionCode: 3, address: 5, alias: "T", dataType: "u16", holdValue: 0, sortOrder: 0, valueSource: "hold", byteOrder: "ABCD", sourceParams: "{}", intervalMs: 1000, deviceInstanceId: null }]);
      case "simulator_list_rules": return Promise.resolve([]);
      case "simulator_status": return Promise.resolve({ running: false, listen: null, clientCount: 0 });
      case "simulator_list_device_templates": return Promise.resolve([]);
      case "simulator_list_devices": return Promise.resolve([]);
      default: return Promise.resolve(null);
    }
  });
});

describe("useSimulatorData", () => {
  it("reload aggregates all sources", async () => {
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(result.current.registers).toHaveLength(1));
    expect(result.current.config?.port).toBe(502);
  });

  it("sets lastUpdated after reload", async () => {
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(result.current.lastUpdated).not.toBeNull());
  });

  const row = (address: number, valueWord: number) => ({ unitId: 1, functionCode: 3, address, valueWord, valueBit: null });

  it("requests a full snapshot after subscribing", async () => {
    renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("simulator_request_full", { name: "ws" }));
  });

  it("applies full and delta events", async () => {
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(listeners["simulator_values"]).toBeTypeOf("function"));
    act(() => listeners["simulator_values"]({ payload: { workspace: "ws", full: true, rows: [row(5, 42), row(6, 1)] } }));
    expect(result.current.live.get(1, 3, 5)?.valueWord).toBe(42);
    act(() => listeners["simulator_values"]({ payload: { workspace: "ws", full: false, rows: [row(6, 9)] } }));
    expect(result.current.live.get(1, 3, 5)?.valueWord).toBe(42);
    expect(result.current.live.get(1, 3, 6)?.valueWord).toBe(9);
    expect(result.current.live.get(9, 9, 9)).toBeUndefined();
  });

  it("ignores events for other workspaces", async () => {
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(listeners["simulator_values"]).toBeTypeOf("function"));
    act(() => listeners["simulator_values"]({ payload: { workspace: "other", full: true, rows: [row(5, 42)] } }));
    expect(result.current.live.get(1, 3, 5)).toBeUndefined();
  });

  it("clears live values on stop", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "simulator_get_config": return Promise.resolve({ enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 });
        case "simulator_list_registers": return Promise.resolve([]);
        case "simulator_list_rules": return Promise.resolve([]);
        case "simulator_status": return Promise.resolve({ running: true, listen: null, clientCount: 0 });
        case "simulator_list_device_templates": return Promise.resolve([]);
        case "simulator_list_devices": return Promise.resolve([]);
        default: return Promise.resolve(null);
      }
    });
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(result.current.status.running).toBe(true));
    act(() => listeners["simulator_values"]({ payload: { workspace: "ws", full: true, rows: [row(5, 42)] } }));
    expect(result.current.live.get(1, 3, 5)?.valueWord).toBe(42);
    await act(async () => { await result.current.stop(); });
    expect(result.current.status.running).toBe(false);
    expect(result.current.live.get(1, 3, 5)).toBeUndefined();
  });

  it("duplicateRegister clones with id:0, a (copy) alias, and the next free address, then reloads", async () => {
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(result.current.registers).toHaveLength(1));
    invokeMock.mockClear();
    await act(async () => {
      await result.current.duplicateRegister(result.current.registers[0]);
    });
    // original is a u16 at address 5 → clone must not reuse 5 (UNIQUE constraint);
    // next free on the same unit+fc is 6, and it is created standalone.
    expect(invokeMock).toHaveBeenCalledWith(
      "simulator_add_register",
      expect.objectContaining({
        name: "ws",
        register: expect.objectContaining({ id: 0, alias: "T (copy)", address: 6, deviceInstanceId: null }),
      })
    );
    expect(invokeMock).toHaveBeenCalledWith("simulator_list_registers", { name: "ws" });
  });

  it("duplicateRegister skips addresses already taken on the same unit+function", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "simulator_get_config": return Promise.resolve({ enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 });
        case "simulator_list_registers": return Promise.resolve([
          { id: 1, unitId: 1, functionCode: 3, address: 5, alias: "T", dataType: "u16", holdValue: 0, sortOrder: 0, valueSource: "hold", byteOrder: "ABCD", sourceParams: "{}", intervalMs: 1000, deviceInstanceId: null },
          { id: 2, unitId: 1, functionCode: 3, address: 6, alias: "U", dataType: "u16", holdValue: 0, sortOrder: 0, valueSource: "hold", byteOrder: "ABCD", sourceParams: "{}", intervalMs: 1000, deviceInstanceId: null },
        ]);
        case "simulator_list_rules": return Promise.resolve([]);
        case "simulator_status": return Promise.resolve({ running: false, listen: null, clientCount: 0 });
        case "simulator_list_device_templates": return Promise.resolve([]);
        case "simulator_list_devices": return Promise.resolve([]);
        default: return Promise.resolve(null);
      }
    });
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(result.current.registers).toHaveLength(2));
    invokeMock.mockClear();
    await act(async () => { await result.current.duplicateRegister(result.current.registers[0]); });
    // 5+1=6 is taken → clone lands on 7
    expect(invokeMock).toHaveBeenCalledWith(
      "simulator_add_register",
      expect.objectContaining({ register: expect.objectContaining({ address: 7 }) })
    );
  });

  it("start does not fetch simulator_snapshot", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "simulator_get_config": return Promise.resolve({ enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 });
        case "simulator_list_registers": return Promise.resolve([]);
        case "simulator_list_rules": return Promise.resolve([]);
        case "simulator_status": return Promise.resolve({ running: false, listen: null, clientCount: 0 });
        case "simulator_list_device_templates": return Promise.resolve([]);
        case "simulator_list_devices": return Promise.resolve([]);
        case "simulator_start": return Promise.resolve({ running: true, listen: { bound: "0.0.0.0", port: 502, addresses: ["127.0.0.1:502"] }, clientCount: 0 });
        case "simulator_snapshot": return Promise.resolve([{ unitId: 1, functionCode: 3, address: 5, valueWord: 7, valueBit: null }]);
        default: return Promise.resolve(null);
      }
    });
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(result.current.lastUpdated).not.toBeNull());
    await act(async () => { await result.current.start(); });
    expect(result.current.status.running).toBe(true);
    expect(invokeMock).not.toHaveBeenCalledWith("simulator_snapshot", expect.anything());
  });

  it("setError sets the error message", async () => {
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(result.current.lastUpdated).not.toBeNull());
    act(() => result.current.setError("boom"));
    expect(result.current.error).toBe("boom");
  });

  it("addRegister/addRule/addDevice resolve true on success and false (setting error) on failure", async () => {
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(result.current.lastUpdated).not.toBeNull());
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.addRegister({} as never); });
    expect(ok).toBe(true);
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "simulator_add_register" || cmd === "simulator_add_rule" || cmd === "simulator_add_device"
        ? Promise.reject("nope") : Promise.resolve(null));
    await act(async () => { ok = await result.current.addRegister({} as never); });
    expect(ok).toBe(false);
    expect(result.current.error).toContain("nope");
    await act(async () => { ok = await result.current.addRule({} as never); });
    expect(ok).toBe(false);
    await act(async () => { ok = await result.current.addDevice({ templateKey: "t", deviceName: "d", unitId: 1, baseAddress: 0 }); });
    expect(ok).toBe(false);
  });

  it("saveConfig resolves false and restores the saved config when the backend rejects it (M4)", async () => {
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(result.current.config?.port).toBe(502));
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "simulator_set_config" ? Promise.reject("port in use") : Promise.resolve(null));
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.saveConfig({ port: 5020 }); });
    expect(ok).toBe(false);
    expect(result.current.config?.port).toBe(502);
    expect(result.current.error).toContain("port in use");
    invokeMock.mockImplementation(() => Promise.resolve(null));
    await act(async () => { ok = await result.current.saveConfig({ port: 5020 }); });
    expect(ok).toBe(true);
    expect(result.current.config?.port).toBe(5020);
  });
});
