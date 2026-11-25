import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiSave, FiX } from "react-icons/fi";
import {
  upsertAnalyzerSignal,
  type AnalyzerSignal,
  type AnalyzerTile,
  type AnalyzerTileSignalInfo,
} from "../../../api/analyzer";
import type { SlaveItem } from "../../../api/slaves";
import type { MathResult, SignalMath } from "../../../utils/analyzerMath";
import type { SignalEvaluation } from "../../../utils/analyzerSignalEval";
import type { AnalyzerAddressFormat } from "../../../utils/analyzerAddressFormat";
import { chartTilesUsingSignal } from "../signalEvaluations";
import DataTab from "./DataTab";
import MathTab from "./MathTab";
import { EditorTabs, KindToggle, type EditorTab } from "./editorChrome";
import {
  SHOW_REGISTER,
  draftFromSignal,
  draftToUpsert,
  functionCodeLetter,
  functionKindFromFunctionCode,
  sanitizeSignalIdPart,
  suggestCalculatedId,
  transformsChanged,
  validateDraft,
  type SignalDraft,
  type SignalKind,
} from "./signalDraft";
import { useRegisterRows } from "./useRegisterRows";

const BTN_SECONDARY =
  "inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600";
const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100";

const LIVE_BLOCKED_TRANSFORMS = "Live values use the saved Scale/Offset/Clamp/Bit. Save to use them, or type a value.";

/**
 * Keeps Show value on a variable that was renamed in the Math tab (renames keep the index).
 * A calculated signal with nothing picked yet shows its first variable.
 */
function followRename(show: string, prev: SignalMath, next: SignalMath, kind: SignalKind): string {
  if (!show) return kind === "calculated" ? (next.variables[0]?.name ?? "") : show;
  if (show === SHOW_REGISTER) return show;
  if (next.variables.some((v) => v.name === show)) return show;
  const i = prev.variables.findIndex((v) => v.name === show);
  if (i < 0 || prev.variables.length !== next.variables.length) return show;
  return next.variables[i]?.name ?? show;
}

export default function SignalEditorPanel(props: {
  mode: "add" | "edit";
  signal: AnalyzerSignal | null;
  workspaceName: string;
  signals: AnalyzerSignal[];
  slaves: SlaveItem[];
  tiles: AnalyzerTile[];
  tileSignals: Record<number, AnalyzerTileSignalInfo[]>;
  evaluations: Record<string, SignalEvaluation>;
  addressFormat: AnalyzerAddressFormat;
  /** Whether the analyzer is polling right now. */
  polling: boolean;
  onCancel: () => void;
  /** May return a promise; Save stays busy until it settles. */
  onSaved: (id: string) => void | Promise<void>;
  onError: (m: string) => void;
}) {
  const { mode, signal, workspaceName, signals, slaves, evaluations, onCancel, onSaved, onError } = props;
  const editing = mode === "edit" && signal != null;

  const freshDraft = useCallback(
    (kind: SignalKind): SignalDraft => {
      if (editing) return draftFromSignal(signal, signal.kind);
      const d = draftFromSignal(null, kind);
      if (kind === "register") d.slaveId = slaves[0]?.id ?? null;
      else d.id = suggestCalculatedId(signals.map((s) => s.id));
      return d;
    },
    [editing, signal, slaves, signals],
  );

  const [draft, setDraft] = useState<SignalDraft>(() => freshDraft("register"));
  const [tab, setTab] = useState<EditorTab>("data");
  const [results, setResults] = useState<Record<string, MathResult>>({});
  const [resultsFromLive, setResultsFromLive] = useState(false);
  const [registerSample, setRegisterSample] = useState<MathResult | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [resetCount, setResetCount] = useState(0);
  const idManuallyEditedRef = useRef(false);

  const patch = useCallback((p: Partial<SignalDraft>) => setDraft((d) => ({ ...d, ...p })), []);
  const isRegister = draft.kind === "register";

  // Slaves can arrive after the editor opened: fill in the first one for a new register signal.
  useEffect(() => {
    if (mode !== "add" || !isRegister || draft.slaveId != null || slaves.length === 0) return;
    patch({ slaveId: slaves[0].id });
  }, [mode, isRegister, draft.slaveId, slaves, patch]);

  const { rows, fresh, loadedKey } = useRegisterRows(workspaceName, isRegister ? draft.slaveId : null, draft.functionCode, onError);

  // Keep the selected register row valid for the loaded rows (first row by default).
  useEffect(() => {
    if (!fresh) return;
    setDraft((d) => {
      const keep = d.registerRowId != null && rows.some((r) => r.id === d.registerRowId);
      const next = keep ? d.registerRowId : (rows[0]?.id ?? null);
      return next === d.registerRowId ? d : { ...d, registerRowId: next };
    });
  }, [fresh, rows, draft.registerRowId]);

  // Signal ID auto-suggest for new register signals: alias_unit_letter_address.
  const slave = draft.slaveId != null ? (slaves.find((s) => s.id === draft.slaveId) ?? null) : null;
  const row = draft.registerRowId != null ? (rows.find((r) => r.id === draft.registerRowId) ?? null) : null;
  const suggestedId = useMemo(() => {
    if (mode !== "add" || !isRegister || !slave || !row) return null;
    const alias = row.alias?.trim() ?? "";
    const letter = functionCodeLetter(draft.functionCode);
    const aliasPart = sanitizeSignalIdPart(alias);
    if (!alias || !letter || !aliasPart) return null;
    return `${aliasPart}_${slave.unitId}_${letter}_${row.address}`;
  }, [mode, isRegister, slave, row, draft.functionCode]);

  useEffect(() => {
    if (mode !== "add" || !isRegister || idManuallyEditedRef.current) return;
    patch({ id: suggestedId ?? "" });
  }, [mode, isRegister, suggestedId, patch, resetCount]);

  const signalIdPlaceholder =
    mode === "add" && isRegister
      ? `e.g. name_${slave?.unitId ?? "X"}_${functionCodeLetter(draft.functionCode) ?? "IN"}_${row ? row.address : 0}`
      : mode === "add"
        ? "e.g. Calc_1"
        : "";

  const savedDisplay = useMemo(() => (editing ? draftFromSignal(signal, signal.kind) : null), [editing, signal]);

  const chartTiles = useMemo(
    () => (editing ? chartTilesUsingSignal(signal.id, props.tiles, props.tileSignals) : []),
    [editing, signal, props.tiles, props.tileSignals],
  );

  const validation = useMemo(
    () => validateDraft(draft, { signals, mode, chartTiles, registerRows: rows, slaves, addressFormat: props.addressFormat }),
    [draft, signals, mode, chartTiles, rows, slaves, props.addressFormat],
  );
  const canSave = validation.ok && !saving;

  const setKind = (kind: SignalKind) => {
    if (kind === draft.kind) return;
    setDraft((d) => {
      const next = freshDraft(kind);
      const keepsShow = d.show && d.show !== SHOW_REGISTER && d.math.variables.some((v) => v.name === d.show);
      return {
        ...next,
        id: idManuallyEditedRef.current ? d.id : next.id,
        unit: d.unit,
        decimals: d.decimals,
        // Inputs exist only on calculated signals; a register signal must not keep (or save) them.
        math: kind === "register" ? { ...d.math, inputs: [] } : d.math,
        show: keepsShow ? d.show : kind === "calculated" ? (d.math.variables[0]?.name ?? next.show) : next.show,
      };
    });
    setResults({});
    setResultsFromLive(false);
    setRegisterSample(undefined);
  };

  const reset = () => {
    idManuallyEditedRef.current = false;
    setDraft(freshDraft(draft.kind));
    setSaveError(null);
    setResetCount((n) => n + 1);
  };

  const onMathChange = useCallback(
    (math: SignalMath) => setDraft((d) => ({ ...d, math, show: followRename(d.show, d.math, math, d.kind) })),
    [],
  );
  const onResults = useCallback((r: Record<string, MathResult>, fromLive: boolean) => {
    setResults(r);
    setResultsFromLive(fromLive);
  }, []);
  const liveBlockedReason = isRegister && transformsChanged(draft, savedDisplay) ? LIVE_BLOCKED_TRANSFORMS : null;

  const savingRef = useRef(false);
  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented || savingRef.current) return;
      e.preventDefault();
      onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  async function save() {
    if (!canSave) return;
    if (isRegister) {
      const problem = !functionKindFromFunctionCode(draft.functionCode)
        ? "Unsupported function code for Analyzer signals"
        : !slaves.some((s) => s.id === draft.slaveId)
          ? "Slave not found"
          : null;
      if (problem) {
        setSaveError(problem);
        onError(problem);
        return;
      }
    }
    const id = editing ? signal.id : validation.normalizedId;
    setSaving(true);
    setSaveError(null);
    try {
      await upsertAnalyzerSignal(workspaceName, draftToUpsert({ ...draft, id }));
      await onSaved(id);
    } catch (e) {
      const message = String(e);
      setSaveError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  }

  const subtitle = isRegister
    ? `Register signal${slave ? ` · ${slave.name} (Unit ${slave.unitId})` : ""}${row ? ` · ${(functionKindFromFunctionCode(draft.functionCode) ?? "").toUpperCase()} · ${row.alias?.trim() || `Address ${row.address}`}` : ""}`
    : `Calculated signal${draft.math.inputs.length ? ` · Inputs: ${draft.math.inputs.map((i) => i.signalId).join(", ")}` : ""}`;

  const footerHint = validation.blocking
    ? null
    : !validation.ok
      ? `Fix the items marked on the ${[validation.byTab.data.length ? "Data" : null, validation.byTab.math.length ? "Math" : null].filter(Boolean).join(" and ")} tab to enable Save.`
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="analyzer-signal-editor-title"
        className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <header className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-slate-50/70 px-6 py-4 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="analyzer-signal-editor-title" className="truncate text-base font-semibold text-emerald-700 dark:text-emerald-400">
                {editing ? `Edit signal · ${signal.id}` : "New signal"}
              </h2>
              <div className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-400">{subtitle}</div>
            </div>
            <button type="button" className={`${BTN_SECONDARY} px-2`} onClick={onCancel} disabled={saving} title="Close" aria-label="Close">
              <FiX className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <EditorTabs
              tab={tab}
              onTab={setTab}
              mathCount={draft.math.variables.length}
              dataHasErrors={validation.byTab.data.length > 0}
              mathHasErrors={validation.byTab.math.length > 0}
            />
            {mode === "add" ? <KindToggle kind={draft.kind} onKind={setKind} disabled={saving} /> : null}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div role="tabpanel" id="signal-editor-panel-data" aria-labelledby="signal-editor-tab-data" hidden={tab !== "data"}>
            <DataTab
              mode={mode}
              draft={draft}
              onChange={patch}
              onSignalIdInput={(value) => {
                if (mode === "add") idManuallyEditedRef.current = true;
                patch({ id: value });
              }}
              signalIdPlaceholder={signalIdPlaceholder}
              fields={validation.fields}
              rows={rows}
              rowsLoadedKey={loadedKey}
              slaves={slaves}
              addressFormat={props.addressFormat}
              results={results}
              registerSample={registerSample}
              saved={savedDisplay}
              live={editing ? evaluations[signal.id] : undefined}
              resultsFromLive={resultsFromLive}
              polling={props.polling}
              unitKey={`${signal?.id ?? "new"}:${resetCount}`}
              disabled={saving}
            />
          </div>
          <div role="tabpanel" id="signal-editor-panel-math" aria-labelledby="signal-editor-tab-math" hidden={tab !== "math"}>
            <MathTab
              key={`${draft.kind}:${resetCount}`}
              kind={draft.kind}
              math={draft.math}
              onChange={onMathChange}
              signals={signals}
              evaluations={evaluations}
              selfSignalId={editing ? signal.id : null}
              issues={validation.byTab.math}
              onResults={onResults}
              onRegisterSample={setRegisterSample}
              polling={props.polling}
              liveBlockedReason={liveBlockedReason}
            />
          </div>
        </div>

        <footer className="flex shrink-0 flex-col gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          {validation.blocking ? (
            <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
              {validation.blocking}
            </div>
          ) : null}
          {saveError ? (
            <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
              {saveError}
            </div>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="button" className={`${BTN_SECONDARY} sm:mr-auto`} onClick={reset} disabled={saving} title="Reset">
              Reset
            </button>
            {footerHint ? <div className="text-xs text-slate-600 dark:text-slate-400">{footerHint}</div> : null}
            <button type="button" className={BTN_SECONDARY} onClick={onCancel} disabled={saving} title="Close">
              Cancel
            </button>
            <button type="button" className={BTN_PRIMARY} onClick={() => void save()} disabled={!canSave} title="Save">
              <FiSave className="h-4 w-4" aria-hidden="true" />
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
