import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FiSearch, FiSquare, FiX } from "react-icons/fi";

import {
  SLAVE_SCAN_EVENTS,
  cancelSlaveScan,
  startSlaveScan,
  type ScanDoneEvent,
  type ScanFoundEvent,
  type ScanKind,
  type ScanNoticeEvent,
  type ScanProgressEvent,
  type SerialParams,
} from "../api/slaveScan";
import {
  estimateScanSeconds,
  formatDuration,
  formatSettings,
  isAlreadyInWorkspace,
  newScanId,
  suggestSlaveName,
} from "../utils/slaveScan";
import { normalizeConnectionSettings, type ConnectionSettings, type PortItem } from "./ConnectionSettingsForm";
import ScanResultsList from "./ScanResultsList";
import SlaveScanForm, { buildRequest, formProblem, initialForm, workspaceSerial, type FormState } from "./SlaveScanForm";

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
  const [resultKind, setResultKind] = useState<ScanKind>("serial");
  const [results, setResults] = useState<ScanFoundEvent[]>([]);
  const [progress, setProgress] = useState<ScanProgressEvent | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const phaseRef = useRef<Phase>("idle");
  const currentScanIdRef = useRef<string | null>(null);
  const scanWorkspaceRef = useRef(workspaceName);
  const workspaceNameRef = useRef(workspaceName);
  workspaceNameRef.current = workspaceName;
  const listenersReadyRef = useRef<Promise<boolean> | null>(null);

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
    setNotices([]);
    setProgress(null);
    setSummary(null);
    void (async () => {
      const [settingsRes, portsRes] = await Promise.allSettled([
        invoke<ConnectionSettings>("get_connection_settings", { name: workspaceName }),
        invoke<PortItem[]>("list_serial_ports"),
      ]);
      if (stale) return;
      const loaded = normalizeConnectionSettings(
        settingsRes.status === "fulfilled" && settingsRes.value ? settingsRes.value : { kind: "serial" },
      );
      if (settingsRes.status === "rejected") setError(String(settingsRes.reason));
      setWs(loaded);
      setPortItems(portsRes.status === "fulfilled" && Array.isArray(portsRes.value) ? portsRes.value : []);
      setForm(initialForm(loaded));
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
      listen<ScanProgressEvent>(SLAVE_SCAN_EVENTS.progress, ({ payload }) => {
        if (accept(payload)) setProgress(payload);
      }),
      listen<ScanNoticeEvent>(SLAVE_SCAN_EVENTS.notice, ({ payload }) => {
        if (accept(payload)) setNotices((prev) => (prev.includes(payload.message) ? prev : [...prev, payload.message]));
      }),
      listen<ScanDoneEvent>(SLAVE_SCAN_EVENTS.done, ({ payload }) => {
        if (!accept(payload)) return;
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
    const ports = Math.max(1, form.ports.length);
    const combos = serial && form.sweepOn ? form.sweepBauds.length * form.sweepParities.length : 1;
    // Serial: every port scans the whole range in parallel; TCP: `concurrency` workers share it.
    return estimateScanSeconds({
      addresses: Number(form.quantity) * (serial ? ports : 1),
      combos,
      waitMs: Number(form.waitMs),
      retries: Number(form.retries),
      probe: form.probe,
      parallelism: serial ? ports : Number(form.concurrency),
    });
  }, [form]);

  if (!open) return null;

  const busy = phase !== "idle";

  async function handleScan() {
    if (phaseRef.current !== "idle" || loading || formProblem(form) !== null) return;
    const request = buildRequest(form, newScanId());
    // Set before anything is awaited: events for this ID are accepted from now on.
    currentScanIdRef.current = request.scanId;
    scanWorkspaceRef.current = workspaceName;
    setPhase("scanning");
    setResultKind(request.kind);
    setResults([]);
    setNotices([]);
    setProgress(null);
    setSummary(null);
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

    try {
      await startSlaveScan(workspaceName, request);
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
  const showResults = results.length > 0 || busy || summary !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
      <button type="button" className="absolute inset-0 cursor-default bg-black/60" onClick={() => closeModal()} aria-label="Close" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={fieldId("title")}
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="flex items-start justify-between gap-3 p-4 pb-0">
          <div>
            <div id={fieldId("title")} className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              Scan for slaves
            </div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Checks a range of unit IDs and lists the devices that answer.
            </div>
          </div>
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

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? (
            <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="text-sm text-slate-600 dark:text-slate-300">Loading connection settings…</div>
          ) : (
            <SlaveScanForm form={form} setForm={setForm} portItems={portItems} disabled={busy} />
          )}

          {busy ? (
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-300">
                <span>
                  {phase === "cancelling"
                    ? "Cancelling…"
                    : progress
                      ? `Checking unit ${progress.current.unitId} on ${progress.current.target}${
                          progress.current.settings ? ` at ${formatSettings(progress.current.settings)}` : ""
                        }`
                      : "Starting scan…"}
                </span>
                {progress ? <span className="font-mono">{`${progress.checked} / ${progress.total}`}</span> : null}
              </div>
              <div
                role="progressbar"
                aria-label="Scan progress"
                aria-valuemin={0}
                aria-valuemax={progress?.total ?? 0}
                aria-valuenow={progress?.checked ?? 0}
                className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
              >
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width]"
                  style={{
                    width: progress && progress.total > 0 ? `${Math.min(100, (progress.checked / progress.total) * 100)}%` : "0%",
                  }}
                />
              </div>
            </div>
          ) : null}

          {summary ? <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">{summary}</div> : null}

          {notices.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-2">
              {notices.map((n) => (
                <li
                  key={n}
                  className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
                >
                  {n}
                </li>
              ))}
            </ul>
          ) : null}

          {showResults ? (
            <ScanResultsList
              results={results}
              scanning={busy}
              isExisting={(ev) => isAlreadyInWorkspace(ev, existingSlaves, resultKind)}
              onAdd={handleAdd}
            />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4 dark:border-slate-800">
          <div className="text-sm text-slate-600 dark:text-slate-300">
            {problem ? (
              <span className="text-rose-700 dark:text-rose-300">{problem}</span>
            ) : estimate !== null && !loading ? (
              `Estimated time: ${formatDuration(estimate)} (worst case)`
            ) : null}
          </div>
          {busy ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-rose-600/60 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-800 transition hover:border-rose-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/60 dark:text-rose-200 dark:hover:border-rose-400"
              onClick={() => requestCancel()}
              disabled={phase === "cancelling"}
            >
              <FiSquare className="h-4 w-4" aria-hidden="true" />
              {phase === "cancelling" ? "Cancelling…" : "Cancel"}
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
              onClick={() => void handleScan()}
              disabled={loading || problem !== null}
            >
              <FiSearch className="h-4 w-4" aria-hidden="true" />
              Scan
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
