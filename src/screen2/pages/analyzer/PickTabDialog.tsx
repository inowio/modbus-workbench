import { useState } from "react";
import ConfirmDialog from "../../../components/ConfirmDialog";
import type { AnalyzerTab } from "../../api/analyzer";
import { sortTabs } from "./tabs";

type Props = {
  mode: "move" | "duplicate";
  tileTitle: string;
  tabs: AnalyzerTab[];
  /** The tile's current tab. */
  currentTabId: number;
  onCancel: () => void;
  onConfirm: (tabId: number) => void;
};

/** Pick the target tab for Move (defaults to the first other tab) or Duplicate (defaults to the current tab). */
export default function PickTabDialog(props: Props) {
  const tabs = sortTabs(props.tabs);
  const move = props.mode === "move";
  const candidates = move ? tabs.filter((t) => t.id !== props.currentTabId) : tabs;
  const fallback = candidates[0]?.id ?? null;
  const [targetId, setTargetId] = useState<number | null>(
    move ? fallback : tabs.some((t) => t.id === props.currentTabId) ? props.currentTabId : fallback,
  );

  return (
    <ConfirmDialog
      open
      title={move ? "Move tile to tab" : "Duplicate tile"}
      confirmText={move ? "Move" : "Duplicate"}
      cancelText="Cancel"
      onClose={props.onCancel}
      onConfirm={() => {
        if (targetId != null) props.onConfirm(targetId);
      }}
      description={
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {move ? "Move" : "Duplicate"} <span className="font-semibold">{props.tileTitle}</span> to
          </span>
          <select
            aria-label="Target tab"
            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 outline-hidden dark:border-slate-700 dark:bg-white/5 dark:text-slate-100"
            value={targetId == null ? "" : String(targetId)}
            onChange={(e) => setTargetId(Number(e.currentTarget.value))}
          >
            {candidates.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      }
    />
  );
}
