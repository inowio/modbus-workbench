import type { ReactNode } from "react";
import { FiLink, FiMaximize, FiPlay, FiPlus, FiRefreshCw, FiSettings } from "react-icons/fi";
import { RiLayout4Line } from "react-icons/ri";

type Props = {
  loading: boolean;
  trendWindowMinutes: number | null;
  onChangeTrendWindowMinutes: (next: number | null) => void;
  pollingWanted: boolean;
  onRun: () => void;
  onStop: () => void;
  onConfigureSignals: () => void;
  onOpenConnectionSettings: () => void;
  onAddTile: () => void;
  layoutEditMode: boolean;
  onToggleLayoutEditMode: () => void;
  onRefresh: () => void;
  onEnterFocus: () => void;
  /** Slot for the tabs strip, rendered below the button row. */
  children?: ReactNode;
};

const BTN =
  "inline-flex items-center gap-2 rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600";

function Divider() {
  return <div className="hidden h-6 w-px bg-slate-200 dark:bg-slate-700 sm:block" aria-hidden="true" />;
}

export default function AnalyzerControlBar(props: Props) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-inner shadow-black/5 dark:border-slate-800/70 dark:bg-slate-900/60 dark:shadow-black/30">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="mr-1 text-sm font-semibold uppercase tracking-[0.35em] text-emerald-700 dark:font-normal dark:text-emerald-300">
          Analyzer
        </p>

        <div className="flex items-center gap-2">
          <label htmlFor="analyzer-trend-window" className="text-xs text-slate-600 dark:text-slate-400">
            Trends
          </label>
          <select
            id="analyzer-trend-window"
            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 outline-hidden transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
            value={props.trendWindowMinutes == null ? "all" : String(props.trendWindowMinutes)}
            onChange={(e) => {
              const v = e.currentTarget.value;
              if (v === "all") {
                props.onChangeTrendWindowMinutes(null);
                return;
              }
              const n = Number(v);
              props.onChangeTrendWindowMinutes(Number.isFinite(n) && n > 0 ? n : 10);
            }}
            title="Trend history window"
          >
            <option value="1">Last 1 min</option>
            <option value="5">Last 5 min</option>
            <option value="10">Last 10 min</option>
            <option value="30">Last 30 min</option>
            <option value="60">Last 60 min</option>
            <option value="all">All</option>
          </select>
        </div>

        <Divider />

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN} onClick={props.onConfigureSignals} title="Configure Signals">
            <FiSettings className="h-4 w-4" aria-hidden="true" />
            Signals
          </button>
          <button type="button" className={BTN} onClick={props.onOpenConnectionSettings} title="Connection Settings">
            <FiLink className="h-4 w-4" aria-hidden="true" />
            Connection
          </button>
        </div>

        <Divider />

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN} onClick={props.onAddTile} title="Add Tile">
            <FiPlus className="h-4 w-4" aria-hidden="true" />
            Tile
          </button>
          <button
            type="button"
            className={`inline-flex items-center justify-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ${props.layoutEditMode
              ? "border-amber-500/40 bg-amber-500/10 text-amber-800 hover:border-amber-500/60 dark:text-amber-200 dark:hover:border-amber-400/60"
              : "border-slate-300 bg-slate-100 text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-200 dark:hover:border-slate-600"}`}
            onClick={props.onToggleLayoutEditMode}
            title="Toggle layout edit mode"
          >
            <RiLayout4Line className="h-4 w-4" aria-hidden="true" />
            {props.layoutEditMode ? "Done" : "Edit layout"}
          </button>
          <button
            type="button"
            className={`${BTN} px-2`}
            onClick={props.onRefresh}
            aria-label="Refresh"
            title="Refresh"
          >
            <FiRefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button type="button" className={`${BTN} px-2`} onClick={props.onEnterFocus} aria-label="Focus view" title="Focus view">
            <FiMaximize className="h-4 w-4" aria-hidden="true" />
          </button>
          {props.pollingWanted ? (
            <button
              type="button"
              className="inline-flex w-20 items-center justify-center gap-2 rounded-full border border-rose-500/60 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-800 transition hover:border-rose-500/70 hover:text-rose-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-100 dark:hover:border-rose-400 dark:hover:text-rose-50"
              onClick={props.onStop}
              title="Stop polling"
            >
              <FiRefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex w-20 items-center justify-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
              onClick={props.onRun}
              title="Run polling"
            >
              <FiPlay className="h-4 w-4" aria-hidden="true" />
              Run
            </button>
          )}
        </div>
      </div>

      {props.children}
    </div>
  );
}
