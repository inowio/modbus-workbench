import { useEffect, useState } from "react";
import { FIELD_CLASS, IssueText } from "./mathUi";

const TONES = {
  variable: "border-emerald-600/40 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-900/30 dark:text-emerald-200",
  input: "border-blue-600/40 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-900/30 dark:text-blue-200",
};

/** Editable name chip. Typing only changes a draft; blur/Enter commits, Esc cancels. */
export default function NameChip(props: { label: string; name: string; onCommit: (to: string) => string | null; tone?: "variable" | "input" }) {
  const { label, name, onCommit, tone = "variable" } = props;
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(name), [name]);

  const commit = () => {
    const err = onCommit(draft);
    setError(err);
    if (err) setDraft(name);
  };

  return (
    <span className="inline-flex flex-col gap-0.5">
      <input
        aria-label={label}
        className={`${FIELD_CLASS} w-32 font-mono font-semibold ${TONES[tone]}`}
        value={draft}
        maxLength={16}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") {
            e.preventDefault(); // cancel the rename only; don't close the editor
            setDraft(name);
            setError(null);
          }
        }}
      />
      <IssueText message={error} />
    </span>
  );
}
