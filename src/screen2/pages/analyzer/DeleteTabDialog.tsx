import { useState } from "react";
import ConfirmDialog from "../../../components/ConfirmDialog";
import type { AnalyzerTab } from "../../api/analyzer";
import { sortTabs } from "./tabs";

type Props = {
  tab: AnalyzerTab;
  tileCount: number;
  otherTabs: AnalyzerTab[];
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (opts: { moveTilesTo?: number; deleteTiles?: boolean }) => void;
};

/** Delete-tab confirm. A tab with tiles needs a choice: move them to another tab (default) or delete them. */
export default function DeleteTabDialog(props: Props) {
  const others = sortTabs(props.otherTabs);
  const [choice, setChoice] = useState<"move" | "delete">(others.length > 0 ? "move" : "delete");
  const [targetId, setTargetId] = useState<number | null>(others[0]?.id ?? null);

  const n = props.tileCount;
  const tilesLabel = `${n} ${n === 1 ? "tile" : "tiles"}`;

  return (
    <ConfirmDialog
      open
      title="Delete tab"
      tone="danger"
      busy={props.busy}
      error={props.error}
      confirmText={props.busy ? "Deleting..." : "Delete tab"}
      cancelText="Cancel"
      onClose={props.onCancel}
      onConfirm={() => {
        if (n === 0) props.onConfirm({});
        else if (choice === "move" && targetId != null) props.onConfirm({ moveTilesTo: targetId });
        else props.onConfirm({ deleteTiles: true });
      }}
      description={
        n === 0 ? (
          <>
            Delete the empty tab <span className="font-semibold">{props.tab.name}</span>?
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <span className="font-semibold">{props.tab.name}</span> has {tilesLabel}. What should happen to{" "}
              {n === 1 ? "it" : "them"}?
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="delete-tab-tiles"
                  checked={choice === "move"}
                  disabled={others.length === 0 || props.busy}
                  onChange={() => setChoice("move")}
                />
                Move {tilesLabel} to
              </label>
              <select
                aria-label="Target tab"
                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 outline-hidden disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100"
                value={targetId == null ? "" : String(targetId)}
                disabled={choice !== "move" || props.busy}
                onChange={(e) => setTargetId(Number(e.currentTarget.value))}
              >
                {others.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="delete-tab-tiles"
                checked={choice === "delete"}
                disabled={props.busy}
                onChange={() => setChoice("delete")}
              />
              Delete {tilesLabel}
            </label>
            <div className="text-slate-500 dark:text-slate-400">Signals are kept either way.</div>
          </div>
        )
      }
    />
  );
}
