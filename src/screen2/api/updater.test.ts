import { describe, expect, it, vi, beforeEach } from "vitest";

const checkMock = vi.fn();
const relaunchMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => checkMock(...args),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args: unknown[]) => relaunchMock(...args),
}));

import { checkForUpdate, installAndRelaunch } from "./updater";

describe("checkForUpdate", () => {
  beforeEach(() => {
    checkMock.mockReset();
    relaunchMock.mockReset();
  });

  it("returns up-to-date when check() resolves to null", async () => {
    checkMock.mockResolvedValueOnce(null);
    const result = await checkForUpdate();
    expect(result.status).toBe("up-to-date");
  });

  it("returns available with version and notes when an update exists", async () => {
    const update = {
      version: "0.2.0",
      currentVersion: "0.1.0",
      body: "Release notes",
      downloadAndInstall: vi.fn(),
    };
    checkMock.mockResolvedValueOnce(update);
    const result = await checkForUpdate();
    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.version).toBe("0.2.0");
      expect(result.currentVersion).toBe("0.1.0");
      expect(result.notes).toBe("Release notes");
      expect(result.update).toBe(update);
    }
  });

  it("returns null notes when body is empty", async () => {
    checkMock.mockResolvedValueOnce({
      version: "0.2.0",
      currentVersion: "0.1.0",
      body: "   ",
      downloadAndInstall: vi.fn(),
    });
    const result = await checkForUpdate();
    if (result.status === "available") {
      expect(result.notes).toBeNull();
    }
  });

  it("returns error when check() rejects", async () => {
    checkMock.mockRejectedValueOnce(new Error("offline"));
    const result = await checkForUpdate();
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("offline");
    }
  });
});

describe("installAndRelaunch", () => {
  beforeEach(() => {
    checkMock.mockReset();
    relaunchMock.mockReset();
  });

  it("forwards progress events and then relaunches", async () => {
    const events = [
      { event: "Started", data: { contentLength: 1000 } },
      { event: "Progress", data: { chunkLength: 400 } },
      { event: "Progress", data: { chunkLength: 600 } },
      { event: "Finished", data: {} },
    ];
    const update = {
      version: "0.2.0",
      currentVersion: "0.1.0",
      body: "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      downloadAndInstall: async (cb: (e: any) => void) => {
        for (const e of events) cb(e);
      },
    };

    const progress: Array<[number, number | null]> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await installAndRelaunch(update as any, (d, t) => {
      progress.push([d, t]);
    });

    expect(progress).toEqual([
      [0, 1000],
      [400, 1000],
      [1000, 1000],
      [1000, 1000],
    ]);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
  });
});
