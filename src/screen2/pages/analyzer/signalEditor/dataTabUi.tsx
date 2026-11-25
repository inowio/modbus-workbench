// Shared styling for the Data tab (same field look as the old signal editor).

export const FIELD_CLASS =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60";
export const LABEL_CLASS = "text-xs font-semibold text-slate-700 dark:text-slate-200";
export const SECTION_CLASS = "rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40";

export function SectionTitle({ title, caption }: { title: string; caption?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      {caption ? <p className="text-xs text-slate-500 dark:text-slate-400">{caption}</p> : null}
    </div>
  );
}

export function FieldError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <div className="mt-1 text-xs text-rose-800 dark:text-rose-200">{message}</div>;
}
