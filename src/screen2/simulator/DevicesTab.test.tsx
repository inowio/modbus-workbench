import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import DevicesTab from "./DevicesTab";

const dev = { id: 7, templateKey: "temp_humidity", name: "Temp Sensor A", unitId: 1, baseAddress: 40001, sortOrder: 0 };
const base = () => ({
  devices: [dev],
  registers: [
    { id: 1, deviceInstanceId: 7, unitId: 1, functionCode: 3, address: 257, dataType: "u16" } as any,
    { id: 2, deviceInstanceId: 7, unitId: 1, functionCode: 3, address: 258, dataType: "u16" } as any,
    { id: 3, deviceInstanceId: 7, unitId: 1, functionCode: 4, address: 1, dataType: "f32" } as any,
  ],
  templates: [{ templateKey: "temp_humidity", name: "Temp & Humidity", category: "Sensors", description: "", icon: "🌡", registers: [] }],
  addrFmt: "dec" as const,
  onAddDevice: vi.fn(),
  onRename: vi.fn(),
  onRebase: vi.fn(),
  onDelete: vi.fn(),
  onSaveAsTemplate: vi.fn(),
});

describe("DevicesTab", () => {
  it("renders a device card with register count", () => {
    render(<DevicesTab {...base()} />);
    expect(screen.getByText("Temp Sensor A")).toBeInTheDocument();
    expect(screen.getByText(/3 registers/i)).toBeInTheDocument();
  });
  it("shows the template display name instead of the raw key (S3)", () => {
    render(<DevicesTab {...base()} />);
    expect(screen.getByText("Temp & Humidity")).toBeInTheDocument();
    expect(screen.queryByText("temp_humidity")).toBeNull();
  });
  it("shows the unit with the real address range per bank, Dec or Hex (S3)", () => {
    const { rerender } = render(<DevicesTab {...base()} />);
    expect(screen.getByText("Unit 1 · Holding 257–258 · Input 1–2 · Base 40001")).toBeInTheDocument();
    rerender(<DevicesTab {...base()} addrFmt="hex" />);
    expect(screen.getByText("Unit 1 · Holding 0x0101–0x0102 · Input 0x0001–0x0002 · Base 0x9C41")).toBeInTheDocument();
  });
  it("omits Base for workspace-routed devices (S3)", () => {
    const p = base();
    p.devices = [{ ...dev, templateKey: "ws-slave:abc" }];
    render(<DevicesTab {...p} />);
    expect(screen.getByText(/^Unit 1 · Holding/)).toBeInTheDocument();
    expect(screen.queryByText(/Base/)).toBeNull();
  });
  it("uses a custom template's icon (S3)", () => {
    const p = base();
    p.templates = [{ ...p.templates[0], icon: "🔥" }];
    render(<DevicesTab {...p} />);
    expect(screen.getByText("🔥")).toBeInTheDocument();
  });
  it("empty state offers Add Device", () => {
    const p = { ...base(), devices: [] };
    render(<DevicesTab {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /add device/i }));
    expect(p.onAddDevice).toHaveBeenCalled();
  });
});
