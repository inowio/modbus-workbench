import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useOutletContext: () => ({ workspace: { name: "WS1" } }) };
});

import ClientPage from "./ClientPage";
import { ToastProvider } from "../../components/ToastProvider";
import { readAppAddressFormat } from "../utils/addressFormatPref";

describe("ClientPage display settings", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    window.localStorage.clear();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_client_settings") return Promise.resolve({});
      if (cmd === "count_workspace_logs_to_delete") return Promise.resolve(0);
      return Promise.resolve(null);
    });
  });

  it("changes the app-wide register address format", async () => {
    render(<ToastProvider><ClientPage /></ToastProvider>);
    const select = (await screen.findByLabelText("Register addresses")) as HTMLSelectElement;
    expect(select.value).toBe("dec");
    fireEvent.change(select, { target: { value: "hex" } });
    expect(readAppAddressFormat()).toBe("hex");
    await waitFor(() => expect(select.value).toBe("hex"));
  });
});
