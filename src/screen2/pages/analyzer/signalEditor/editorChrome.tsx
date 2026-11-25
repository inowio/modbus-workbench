// Header controls of the signal editor: Data/Math tabs and the Signal kind toggle.
import type { KeyboardEvent } from "react";
import type { SignalKind } from "./signalDraft";

export type EditorTab = "data" | "math";

function ErrorDot() {
  return <span role="img" aria-label="has errors" title="Has errors" className="inline-block h-2 w-2 shrink-0 rounded-full bg-rose-500" />;
}

export function EditorTabs(props: {
  tab: EditorTab;
  onTab: (t: EditorTab) => void;
  mathCount: number;
  dataHasErrors: boolean;
  mathHasErrors: boolean;
}) {
  const { tab, onTab } = props;
  const items: { key: EditorTab; label: string; errors: boolean }[] = [
    { key: "data", label: "Data", errors: props.dataHasErrors },
    { key: "math", label: `Math (${props.mathCount})`, errors: props.mathHasErrors },
  ];
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = tab === "data" ? "math" : "data";
    onTab(next);
    document.getElementById(`signal-editor-tab-${next}`)?.focus();
  };

  return (
    <div role="tablist" aria-label="Signal editor sections" className="inline-flex gap-1 rounded-xl bg-slate-200/60 p-1 dark:bg-slate-800/60" onKeyDown={onKeyDown}>
      {items.map((it) => {
        const active = tab === it.key;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            id={`signal-editor-tab-${it.key}`}
            aria-selected={active}
            aria-controls={`signal-editor-panel-${it.key}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onTab(it.key)}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
              active
                ? "bg-white text-emerald-700 shadow-sm dark:bg-slate-900 dark:text-emerald-300"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            }`}
          >
            {it.label}
            {it.errors ? <ErrorDot /> : null}
          </button>
        );
      })}
    </div>
  );
}

const KIND_OPTIONS: { kind: SignalKind; label: string; hint: string }[] = [
  { kind: "register", label: "Register signal", hint: "Reads one register from a slave" },
  { kind: "calculated", label: "Calculated signal", hint: "Combines other signals with math" },
];

export function KindToggle(props: { kind: SignalKind; onKind: (k: SignalKind) => void; disabled?: boolean }) {
  const { kind, onKind, disabled } = props;
  return (
    <div className="flex items-center gap-2">
      <span id="signal-kind-label" className="text-xs font-semibold text-slate-700 dark:text-slate-200">
        Signal kind
      </span>
      <div role="radiogroup" aria-labelledby="signal-kind-label" className="inline-flex rounded-full border border-slate-300 p-0.5 dark:border-slate-700">
        {KIND_OPTIONS.map((o) => {
          const active = kind === o.kind;
          return (
            <button
              key={o.kind}
              type="button"
              role="radio"
              aria-checked={active}
              title={o.hint}
              disabled={disabled}
              onClick={() => onKind(o.kind)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                active
                  ? "bg-emerald-500/15 text-emerald-800 ring-1 ring-emerald-600/50 dark:text-emerald-200 dark:ring-emerald-500/60"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
