import { useEffect, useMemo, useState } from "react";
import type { AnalyzerSignal, AnalyzerTile, AnalyzerTileSignalInfo } from "../../api/analyzer";
import { parseSignalMath } from "../../utils/analyzerMath";
import { shownValueType } from "../../utils/analyzerSignalEval";
import { mathInputTypes } from "./signalEditor/signalDraft";

type TileKind = "trend" | "value";

type Props = {
  open: boolean;
  mode: "add" | "edit";
  signals: AnalyzerSignal[];
  /** The page's poll interval (calculated signals: the fastest of their inputs). */
  getSignalPollIntervalMs: (signalId: string) => number;
  editingTile: AnalyzerTile | null;
  editingTilePrimary: AnalyzerTileSignalInfo | null;
  initialKind?: TileKind;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (input: {
    kind: TileKind;
    title: string;
    signalId: string;
  }) => void;
};

function normalizeKind(raw: string | null | undefined): TileKind {
  const k = (raw || "").trim().toLowerCase();
  if (k === "trend" || k === "chart") return "trend";
  return "value";
}

function isTextSignal(sig: AnalyzerSignal, signals: AnalyzerSignal[]): boolean {
  if (sig.kind !== "calculated") return shownValueType(sig.decoderJson) === "text";
  try {
    const raw: unknown = JSON.parse(sig.decoderJson);
    const math = parseSignalMath(raw && typeof raw === "object" ? (raw as { math?: unknown }).math : null);
    return shownValueType(sig.decoderJson, math ? mathInputTypes(math, signals) : undefined) === "text";
  } catch {
    return false;
  }
}

export default function AnalyzerAddEditTileModal(props: Props) {
  const [kind, setKind] = useState<TileKind>(props.initialKind ?? "value");
  const [title, setTitle] = useState<string>("");
  const [signalId, setSignalId] = useState<string>("");

  const textSignalIds = useMemo(
    () => new Set(props.signals.filter((s) => isTextSignal(s, props.signals)).map((s) => s.id)),
    [props.signals],
  );

  const defaultSignalId = useMemo(() => props.signals[0]?.id ?? "", [props.signals]);
  const firstNumericId = useMemo(
    () => props.signals.find((s) => !textSignalIds.has(s.id))?.id ?? "",
    [props.signals, textSignalIds],
  );

  useEffect(() => {
    if (!props.open) return;

    if (props.mode === "edit" && props.editingTile) {
      setKind(normalizeKind(props.editingTile.kind));
      setTitle(props.editingTile.title ?? "");
      const primary = props.editingTilePrimary;
      setSignalId(primary?.signalId ?? defaultSignalId);
      return;
    }

    const initial = props.initialKind ?? "value";
    setKind(initial);
    setTitle("");
    setSignalId(initial === "trend" ? firstNumericId : defaultSignalId);
  }, [defaultSignalId, firstNumericId, props.editingTile, props.editingTilePrimary, props.initialKind, props.mode, props.open]);

  const pollIntervalMs = props.getSignalPollIntervalMs(signalId);

  useEffect(() => {
    if (!props.open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !props.busy) {
        e.preventDefault();
        props.onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [props.open, props.busy, props.onClose]);

  if (!props.open) return null;

  const busy = !!props.busy;
  const hasSignals = props.signals.length > 0;
  const noChartableSignal = kind === "trend" && (!firstNumericId || textSignalIds.has(signalId));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="analyzer-tile-modal-title"
        className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="mb-4">
          <div id="analyzer-tile-modal-title" className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            {props.mode === "edit" ? "Edit tile" : "Add tile"}
          </div>
          <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">Configure tile type and signal.</div>
        </div>

        {props.error ? (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
            {props.error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3">
          <div>
            <label htmlFor="analyzer-tile-kind" className="text-xs font-semibold text-slate-700 dark:text-slate-200">Tile type</label>
            <select
              id="analyzer-tile-kind"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
              value={kind}
              onChange={(e) => {
                const next: TileKind = e.currentTarget.value === "trend" ? "trend" : "value";
                setKind(next);
                if (next === "trend" && textSignalIds.has(signalId)) {
                  setSignalId(firstNumericId);
                }
              }}
              disabled={busy}
              title="Tile type"
            >
              <option value="trend">Trend Chart</option>
              <option value="value">Value Tile</option>
            </select>
          </div>

          <div>
            <label htmlFor="analyzer-tile-signal" className="text-xs font-semibold text-slate-700 dark:text-slate-200">Primary signal</label>
            <select
              id="analyzer-tile-signal"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-emerald-500/60"
              value={signalId}
              onChange={(e) => setSignalId(e.currentTarget.value)}
              disabled={busy || !hasSignals}
            >
              {props.signals.length === 0 ? <option value="">No signals</option> : null}
              {props.signals.map((s) => {
                const noChart = kind === "trend" && textSignalIds.has(s.id);
                return (
                  <option key={s.id} value={s.id} disabled={noChart}>
                    {s.id}
                    {s.kind === "calculated" ? " · calculated" : ""}
                    {noChart ? " (text — can't be charted)" : ""}
                  </option>
                );
              })}
            </select>
            {noChartableSignal ? (
              <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                Text values can't be charted — pick a numeric signal or use a Value tile.
              </div>
            ) : null}
          </div>

          <div>
            <label htmlFor="analyzer-tile-title" className="text-xs font-semibold text-slate-700 dark:text-slate-200">Title <span className="text-xs text-slate-500 dark:text-slate-400">(optional)</span></label>
            <input
              id="analyzer-tile-title"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
              placeholder={`${signalId ? `e.g. ${signalId}` : "e.g. the signal name"}`}
              disabled={busy}
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
            Poll interval: <span className="font-semibold text-slate-900 dark:text-slate-100">{pollIntervalMs} ms</span>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
            onClick={props.onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
            onClick={() => {
              const sid = signalId.trim();
              if (!sid) return;
              props.onSubmit({
                kind,
                title: title.trim(),
                signalId: sid,
              });
            }}
            disabled={busy || !hasSignals || !signalId.trim() || (kind === "trend" && textSignalIds.has(signalId))}
          >
            {props.mode === "edit" ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
