import { invoke } from "@tauri-apps/api/core";

export type ScanKind = "serial" | "tcp";

export type ProbeKind = "holding" | "input" | "holdingThenInput";

export type SerialParity = "none" | "even" | "odd";

export type SerialParams = {
  baud: number;
  parity: SerialParity;
  dataBits: number;
  stopBits: number;
  flowControl: string;
};

export type ScanSweep = {
  bauds: number[];
  parities: SerialParity[];
};

export type ScanTcpTarget = {
  host: string;
  port: number;
};

/** Mirrors `slave_scan::types::ScanRequest` (serde camelCase). */
export type ScanRequest = {
  scanId: string;
  kind: ScanKind;
  startUnitId: number;
  quantity: number;
  probe: ProbeKind;
  waitMs: number;
  retries: number;
  ports: string[];
  serial: SerialParams | null;
  sweep: ScanSweep | null;
  tcp: ScanTcpTarget | null;
  concurrency: number | null;
};

export type ScanCategory = "found" | "garbled" | "gatewayNoDevice";

export type ScanFoundEvent = {
  workspace: string;
  scanId: string;
  /** COM port name, or "host:port" for TCP. */
  target: string;
  unitId: number;
  /** Null for TCP. */
  settings: SerialParams | null;
  category: ScanCategory;
  detail: string;
  functionCode: number;
  responseMs: number;
};

export type ScanProgressEvent = {
  workspace: string;
  scanId: string;
  checked: number;
  total: number;
  current: {
    target: string;
    unitId: number;
    settings: SerialParams | null;
  };
};

export type ScanNoticeEvent = {
  workspace: string;
  scanId: string;
  message: string;
};

export type ScanDoneReason = "completed" | "cancelled" | "failed";

export type ScanDoneEvent = {
  workspace: string;
  scanId: string;
  reason: ScanDoneReason;
  error: string | null;
  checked: number;
  found: number;
};

export const SLAVE_SCAN_EVENTS = {
  found: "slave_scan_found",
  progress: "slave_scan_progress",
  notice: "slave_scan_notice",
  done: "slave_scan_done",
} as const;

/** Starts a scan in the background and resolves with its scan ID. Events may arrive before this resolves. */
export async function startSlaveScan(workspace: string, request: ScanRequest): Promise<string> {
  return await invoke<string>("start_slave_scan", { name: workspace, request });
}

/** Cancels the scan. Idempotent; an unknown or finished scan ID is not an error. */
export async function cancelSlaveScan(workspace: string, scanId: string): Promise<void> {
  await invoke<void>("cancel_slave_scan", { name: workspace, scanId });
}
