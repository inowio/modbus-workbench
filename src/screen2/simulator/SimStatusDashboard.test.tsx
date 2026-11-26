import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import SimStatusDashboard from "./SimStatusDashboard";

const base = { config: { enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 }, status: { running: false, listen: null, clientCount: 0 }, listen: null, busy: false, onStart: vi.fn(), onStop: vi.fn(), onSaveConfig: vi.fn(), onChangeExpose: vi.fn(), onChangePort: vi.fn(), onRefresh: vi.fn(), registerCount: 0, unitCount: 0, deviceCount: 0 };

describe("SimStatusDashboard", () => {
  it("shows Start when stopped and calls onStart", () => {
    render(<SimStatusDashboard {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    expect(base.onStart).toHaveBeenCalled();
  });

  it("calls onRefresh when the Refresh button is clicked", () => {
    const onRefresh = vi.fn();
    render(<SimStatusDashboard {...base} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("shows client count and resolved address when running", () => {
    render(<SimStatusDashboard {...base} status={{ running: true, listen: { bound: "0.0.0.0", port: 502, addresses: ["192.168.1.10:502", "10.0.0.5:502"] }, clientCount: 2 }} listen={{ bound: "0.0.0.0", port: 502, addresses: ["192.168.1.10:502", "10.0.0.5:502"] }} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/192\.168\.1\.10:502/)).toBeInTheDocument();
    expect(screen.getByText(/and 1 more/i)).toBeInTheDocument();
  });

  describe("Port and Tick drafts", () => {
    it("does not save per keystroke; saves a valid port on blur", () => {
      const onChangePort = vi.fn();
      render(<SimStatusDashboard {...base} onChangePort={onChangePort} />);
      const port = screen.getByLabelText("Port");
      fireEvent.change(port, { target: { value: "5" } });
      fireEvent.change(port, { target: { value: "50" } });
      fireEvent.change(port, { target: { value: "5020" } });
      expect(onChangePort).not.toHaveBeenCalled();
      fireEvent.blur(port);
      expect(onChangePort).toHaveBeenCalledTimes(1);
      expect(onChangePort).toHaveBeenCalledWith(5020);
    });

    it("saves on Enter", () => {
      const onChangePort = vi.fn();
      render(<SimStatusDashboard {...base} onChangePort={onChangePort} />);
      const port = screen.getByLabelText("Port");
      fireEvent.change(port, { target: { value: "1502" } });
      fireEvent.keyDown(port, { key: "Enter" });
      expect(onChangePort).toHaveBeenCalledWith(1502);
    });

    it("rejects an out-of-range port with a message and does not save", () => {
      const onChangePort = vi.fn();
      render(<SimStatusDashboard {...base} onChangePort={onChangePort} />);
      const port = screen.getByLabelText("Port");
      fireEvent.change(port, { target: { value: "70000" } });
      fireEvent.blur(port);
      expect(onChangePort).not.toHaveBeenCalled();
      expect(port).toHaveAttribute("aria-invalid", "true");
      expect(port.className).toMatch(/rose/);
      expect(screen.getByText(/1.65535/)).toBeInTheDocument();
    });

    it("reverts the draft on Escape", () => {
      render(<SimStatusDashboard {...base} />);
      const port = screen.getByLabelText("Port") as HTMLInputElement;
      fireEvent.change(port, { target: { value: "70000" } });
      fireEvent.keyDown(port, { key: "Escape" });
      expect(port.value).toBe("502");
      expect(port).not.toHaveAttribute("aria-invalid", "true");
    });

    it("validates tick 10-60000 and saves valid values on blur", () => {
      const onSaveConfig = vi.fn();
      render(<SimStatusDashboard {...base} onSaveConfig={onSaveConfig} />);
      const tick = screen.getByLabelText("Tick interval (ms)");
      fireEvent.change(tick, { target: { value: "5" } });
      fireEvent.blur(tick);
      expect(onSaveConfig).not.toHaveBeenCalled();
      expect(screen.getByText(/10.60000/)).toBeInTheDocument();
      fireEvent.change(tick, { target: { value: "250" } });
      fireEvent.blur(tick);
      expect(onSaveConfig).toHaveBeenCalledWith({ tickMs: 250 });
    });

    it("does not re-save an unchanged value", () => {
      const onChangePort = vi.fn();
      render(<SimStatusDashboard {...base} onChangePort={onChangePort} />);
      fireEvent.blur(screen.getByLabelText("Port"));
      expect(onChangePort).not.toHaveBeenCalled();
    });

    it("reverts the draft to the saved value when the backend rejects the commit (M4)", async () => {
      const onChangePort = vi.fn(() => Promise.resolve(false));
      render(<SimStatusDashboard {...base} onChangePort={onChangePort} />);
      const port = screen.getByLabelText("Port") as HTMLInputElement;
      fireEvent.change(port, { target: { value: "5020" } });
      fireEvent.blur(port);
      expect(onChangePort).toHaveBeenCalledWith(5020);
      await waitFor(() => expect(port.value).toBe("502"));
    });

    it("keeps the committed draft when the save succeeds (M4)", async () => {
      const onSaveConfig = vi.fn(() => Promise.resolve(true));
      render(<SimStatusDashboard {...base} onSaveConfig={onSaveConfig} />);
      const tick = screen.getByLabelText("Tick interval (ms)") as HTMLInputElement;
      fireEvent.change(tick, { target: { value: "250" } });
      fireEvent.blur(tick);
      await Promise.resolve();
      expect(onSaveConfig).toHaveBeenCalledWith({ tickMs: 250 });
      expect(tick.value).toBe("250");
    });

    it("shows no validation error before the config has loaded (M4)", () => {
      render(<SimStatusDashboard {...base} config={null} />);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByLabelText("Tick interval (ms)")).not.toHaveAttribute("aria-invalid");
      expect(screen.getByLabelText("Port")).not.toHaveAttribute("aria-invalid");
    });
  });
});
