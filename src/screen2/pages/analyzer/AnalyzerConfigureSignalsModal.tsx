import { useEffect, useMemo, useState } from "react";
import { FiEdit2, FiPlus, FiTrash2, FiX } from "react-icons/fi";
import ConfirmDialog from "../../../components/ConfirmDialog";
import {
  deleteAnalyzerSignal,
  type AnalyzerSignal,
  type AnalyzerTile,
  type AnalyzerTileSignalInfo,
} from "../../api/analyzer";
import type { SlaveItem } from "../../api/slaves";
import type { SignalEvaluation } from "../../utils/analyzerSignalEval";
import { formatAnalyzerAddress, type AnalyzerAddressFormat } from "../../utils/analyzerAddressFormat";
import SignalEditorPanel from "./signalEditor/SignalEditorPanel";
import { dependentsBySignalId } from "./signalEvaluations";

type Props = {
  open: boolean;
  workspaceName: string;
  signals: AnalyzerSignal[];
  slaves: SlaveItem[];
  addressFormat: AnalyzerAddressFormat;
  isPollingWanted: boolean;
  nowTsMs: number;
  getSignalPollIntervalMs: (signalId: string) => number;
  tiles: AnalyzerTile[];
  tileSignals: Record<number, AnalyzerTileSignalInfo[]>;
  evaluations: Record<string, SignalEvaluation>;
  onClose: () => void;
  onAfterMutation: () => Promise<void>;
  onError: (message: string) => void;
  onToast: (message: string) => void;
};

const KIND_BADGE = {
  register: "border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-white/5 dark:text-slate-300",
  calculated: "border-sky-600/40 bg-sky-500/10 text-sky-800 dark:border-sky-500/40 dark:text-sky-200",
};

export default function AnalyzerConfigureSignalsModal(props: Props) {
  const [mode, setMode] = useState<"view" | "add" | "edit">("view");
  const [selectedSignalId, setSelectedSignalId] = useState<string>("");

  const selectedSignal = useMemo(() => {
    const sid = selectedSignalId.trim();
    if (!sid) return null;
    return props.signals.find((s) => s.id === sid) ?? null;
  }, [props.signals, selectedSignalId]);

  const [signalIdToDelete, setSignalIdToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const signalToDelete = useMemo(() => {
    const sid = signalIdToDelete?.trim() ?? "";
    if (!sid) return null;
    return props.signals.find((s) => s.id === sid) ?? null;
  }, [props.signals, signalIdToDelete]);

  /** Calculated signals that use the signal about to be deleted (the backend refuses the delete then). */
  const blockingDependents = useMemo(() => {
    if (!signalToDelete) return [];
    return dependentsBySignalId(props.signals)[signalToDelete.id] ?? [];
  }, [props.signals, signalToDelete]);

  const slaveById = useMemo(() => {
    const out = new Map<number, SlaveItem>();
    for (const s of props.slaves) out.set(s.id, s);
    return out;
  }, [props.slaves]);

  function deriveSignalUiState(signal: AnalyzerSignal): string {
    if (signal.kind === "calculated") {
      const ev = props.evaluations[signal.id];
      if (ev) return ev.state;
    }
    const baseState = String(signal.state ?? "DISCONNECTED").toUpperCase();
    if (baseState !== "OK") return baseState;

    if (!props.isPollingWanted) return baseState;

    const expectedMs = props.getSignalPollIntervalMs(signal.id);
    const staleAfterMs = Math.max(1500, Math.round(expectedMs * 2.5));
    const lastTs = signal.lastUpdatedTsMs ?? null;
    if (lastTs == null) return "DISCONNECTED";

    const age = props.nowTsMs - lastTs;
    if (Number.isFinite(age) && age > staleAfterMs) return "STALE";
    return "OK";
  }

  useEffect(() => {
    if (!props.open) return;
    setMode("view");
    setSelectedSignalId("");
  }, [props.open]);

  // The signal being edited vanished (e.g. deleted elsewhere): go back to the list so Esc and the list work.
  useEffect(() => {
    if (mode === "edit" && !selectedSignal) setMode("view");
  }, [mode, selectedSignal]);

  // The editor panel handles its own Escape; this one covers the list and its delete confirmation.
  useEffect(() => {
    if (!props.open || mode !== "view") return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (deleting) return;
      // Escape dismisses the nested delete confirmation first when it is open.
      if (signalIdToDelete != null) {
        setSignalIdToDelete(null);
        setDeleteError(null);
        e.preventDefault();
        return;
      }
      e.preventDefault();
      props.onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [props.open, props.onClose, mode, deleting, signalIdToDelete]);

  if (!props.open) return null;

  async function confirmDelete() {
    if (!signalToDelete) return;

    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteAnalyzerSignal(props.workspaceName, signalToDelete.id);
      await props.onAfterMutation();
      props.onToast("Signal deleted");
      setSignalIdToDelete(null);

      const remaining = props.signals.filter((s) => s.id !== signalToDelete.id);
      setSelectedSignalId(remaining[0]?.id ?? "");
    } catch (e) {
      // Shown as-is: the backend names the calculated signals that still use this one.
      setDeleteError(String(e));
    } finally {
      setDeleting(false);
    }
  }

  if (mode === "add" || (mode === "edit" && selectedSignal)) {
    const editMode = mode;
    return (
      <SignalEditorPanel
        key={`${editMode}:${selectedSignal?.id ?? ""}`}
        mode={editMode}
        signal={editMode === "edit" ? selectedSignal : null}
        workspaceName={props.workspaceName}
        signals={props.signals}
        slaves={props.slaves}
        tiles={props.tiles}
        tileSignals={props.tileSignals}
        evaluations={props.evaluations}
        addressFormat={props.addressFormat}
        polling={props.isPollingWanted}
        onCancel={() => setMode("view")}
        onSaved={async (id) => {
          await props.onAfterMutation();
          props.onToast(editMode === "add" ? "Signal created" : "Signal saved");
          setMode("view");
          setSelectedSignalId(id);
        }}
        onError={props.onError}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="analyzer-signals-modal-title"
        className="w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="min-w-0">
            <div id="analyzer-signals-modal-title" className="truncate text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              Signals: <span className="text-slate-900 dark:text-slate-100">{props.signals.length}</span>
            </div>
            <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">Manage analyzer signals</div>
          </div>
          <div className="inline-flex gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
              onClick={() => {
                setSelectedSignalId("");
                setMode("add");
              }}
              disabled={deleting}
              title="Add signal"
            >
              <FiPlus className="h-4 w-4" aria-hidden="true" />
              Add Signal
            </button>

            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-2 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
              onClick={props.onClose}
              title="Close"
              disabled={deleting}
            >
              <FiX className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="max-h-[75vh] overflow-auto p-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800/70 dark:bg-slate-900">
            {props.signals.length === 0 ? (
              <div className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400">Add a Signal to fetch data from registers</div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {props.signals.map((s) => {
                  const stateUpper = deriveSignalUiState(s);
                  const stateDotClass =
                    stateUpper === "OK"
                      ? "bg-emerald-400"
                      : stateUpper === "ERROR"
                        ? "bg-rose-400"
                        : stateUpper === "DISCONNECTED"
                          ? "bg-slate-500"
                          : stateUpper === "STALE"
                            ? "bg-amber-400"
                            : "bg-amber-400";

                  const isCalculated = s.kind === "calculated";
                  let detail: string;
                  if (isCalculated) {
                    const inputs = s.inputSignalIds ?? [];
                    detail = inputs.length ? `Inputs: ${inputs.join(", ")}` : "Inputs: none";
                  } else {
                    const unit = slaveById.get(s.slaveId ?? -1)?.unitId ?? null;
                    const slaveLabel = unit != null ? `Unit ${unit}` : `Slave #${s.slaveId}`;
                    const addrLabel = formatAnalyzerAddress(s.address, props.addressFormat);
                    detail = `${slaveLabel} | ${String(s.functionKind ?? "").toUpperCase() || "UNKNOWN"} | Addr ${addrLabel}`;
                  }

                  return (
                    <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1" title={s.id}>
                        <div className="inline-flex items-center gap-1.5">
                          <span
                            className={`inline-block h-2 w-2 shrink-0 rounded-full border border-white/10 ${stateDotClass}`}
                            title={stateUpper || "UNKNOWN"}
                            aria-label={stateUpper || "UNKNOWN"}
                          />
                          <div className="truncate font-semibold text-slate-900 dark:text-slate-100">{s.id}</div>
                          <span
                            className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${KIND_BADGE[isCalculated ? "calculated" : "register"]}`}
                          >
                            {isCalculated ? "Calculated" : "Register"}
                          </span>
                        </div>
                        <div className="ml-3 flex items-center gap-1 truncate text-[11px] text-slate-600 dark:text-slate-400">{detail}</div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                          onClick={() => {
                            setSelectedSignalId(s.id);
                            setMode("edit");
                          }}
                          disabled={deleting}
                          title="Edit"
                        >
                          <FiEdit2 className="h-4 w-4" aria-hidden="true" />
                          Edit
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 rounded-lg border border-rose-500/60 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-800 transition hover:border-rose-500/70 hover:text-rose-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-100 dark:hover:border-rose-400 dark:hover:text-rose-50"
                          onClick={() => {
                            setSignalIdToDelete(s.id);
                          }}
                          disabled={deleting}
                          title="Delete"
                          aria-label={`Delete ${s.id}`}
                        >
                          <FiTrash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {blockingDependents.length > 0 ? (
        // Known up front: say why it can't be deleted and offer the fix, instead of a Delete that always fails.
        <ConfirmDialog
          open={signalIdToDelete != null}
          title="Can't delete this signal yet"
          description={
            <div className="text-xs">
              <span className="font-semibold text-slate-900 dark:text-slate-100">{signalToDelete?.id}</span> is an input of{" "}
              {blockingDependents.length === 1 ? "this calculated signal" : "these calculated signals"}:
              <ul className="mt-2 list-disc pl-5 font-semibold text-slate-900 dark:text-slate-100">
                {blockingDependents.map((id) => (
                  <li key={id}>{id}</li>
                ))}
              </ul>
              <div className="mt-2 text-slate-600 dark:text-slate-300">
                Remove it from {blockingDependents.length === 1 ? "that signal's" : "their"} inputs (Math tab), or delete{" "}
                {blockingDependents.length === 1 ? "that signal" : "them"} first.
              </div>
            </div>
          }
          confirmText=""
          cancelText="Close"
          onClose={() => {
            setDeleteError(null);
            setSignalIdToDelete(null);
          }}
          onConfirm={() => {}}
        />
      ) : (
        <ConfirmDialog
          open={signalIdToDelete != null}
          title="Delete signal"
          description={
            <div className="text-xs">
              Delete <span className="font-semibold text-slate-900 dark:text-slate-100">{signalToDelete?.id}</span>?
              <div className="mt-2 text-slate-600 dark:text-slate-300">This will also unlink it from any tiles that reference it.</div>
            </div>
          }
          confirmText={deleting ? "Deleting..." : "Delete"}
          cancelText="Cancel"
          tone="danger"
          busy={deleting}
          error={deleteError}
          onClose={() => {
            if (deleting) return;
            setDeleteError(null);
            setSignalIdToDelete(null);
          }}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}
