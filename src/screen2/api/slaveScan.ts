import { invoke } from "@tauri-apps/api/core";

export type ScanKind = "serial" | "tcp" | "tcpRange";

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
  /** tcpRange only: `a.b.c.d`, `a.b.c.d-e`, `a.b.c.d-w.x.y.z` or `a.b.c.d/n`. */
  range?: string | null;
  hostConcurrency?: number | null;
  connectWaitMs?: number | null;
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
  phase: "units" | "hosts";
  hostIndex: number | null;
  hostCount: number | null;
  current: {
    target: string;
    unitId: number;
    settings: SerialParams | null;
  };
};

export type ScanHostStatus = "open" | "devices" | "answersAll" | "gateway" | "noModbus" | "lost";

export type ScanHostEvent = {
  workspace: string;
  scanId: string;
  /** "ip:port". */
  host: string;
  status: ScanHostStatus;
  connectMs: number | null;
  found: number;
  gateway: boolean;
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
  host: "slave_scan_host",
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

/** The workspace's local /24 as a range such as `192.168.68.1-254`, or null when there is no private address. */
export async function scanDefaultIpRange(): Promise<string | null> {
  return (await invoke<string | null>("scan_default_ip_range")) ?? null;
}

/** This PC's primary IPv4 address, for the "This PC" hint, or null when unknown. */
export async function scanLocalIpv4(): Promise<string | null> {
  return (await invoke<string | null>("scan_local_ipv4")) ?? null;
}
