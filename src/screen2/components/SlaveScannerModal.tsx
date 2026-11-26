import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FiAlertTriangle, FiSearch, FiSquare, FiX } from "react-icons/fi";

import {
  SLAVE_SCAN_EVENTS,
  cancelSlaveScan,
  scanDefaultIpRange,
  startSlaveScan,
  type ScanDoneEvent,
  type ScanFoundEvent,
  type ScanHostEvent,
  type ScanNoticeEvent,
  type ScanProgressEvent,
  type SerialParams,
} from "../api/slaveScan";
import {
  estimateRangeSeconds,
  estimateScanSeconds,
  formatDuration,
  formatSettings,
  groupScanResults,
  isAlreadyInWorkspace,
  newScanId,
  parseIpRange,
  suggestSlaveName,
} from "../utils/slaveScan";
import { normalizeConnectionSettings, type ConnectionSettings, type PortItem } from "./ConnectionSettingsForm";
import ScanHostsList from "./ScanHostsList";
import ScanResultsList from "./ScanResultsList";
import SlaveScanForm, {
  buildRequest,
  formProblem,
  initialForm,
  sweptBauds,
  workspaceSerial,
  type FormState,
} from "./SlaveScanForm";

export type ScanPick = {
  unitId: number;
  connectionKind: "serial" | "tcp";
  suggestedName: string;
  /** Non-null only when the result's port or settings differ from the workspace's. */
  serialToSave: { port: string; params: SerialParams; portDiffers: boolean } | null;
};

export type SlaveScannerModalProps = {
  open: boolean;
  workspaceName: string;
  existingSlaves: { unitId: number; connectionKind: string; name: string }[];
  onClose(): void;
  onAdd(pick: ScanPick): void;
};

type Phase = "idle" | "scanning" | "cancelling";

function sameSerial(a: SerialParams, b: SerialParams): boolean {
  return (
    a.baud === b.baud &&
    a.parity === b.parity &&
    a.dataBits === b.dataBits &&
    a.stopBits === b.stopBits &&
    a.flowControl === b.flowControl
  );
}

/** Subscribes to every event; if any subscription fails, the others are released. */
async function listenAll(subscriptions: Promise<UnlistenFn>[]): Promise<UnlistenFn[]> {
  const settled = await Promise.allSettled(subscriptions);
  const fns = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (fns.length !== settled.length) {
    fns.forEach((fn) => fn());
    throw new Error("Could not subscribe to scan events");
  }
  return fns;
}

export default function SlaveScannerModal({ open, workspaceName, existingSlaves, onClose, onAdd }: SlaveScannerModalProps) {
  const id = useId();

  const [loading, setLoading] = useState(true);
  const [ws, setWs] = useState<ConnectionSettings>(() => normalizeConnectionSettings({ kind: "serial" }));
  const [portItems, setPortItems] = useState<PortItem[]>([]);
  const [form, setForm] = useState<FormState>(() => initialForm(normalizeConnectionSettings({ kind: "serial" })));

  const [phase, setPhaseState] = useState<Phase>("idle");
  const [resultKind, setResultKind] = useState<"serial" | "tcp">("serial");
  const [results, setResults] = useState<ScanFoundEvent[]>([]);
  /** Whether the running or last scan was an IP-range scan (results grouped by host, no Add). */
  const [rangeScan, setRangeScan] = useState(false);
  /** Latest status per host ("ip:port") of the range scan. */
  const [hosts, setHosts] = useState<Map<string, ScanHostEvent>>(() => new Map());
  /** Addresses in the range of the running or last range scan. */
  const [rangeAddresses, setRangeAddresses] = useState(0);
  const [cancelledDone, setCancelledDone] = useState(false);
  const [progress, setProgress] = useState<ScanProgressEvent | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  /** Addresses checked by the last finished scan (progress is cleared when it ends). */
  const [finalChecked, setFinalChecked] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const phaseRef = useRef<Phase>("idle");
  const currentScanIdRef = useRef<string | null>(null);
  const scanWorkspaceRef = useRef(workspaceName);
  const workspaceNameRef = useRef(workspaceName);
  workspaceNameRef.current = workspaceName;
  const listenersReadyRef = useRef<Promise<boolean> | null>(null);
  /** The scan whose done event was seen most recently. */
  const lastDoneScanIdRef = useRef<string | null>(null);

  function setPhase(next: Phase) {
    phaseRef.current = next;
    setPhaseState(next);
  }

  /** Sends a cancel for the running scan (once) and stops accepting its events. Used on close/unmount. */
  function abandonScan() {
    const scanId = currentScanIdRef.current;
    if (scanId && phaseRef.current === "scanning") {
      void cancelSlaveScan(scanWorkspaceRef.current, scanId).catch(() => {});
    }
    currentScanIdRef.current = null;
    setPhase("idle");
  }
  const abandonRef = useRef(abandonScan);
  abandonRef.current = abandonScan;

  function closeModal() {
    abandonScan();
    onClose();
  }
  const closeRef = useRef(closeModal);
  closeRef.current = closeModal;

  // Load the workspace connection settings and serial ports on every open.
  useEffect(() => {
    if (!open) return;
    let stale = false;
    setLoading(true);
    setError(null);
    setResults([]);
    setHosts(new Map());
    setRangeScan(false);
    setCancelledDone(false);
    setNotices([]);
    setProgress(null);
    setSummary(null);
    setFinalChecked(null);
    void (async () => {
      const [settingsRes, portsRes, rangeRes] = await Promise.allSettled([
        invoke<ConnectionSettings>("get_connection_settings", { name: workspaceName }),
        invoke<PortItem[]>("list_serial_ports"),
        scanDefaultIpRange(),
      ]);
      if (stale) return;
      const loaded = normalizeConnectionSettings(
        settingsRes.status === "fulfilled" && settingsRes.value ? settingsRes.value : { kind: "serial" },
      );
      if (settingsRes.status === "rejected") setError(String(settingsRes.reason));
      setWs(loaded);
      setPortItems(portsRes.status === "fulfilled" && Array.isArray(portsRes.value) ? portsRes.value : []);
      const defaultRange = rangeRes.status === "fulfilled" ? rangeRes.value : null;
      const fresh = initialForm(loaded);
      setForm(defaultRange && !fresh.range ? { ...fresh, range: defaultRange } : fresh);
      setLoading(false);
    })();
    return () => {
      stale = true;
    };
  }, [open, workspaceName]);

  // Subscribe to scan events while open. Events can arrive before startSlaveScan resolves, so they
  // are matched against the scan ID generated here rather than the one start returns.
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let unlisteners: UnlistenFn[] = [];
    const accept = (p: { workspace: string; scanId: string }) =>
      currentScanIdRef.current !== null &&
      p.scanId === currentScanIdRef.current &&
      p.workspace === workspaceNameRef.current;

    listenersReadyRef.current = listenAll([
      listen<ScanFoundEvent>(SLAVE_SCAN_EVENTS.found, ({ payload }) => {
        if (accept(payload)) setResults((prev) => [...prev, payload]);
      }),
      listen<ScanHostEvent>(SLAVE_SCAN_EVENTS.host, ({ payload }) => {
        if (accept(payload)) setHosts((prev) => new Map(prev).set(payload.host, payload));
      }),
      listen<ScanProgressEvent>(SLAVE_SCAN_EVENTS.progress, ({ payload }) => {
        if (accept(payload)) setProgress(payload);
      }),
      listen<ScanNoticeEvent>(SLAVE_SCAN_EVENTS.notice, ({ payload }) => {
        if (accept(payload)) setNotices((prev) => (prev.includes(payload.message) ? prev : [...prev, payload.message]));
      }),
      listen<ScanDoneEvent>(SLAVE_SCAN_EVENTS.done, ({ payload }) => {
        if (!accept(payload)) return;
        lastDoneScanIdRef.current = payload.scanId;
        setFinalChecked(payload.checked);
        setCancelledDone(payload.reason === "cancelled");
        currentScanIdRef.current = null;
        phaseRef.current = "idle";
        setPhaseState("idle");
        setProgress(null);
        const totals = `checked ${payload.checked}, found ${payload.found}`;
        if (payload.reason === "failed") {
          setSummary(null);
          setError(`Scan failed: ${payload.error ?? "unknown error"}`);
        } else {
          setSummary(payload.reason === "cancelled" ? `Scan cancelled — ${totals}` : `Scan complete — ${totals}`);
        }
      }),
    ]).then(
      (fns) => {
        if (disposed) {
          fns.forEach((fn) => fn());
          return false;
        }
        unlisteners = fns;
        return true;
      },
      () => false,
    );

    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
      unlisteners = [];
      listenersReadyRef.current = null;
      // Closing (open → false) or unmounting while a scan runs cancels it.
      abandonRef.current();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const problem = loading ? null : formProblem(form);

  const estimate = useMemo(() => {
    if (formProblem(form) !== null) return null;
    const serial = form.kind === "serial";
    const rangeParsed = form.tcpMode === "range" && !serial ? parseIpRange(form.range) : null;
    const ports = Math.max(1, form.ports.length);
    const combos = serial && form.sweepOn ? sweptBauds(form).length * form.sweepParities.length : 1;
    // Serial: every port scans the whole range in parallel; TCP: `concurrency` workers share it.
    const perHost = estimateScanSeconds({
      addresses: Number(form.quantity) * (serial ? ports : 1),
      combos,
      waitMs: Number(form.waitMs),
      retries: Number(form.retries),
      probe: form.probe,
      parallelism: serial ? ports : Number(form.concurrency),
    });
    if (rangeParsed === null || "error" in rangeParsed) return { total: perHost, hosts: null };
    // Range: find hosts first (every address times out), then scan each host found.
    return {
      total: perHost,
      hosts: estimateRangeSeconds({
        addresses: rangeParsed.count,
        connectWaitMs: Number(form.connectWaitMs),
        retries: Number(form.retries),
        hostConcurrency: Number(form.hostConcurrency),
      }),
    };
  }, [form]);

  const counts = useMemo(() => {
    const g = groupScanResults(results);
    return { found: g.found.length, garbled: g.garbled.length, gateway: g.gateway.length };
  }, [results]);

  if (!open) return null;

  const busy = phase !== "idle";

  async function handleScan() {
    if (phaseRef.current !== "idle" || loading || formProblem(form) !== null) return;
    const request = buildRequest(form, newScanId());
    // Set before anything is awaited: events for this ID are accepted from now on.
    currentScanIdRef.current = request.scanId;
    scanWorkspaceRef.current = workspaceName;
    setPhase("scanning");
    setResultKind(request.kind === "serial" ? "serial" : "tcp");
    const rangeParsed = request.kind === "tcpRange" ? parseIpRange(form.range) : null;
    setRangeScan(request.kind === "tcpRange");
    setRangeAddresses(rangeParsed !== null && !("error" in rangeParsed) ? rangeParsed.count : 0);
    setHosts(new Map());
    setCancelledDone(false);
    setResults([]);
    setNotices([]);
    setProgress(null);
    setSummary(null);
    setFinalChecked(null);
    setError(null);

    const ready = (await listenersReadyRef.current) ?? false;
    if (currentScanIdRef.current !== request.scanId) return; // closed meanwhile
    if (!ready || (phaseRef.current as Phase) === "cancelling") {
      // Never started: nothing to wait for.
      currentScanIdRef.current = null;
      setPhase("idle");
      if (!ready) setError("Could not subscribe to scan events");
      return;
    }

    const scanWorkspace = workspaceName;
    try {
      await startSlaveScan(scanWorkspace, request);
      // A close or Cancel that came before the backend registered the scan had nothing to cancel,
      // so the scan would run on unseen. Cancel again now that it is registered (cancel is
      // idempotent); not needed if its done event already arrived.
      const abandoned =
        currentScanIdRef.current !== request.scanId || (phaseRef.current as Phase) === "cancelling";
      if (abandoned && lastDoneScanIdRef.current !== request.scanId) {
        void cancelSlaveScan(scanWorkspace, request.scanId).catch(() => {});
      }
    } catch (e) {
      if (currentScanIdRef.current === request.scanId) {
        currentScanIdRef.current = null;
        setPhase("idle");
        setError(String(e));
      }
    }
  }

  function requestCancel() {
    const scanId = currentScanIdRef.current;
    if (!scanId || phaseRef.current !== "scanning") return;
    setPhase("cancelling");
    // The backend records the cancel even if start has not returned yet; done(cancelled) follows.
    cancelSlaveScan(scanWorkspaceRef.current, scanId).catch((e) => setError(String(e)));
  }

  function handleAdd(ev: ScanFoundEvent) {
    const wsSerial = workspaceSerial(ws);
    const differs =
      resultKind === "serial" && ev.settings !== null && (ev.target !== ws.serialPort || !sameSerial(ev.settings, wsSerial));
    const pick: ScanPick = {
      unitId: ev.unitId,
      connectionKind: resultKind,
      suggestedName: suggestSlaveName(
        ev.unitId,
        existingSlaves.map((s) => s.name),
      ),
      serialToSave:
        differs && ev.settings
          ? { port: ev.target, params: ev.settings, portDiffers: ev.target !== ws.serialPort }
          : null,
    };
    requestCancel();
    onAdd(pick);
  }

  const fieldId = (name: string) => `${id}-${name}`;
  const showStatus = busy || summary !== null || results.length > 0;
  const hostList = [...hosts.values()];
  const pct = progress && progress.total > 0 ? Math.min(100, (progress.checked / progress.total) * 100) : 0;

  const statusChip =
    phase === "scanning"
      ? { text: "Scanning", cls: "border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200", pulse: true }
      : phase === "cancelling"
        ? { text: "Cancelling", cls: "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200", pulse: true }
        : summary
          ? { text: "Finished", cls: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-300", pulse: false }
          : { text: "Ready", cls: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-300", pulse: false };

  const stat = (label: string, value: string, tone: string) => (
    <div className="flex flex-col rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950/30">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`font-mono text-lg font-semibold ${tone}`}>{value}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
      <button type="button" className="absolute inset-0 cursor-default bg-black/60" onClick={() => closeModal()} aria-label="Close" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={fieldId("title")}
        className="relative flex h-[92vh] w-[96vw] max-w-[1800px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              <FiSearch className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div id={fieldId("title")} className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Scan for slaves
              </div>
              <div className="truncate text-sm text-slate-600 dark:text-slate-400">
                Checks a range of unit IDs and lists the devices that answer.
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusChip.cls}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full bg-current ${statusChip.pulse ? "animate-pulse" : "opacity-60"}`}
                aria-hidden="true"
              />
              {statusChip.text}
            </span>
            <button
              type="button"
              className="rounded-full border border-slate-300 bg-slate-100 p-2 text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
              onClick={() => closeModal()}
              aria-label="Close scanner"
              title="Close"
            >
              <FiX className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Narrow windows: one scrolling column whose parts never shrink (so nothing overlaps).
            From md: settings and results side by side, each scrolling on its own. */}
        <div className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[minmax(320px,380px)_1fr] md:overflow-hidden lg:grid-cols-[minmax(360px,420px)_1fr]">
          {/* Settings */}
          <aside className="flex flex-col border-b border-slate-200 bg-slate-50/60 md:min-h-0 md:border-r md:border-b-0 dark:border-slate-800 dark:bg-slate-950/30">
            <div className="p-5 md:min-h-0 md:flex-1 md:overflow-y-auto">
              {loading ? (
                <div className="text-sm text-slate-600 dark:text-slate-300">Loading connection settings…</div>
              ) : (
                <SlaveScanForm form={form} setForm={setForm} portItems={portItems} disabled={busy} />
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-900/80">
              <div className="min-h-5 text-sm">
                {problem ? (
                  <span className="text-rose-700 dark:text-rose-300">{problem}</span>
                ) : estimate !== null && !loading ? (
                  <span className="text-slate-600 dark:text-slate-300">
                    {estimate.hosts !== null
                      ? `Finding hosts: ${formatDuration(estimate.hosts)}, then ${formatDuration(estimate.total)} per host found (worst case)`
                      : `Estimated time: ${formatDuration(estimate.total)} (worst case)`}
                  </span>
                ) : null}
              </div>
              {busy ? (
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-600/60 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-800 transition hover:border-rose-500 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/60 dark:text-rose-200 dark:hover:border-rose-400"
                  onClick={() => requestCancel()}
                  disabled={phase === "cancelling"}
                >
                  <FiSquare className="h-4 w-4" aria-hidden="true" />
                  {phase === "cancelling" ? "Cancelling…" : "Cancel"}
                </button>
              ) : (
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-600/60 bg-emerald-500/15 px-4 py-2.5 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400"
                  onClick={() => void handleScan()}
                  disabled={loading || problem !== null}
                >
                  <FiSearch className="h-4 w-4" aria-hidden="true" />
                  Scan
                </button>
              )}
            </div>
          </aside>

          {/* Status and results */}
          <main className="flex flex-col gap-5 p-5 md:min-h-0 md:overflow-y-auto">
            {error ? (
              <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
                <FiAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            ) : null}

            {showStatus ? (
              <div className="@container flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/30">
                {busy ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3 text-sm text-slate-700 dark:text-slate-200">
                      <span>
                        {phase === "cancelling"
                          ? "Cancelling…"
                          : progress?.phase === "hosts"
                            ? `Finding hosts — ${progress.checked} / ${progress.total}`
                            : progress && progress.hostIndex != null && progress.hostCount != null
                              ? `Scanning unit IDs on ${progress.current.target} (host ${progress.hostIndex} of ${progress.hostCount})`
                              : progress
                            ? `Checking unit ${progress.current.unitId} on ${progress.current.target}${
                                progress.current.settings ? ` at ${formatSettings(progress.current.settings)}` : ""
                              }`
                            : "Starting scan…"}
                      </span>
                      {progress ? (
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{`${progress.checked} / ${progress.total}`}</span>
                      ) : null}
                    </div>
                    <div
                      role="progressbar"
                      aria-label="Scan progress"
                      aria-valuemin={0}
                      aria-valuemax={progress?.total ?? 0}
                      aria-valuenow={progress?.checked ?? 0}
                      className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
                    >
                      <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                ) : summary ? (
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{summary}</div>
                ) : null}

                <div className={`grid grid-cols-2 gap-2 ${rangeScan ? "@lg:grid-cols-5" : "@lg:grid-cols-4"}`}>
                  {stat(
                    "Checked",
                    progress ? (progress.phase === "hosts" ? "0" : `${progress.checked}`) : finalChecked !== null ? `${finalChecked}` : busy ? "0" : "—",
                    "text-slate-900 dark:text-slate-100",
                  )}
                  {stat("Found", String(counts.found), "text-emerald-700 dark:text-emerald-300")}
                  {stat("Garbled", String(counts.garbled), "text-amber-700 dark:text-amber-300")}
                  {stat("No device (gateway)", String(counts.gateway), "text-slate-600 dark:text-slate-300")}
                  {rangeScan
                    ? stat(
                        "Hosts",
                        `${hostList.length} / ${rangeAddresses}`,
                        "text-slate-900 dark:text-slate-100",
                      )
                    : null}
                </div>
              </div>
            ) : null}

            {notices.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {notices.map((n) => (
                  <li
                    key={n}
                    className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
                  >
                    <FiAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {showStatus && rangeScan ? (
              <ScanHostsList hosts={hostList} results={results} scanning={busy} cancelled={cancelledDone} />
            ) : showStatus ? (
              <ScanResultsList
                results={results}
                scanning={busy}
                isExisting={(ev) => isAlreadyInWorkspace(ev, existingSlaves, resultKind)}
                onAdd={handleAdd}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  <FiSearch className="h-6 w-6" aria-hidden="true" />
                </span>
                <div className="text-base font-semibold text-slate-800 dark:text-slate-100">No scan yet</div>
                <p className="max-w-md text-sm text-slate-600 dark:text-slate-400">
                  Pick the connection and address range on the left, then press Scan. Devices appear here as soon as
                  they answer, and you can cancel once the one you need is listed.
                </p>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
