import { describe, expect, it } from "vitest";

import type { ScanFoundEvent } from "../api/slaveScan";
import {
  SCAN_BAUDS,
  SCAN_PARITIES,
  defaultQuantity,
  defaultWaitMs,
  estimateRangeSeconds,
  estimateScanSeconds,
  formatDuration,
  formatSettings,
  groupScanResults,
  isAlreadyInWorkspace,
  newScanId,
  parseIpRange,
  suggestSlaveName,
  unitRange,
} from "./slaveScan";

const P8N1 = { baud: 9600, parity: "none" as const, dataBits: 8, stopBits: 1, flowControl: "none" };
const P8E1 = { baud: 19200, parity: "even" as const, dataBits: 8, stopBits: 1, flowControl: "none" };

function found(partial: Partial<ScanFoundEvent>): ScanFoundEvent {
  return {
    workspace: "ws",
    scanId: "s1",
    target: "COM3",
    unitId: 1,
    settings: P8N1,
    category: "found",
    detail: "value",
    functionCode: 3,
    responseMs: 12,
    ...partial,
  };
}

describe("slaveScan constants", () => {
  it("offers the sweep bauds and parities from the spec", () => {
    expect(SCAN_BAUDS).toEqual([1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200]);
    expect(SCAN_PARITIES).toEqual(["none", "even", "odd"]);
  });
});

describe("unitRange / defaultQuantity / defaultWaitMs", () => {
  it("uses 1–247 for serial and 0–255 for TCP", () => {
    expect(unitRange("serial")).toEqual({ min: 1, max: 247 });
    expect(unitRange("tcp")).toEqual({ min: 0, max: 255 });
  });

  it("defaults the quantity to the rest of the range", () => {
    expect(defaultQuantity("serial", 1)).toBe(247);
    expect(defaultQuantity("tcp", 0)).toBe(256);
    expect(defaultQuantity("serial", 200)).toBe(48);
    expect(defaultQuantity("tcp", 1)).toBe(255);
  });

  it("never returns a negative quantity for a start beyond the range", () => {
    expect(defaultQuantity("serial", 300)).toBe(0);
  });

  it("waits 200 ms per attempt on serial and 1000 ms on TCP", () => {
    expect(defaultWaitMs("serial")).toBe(200);
    expect(defaultWaitMs("tcp")).toBe(1000);
  });
});

describe("estimateScanSeconds", () => {
  it("multiplies addresses, combos, wait and attempts", () => {
    expect(
      estimateScanSeconds({ addresses: 247, combos: 1, waitMs: 200, retries: 0, probe: "holding", parallelism: 1 }),
    ).toBe(50);
    expect(
      estimateScanSeconds({
        addresses: 247,
        combos: 1,
        waitMs: 200,
        retries: 0,
        probe: "holdingThenInput",
        parallelism: 1,
      }),
    ).toBe(99);
  });

  it("divides by parallelism", () => {
    expect(
      estimateScanSeconds({ addresses: 100, combos: 1, waitMs: 200, retries: 0, probe: "holding", parallelism: 4 }),
    ).toBe(5);
  });

  it("counts retries and combinations", () => {
    expect(
      estimateScanSeconds({ addresses: 10, combos: 3, waitMs: 100, retries: 1, probe: "input", parallelism: 1 }),
    ).toBe(6);
  });
});

describe("formatDuration", () => {
  it("shows seconds, minutes and hours", () => {
    expect(formatDuration(50)).toBe("about 50 s");
    expect(formatDuration(99)).toBe("about 1 min 39 s");
    expect(formatDuration(120)).toBe("about 2 min");
    expect(formatDuration(3600)).toBe("about 1 h");
    expect(formatDuration(3720)).toBe("about 1 h 2 min");
  });
});

describe("formatSettings", () => {
  it("formats baud and the data/parity/stop shorthand", () => {
    expect(formatSettings(P8E1)).toBe("19200 8E1");
    expect(formatSettings(P8N1)).toBe("9600 8N1");
    expect(formatSettings({ baud: 4800, parity: "odd", dataBits: 7, stopBits: 2, flowControl: "none" })).toBe(
      "4800 7O2",
    );
  });
});

describe("groupScanResults", () => {
  it("removes duplicates, splits the categories and sorts by unit then target", () => {
    const events = [
      found({ unitId: 17, target: "COM5" }),
      found({ unitId: 3, target: "COM5" }),
      found({ unitId: 3, target: "COM3" }),
      found({ unitId: 3, target: "COM3", responseMs: 99 }), // duplicate
      found({ unitId: 3, target: "COM3", settings: P8E1 }), // same unit, other settings
      found({ unitId: 9, category: "garbled", detail: "CRC error" }),
      found({ unitId: 9, category: "garbled", detail: "CRC error" }), // duplicate
      found({ unitId: 40, target: "10.0.0.5:502", settings: null, category: "gatewayNoDevice" }),
    ];
    const g = groupScanResults(events);
    expect(g.found.map((e) => `${e.unitId}@${e.target} ${e.settings ? formatSettings(e.settings) : ""}`)).toEqual([
      "3@COM3 9600 8N1",
      "3@COM3 19200 8E1",
      "3@COM5 9600 8N1",
      "17@COM5 9600 8N1",
    ]);
    expect(g.found[0].responseMs).toBe(12);
    expect(g.garbled.map((e) => e.unitId)).toEqual([9]);
    expect(g.gateway.map((e) => e.unitId)).toEqual([40]);
  });
});

describe("isAlreadyInWorkspace", () => {
  const slaves = [{ unitId: 3, connectionKind: "serial" }];

  it("matches on unit ID plus connection kind only", () => {
    expect(isAlreadyInWorkspace(found({ unitId: 3 }), slaves, "serial")).toBe(true);
    expect(isAlreadyInWorkspace(found({ unitId: 3, target: "COM9", settings: P8E1 }), slaves, "serial")).toBe(true);
    expect(isAlreadyInWorkspace(found({ unitId: 3, settings: null }), slaves, "tcp")).toBe(false);
    expect(isAlreadyInWorkspace(found({ unitId: 4 }), slaves, "serial")).toBe(false);
  });
});

describe("suggestSlaveName", () => {
  it("suggests Slave N, then numbered copies", () => {
    expect(suggestSlaveName(17, [])).toBe("Slave 17");
    expect(suggestSlaveName(17, ["Slave 17"])).toBe("Slave 17 (2)");
    expect(suggestSlaveName(17, ["Slave 17", "slave 17 (2)"])).toBe("Slave 17 (3)");
  });
});

describe("newScanId", () => {
  it("returns distinct non-empty ids of at most 64 characters", () => {
    const a = newScanId();
    const b = newScanId();
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a).not.toBe(b);
  });
});

describe("parseIpRange (mirrors the Rust parser)", () => {
  it.each([
    ["192.168.68.1-254", 254],
    ["192.168.68.10-192.168.69.20", 267],
    ["192.168.68.0/24", 254],
    ["10.0.0.0/22", 1022],
    ["192.168.1.5", 1],
    ["192.168.1.0/31", 2],
    ["192.168.1.7/32", 1],
    [" 192.168.68.1 - 20 ", 20],
  ])("counts %s", (input, count) => {
    expect(parseIpRange(input)).toEqual({ count });
  });

  it.each([
    ["192.168.68.20-10", "Range end is before its start"],
    ["224.0.0.1", "Multicast, broadcast and 0.x addresses can't be scanned"],
    ["255.255.255.255", "Multicast, broadcast and 0.x addresses can't be scanned"],
    ["0.1.2.3", "Multicast, broadcast and 0.x addresses can't be scanned"],
    ["192.168.68.300", "Not an IPv4 address or range"],
    ["abc", "Not an IPv4 address or range"],
    ["", "Not an IPv4 address or range"],
    ["1.2.3.4/33", "Not an IPv4 address or range"],
    ["1.2.3.4-300", "Not an IPv4 address or range"],
    ["10.0.0.0/21", "Too many addresses (2046) — the limit is 1024"],
    ["10.0.0.0-10.0.4.0", "Too many addresses (1025) — the limit is 1024"],
  ])("refuses %j", (input, error) => {
    expect(parseIpRange(input)).toEqual({ error });
  });
});

describe("estimateRangeSeconds", () => {
  it("is addresses x connect wait x attempts / parallel hosts", () => {
    expect(estimateRangeSeconds({ addresses: 254, connectWaitMs: 300, retries: 0, hostConcurrency: 64 })).toBe(2);
    expect(estimateRangeSeconds({ addresses: 254, connectWaitMs: 300, retries: 1, hostConcurrency: 1 })).toBe(153);
  });
});
