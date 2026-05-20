import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import UpdateDialog from "./UpdateDialog";

describe("UpdateDialog", () => {
  it("does not render when closed", () => {
    render(
      <UpdateDialog
        open={false}
        version="0.2.0"
        currentVersion="0.1.0"
        notes={null}
        install={() => Promise.resolve()}
        onClose={() => undefined}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the new version, current version, and notes", () => {
    render(
      <UpdateDialog
        open
        version="0.2.0"
        currentVersion="0.1.0"
        notes={"- new traffic monitor\n- updater"}
        install={() => Promise.resolve()}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText(/Version 0\.2\.0 is available/)).toBeInTheDocument();
    expect(screen.getByText(/You have 0\.1\.0/)).toBeInTheDocument();
    expect(screen.getByText(/- new traffic monitor/)).toBeInTheDocument();
  });

  it("renders a placeholder when no notes are provided", () => {
    render(
      <UpdateDialog
        open
        version="0.2.0"
        currentVersion="0.1.0"
        notes={null}
        install={() => Promise.resolve()}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText(/No release notes provided/)).toBeInTheDocument();
  });

  it("closes when Later is clicked", () => {
    const onClose = vi.fn();
    render(
      <UpdateDialog
        open
        version="0.2.0"
        currentVersion="0.1.0"
        notes={null}
        install={() => Promise.resolve()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the error message and retry button when install fails", async () => {
    const install = vi.fn().mockRejectedValue(new Error("network down"));
    render(
      <UpdateDialog
        open
        version="0.2.0"
        currentVersion="0.1.0"
        notes={null}
        install={install}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Install/ }));
    expect(install).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getByText(/Update failed: network down/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });

  it("renders a progress bar while downloading", async () => {
    // Resolves only after we let the test capture the in-flight state.
    let resolveInstall: () => void = () => undefined;
    const installPromise = new Promise<void>((resolve) => {
      resolveInstall = resolve;
    });
    const install = vi.fn((onProgress: (d: number, t: number | null) => void) => {
      onProgress(0, 1000);
      onProgress(500, 1000);
      return installPromise;
    });

    render(
      <UpdateDialog
        open
        version="0.2.0"
        currentVersion="0.1.0"
        notes={null}
        install={install}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Install/ }));

    await waitFor(() => {
      expect(screen.getByText(/Downloading/)).toBeInTheDocument();
      expect(screen.getByText(/50%/)).toBeInTheDocument();
    });

    resolveInstall();
  });
});
