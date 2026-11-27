import { useEffect, useState, type ReactNode } from "react";
import type { MathIssue } from "../../../utils/analyzerMath";

export const FIELD_CLASS =
  "rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60";
export const KEYWORD_CLASS = "text-xs font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400";
export const GHOST_BTN_CLASS =
  "rounded-xl border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-emerald-600/60 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:border-emerald-500/60 dark:hover:text-emerald-300";

export function issueAt(issues: MathIssue[], path: string): string | null {
  return issues.find((i) => i.path === path)?.message ?? null;
}

export function IssueText({ message }: { message: string | null }) {
  if (!message) return null;
  return <span className="text-xs text-red-600 dark:text-red-400">{message}</span>;
}

export function IconButton(props: { label: string; title?: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  const { label, title, disabled, onClick, children } = props;
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      {children}
    </button>
  );
}

/** Number box that keeps what the user is typing and only commits finite numbers. */
export function NumberBox(props: { value: number; onChange: (n: number) => void; ariaLabel: string; className?: string }) {
  const { value, onChange, ariaLabel, className } = props;
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft((d) => (d.trim() !== "" && Number(d) === value ? d : String(value)));
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      className={`${FIELD_CLASS} w-24 ${className ?? ""}`}
      value={draft}
      onChange={(e) => {
        const text = e.currentTarget.value;
        setDraft(text);
        const n = Number(text);
        if (text.trim() !== "" && Number.isFinite(n)) onChange(n);
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}
