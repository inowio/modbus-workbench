import { useEffect, useRef, useState } from "react";
import { FiChevronLeft, FiChevronRight, FiMaximize, FiMinimize, FiPlay, FiRefreshCw, FiX } from "react-icons/fi";
import type { CycleSeconds } from "./tabs";

/** The overlay hides this long after the last mouse move (unless the pointer or *keyboard* focus is on it). */
const HIDE_AFTER_MS = 2000;

const CYCLE_OPTIONS: { value: CycleSeconds; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 10, label: "10 s" },
  { value: 30, label: "30 s" },
  { value: 60, label: "60 s" },
];

type Props = {
  tabName: string;
  pollingWanted: boolean;
  onRun: () => void;
  onStop: () => void;
  onPrev: () => void;
  onNext: () => void;
  cycleSeconds: CycleSeconds;
  onCycleChange: (s: CycleSeconds) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onExit: () => void;
  /** True while the pointer is over the overlay (cycling pauses meanwhile). */
  onHoverChange: (hovering: boolean) => void;
};

const BTN =
  "inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-100 px-2 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600";

/** Thin bar at the top of focus view: shown on mouse move, hidden after 2 s idle. */
export default function AnalyzerFocusOverlay(props: Props) {
  const [visible, setVisible] = useState(true);
  const hoveredRef = useRef(false);
  /** A control holds focus that arrived by keyboard. Focus left behind by a mouse click doesn't pin the bar. */
  const keyboardFocusRef = useRef(false);
  /** The last interaction was a key press (true) or a mouse press (false). */
  const keyboardModalityRef = useRef(false);
  const hideTimerRef = useRef<number | null>(null);
  const onHoverChangeRef = useRef(props.onHoverChange);
  onHoverChangeRef.current = props.onHoverChange;

  function clearHide() {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }

  function show() {
    setVisible(true);
    clearHide();
    if (hoveredRef.current || keyboardFocusRef.current) return;
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setVisible(false);
    }, HIDE_AFTER_MS);
  }

  useEffect(() => {
    // Shown when focus view opens, so the exit control is seen at least once.
    show();
    const onMouseMove = () => show();
    // Clicking focuses buttons (and a select keeps focus after a choice): that focus must not pin the bar.
    const onMouseDown = () => {
      keyboardModalityRef.current = false;
      keyboardFocusRef.current = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      keyboardModalityRef.current = true;
      // Tab brings the hidden bar back for keyboard users.
      if (e.key === "Tab") show();
    };
    window.addEventListener("mousemove", onMouseMove);
    // Capture phase, so it runs before the focus change a click causes.
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      clearHide();
      // Don't leave cycling paused when the overlay goes away under the pointer.
      if (hoveredRef.current) onHoverChangeRef.current(false);
    };
    // show/clearHide only touch refs and a state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="toolbar"
      aria-label="Focus view controls"
      aria-hidden={visible ? undefined : true}
      inert={!visible}
      onMouseEnter={() => {
        hoveredRef.current = true;
        props.onHoverChange(true);
        show();
      }}
      onMouseLeave={() => {
        hoveredRef.current = false;
        props.onHoverChange(false);
        show();
      }}
      onFocus={() => {
        keyboardFocusRef.current = keyboardModalityRef.current;
        show();
      }}
      onBlur={() => {
        keyboardFocusRef.current = false;
        show();
      }}
      className={`fixed inset-x-0 top-0 z-40 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/90 px-3 py-2 shadow-sm backdrop-blur-sm transition duration-200 dark:border-slate-800 dark:bg-slate-900/90 ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-full opacity-0"
      }`}
    >
      <button type="button" className={BTN} onClick={props.onPrev} aria-label="Previous tab" title="Previous tab">
        <FiChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="min-w-0 max-w-[40vw] truncate text-sm font-semibold text-emerald-700 dark:text-emerald-300">
        {props.tabName}
      </span>
      <button type="button" className={BTN} onClick={props.onNext} aria-label="Next tab" title="Next tab">
        <FiChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>

      <div className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />

      <span
        className={`text-xs font-semibold ${props.pollingWanted ? "text-emerald-700 dark:text-emerald-300" : "text-slate-500 dark:text-slate-400"}`}
      >
        {props.pollingWanted ? "Running" : "Stopped"}
      </span>
      {props.pollingWanted ? (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/60 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-800 transition hover:border-rose-500/70 dark:text-rose-100 dark:hover:border-rose-400"
          onClick={props.onStop}
          title="Stop polling"
        >
          <FiRefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
          Stop
        </button>
      ) : (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:border-emerald-500 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400"
          onClick={props.onRun}
          title="Run polling"
        >
          <FiPlay className="h-4 w-4" aria-hidden="true" />
          Run
        </button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <label htmlFor="analyzer-focus-cycle" className="text-xs text-slate-600 dark:text-slate-400">
          Cycle tabs
        </label>
        <select
          id="analyzer-focus-cycle"
          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 outline-hidden transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
          value={String(props.cycleSeconds)}
          onChange={(e) => {
            const n = Number(e.currentTarget.value);
            props.onCycleChange(CYCLE_OPTIONS.find((o) => o.value === n)?.value ?? 0);
          }}
        >
          {CYCLE_OPTIONS.map((o) => (
            <option key={o.value} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={BTN}
          onClick={props.onToggleFullscreen}
          aria-label="Full screen"
          aria-pressed={props.fullscreen}
          title={props.fullscreen ? "Leave full screen" : "Full screen"}
        >
          {props.fullscreen ? (
            <FiMinimize className="h-4 w-4" aria-hidden="true" />
          ) : (
            <FiMaximize className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
        <button type="button" className={BTN} onClick={props.onExit} aria-label="Exit focus view" title="Exit focus view (Esc)">
          <FiX className="h-4 w-4" aria-hidden="true" />
          Exit
        </button>
      </div>
    </div>
  );
}
