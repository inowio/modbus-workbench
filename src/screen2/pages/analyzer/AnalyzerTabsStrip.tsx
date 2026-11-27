import { useEffect, useRef, useState } from "react";
import { FiEdit2, FiMoreVertical, FiPlus, FiTrash2 } from "react-icons/fi";
import type { AnalyzerTab } from "../../api/analyzer";
import { sortTabs, type TabStatus } from "./tabs";

type Props = {
  tabs: AnalyzerTab[];
  selectedTabId: number | null;
  statusByTabId: Record<number, TabStatus>;
  onSelect: (id: number) => void;
  /** Rejects with the backend's message, which is shown under the input. */
  onCreate: (name: string) => Promise<void>;
  /** Rejects with the backend's message, which is shown under the input. */
  onRename: (id: number, name: string) => Promise<void>;
  /** The page reports reorder failures itself. */
  onReorder: (ids: number[]) => Promise<void>;
  onRequestDelete: (id: number) => void;
  /** Blocks add, rename, delete and reorder; switching tabs still works. */
  disabled?: boolean;
};

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Inline tab-name input: Enter or blur commits, Escape cancels; a rejected commit keeps the input open with the error. */
function TabNameInput(props: {
  label: string;
  initialValue: string;
  onCommit: (value: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(props.initialValue);
  const [error, setError] = useState<string | null>(null);
  const committingRef = useRef(false);
  const cancelledRef = useRef(false);
  const failedValueRef = useRef<string | null>(null);

  async function commit(fromBlur: boolean) {
    if (committingRef.current || cancelledRef.current) return;
    const trimmed = value.trim();
    // Blurring away from a failed value shouldn't send the same request again.
    if (fromBlur && failedValueRef.current === trimmed) return;
    committingRef.current = true;
    try {
      await props.onCommit(trimmed);
    } catch (e) {
      failedValueRef.current = trimmed;
      setError(errorText(e));
    } finally {
      committingRef.current = false;
    }
  }

  return (
    <div className="flex flex-col">
      <input
        type="text"
        aria-label={props.label}
        autoFocus
        className={`w-36 rounded-full border bg-white px-3 py-1 text-xs font-semibold text-slate-800 outline-hidden dark:bg-slate-950/60 dark:text-slate-100 ${error ? "border-rose-500/70" : "border-emerald-500/60"}`}
        value={value}
        onChange={(e) => {
          setValue(e.currentTarget.value);
          setError(null);
          failedValueRef.current = null;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit(false);
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancelledRef.current = true;
            props.onCancel();
          }
        }}
        onBlur={() => void commit(true)}
      />
      {error ? (
        <div role="alert" className="mt-1 max-w-56 px-2 text-[11px] text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export default function AnalyzerTabsStrip(props: Props) {
  const ordered = sortTabs(props.tabs);
  const [adding, setAdding] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const dragIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (menuOpenId == null) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-tab-menu-root]") || target?.closest("[data-tab-menu-btn]")) return;
      setMenuOpenId(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setMenuOpenId(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpenId]);

  function startRename(id: number) {
    if (props.disabled) return;
    setMenuOpenId(null);
    setRenamingId(id);
  }

  function dropOn(targetId: number) {
    const dragId = dragIdRef.current;
    dragIdRef.current = null;
    setDropTargetId(null);
    if (dragId == null || dragId === targetId) return;
    const ids = ordered.map((t) => t.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    void props.onReorder(ids).catch(() => {
      /* reported by the page */
    });
  }

  return (
    <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
      <div role="tablist" aria-label="Tile tabs" className="flex flex-wrap items-start gap-2">
        {ordered.map((tab) => {
          const selected = tab.id === props.selectedTabId;
          const status = props.statusByTabId[tab.id] ?? null;

          if (renamingId === tab.id) {
            return (
              <TabNameInput
                key={tab.id}
                label="Rename tab"
                initialValue={tab.name}
                onCancel={() => setRenamingId(null)}
                onCommit={async (name) => {
                  if (name !== "" && name !== tab.name) {
                    await props.onRename(tab.id, name);
                  }
                  setRenamingId(null);
                }}
              />
            );
          }

          return (
            <div
              key={tab.id}
              className={`relative flex items-center rounded-full border text-xs font-semibold transition ${selected
                ? "border-emerald-600/60 bg-emerald-500/10 text-emerald-800 dark:border-emerald-500/60 dark:text-emerald-200"
                : "border-slate-300 bg-slate-100 text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-200 dark:hover:border-slate-600"} ${dropTargetId === tab.id ? "ring-2 ring-emerald-500/50" : ""}`}
              draggable={!props.disabled}
              onDragStart={(e) => {
                if (props.disabled) return;
                dragIdRef.current = tab.id;
                e.dataTransfer?.setData("text/plain", String(tab.id));
                if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (dragIdRef.current == null) return;
                e.preventDefault();
                if (dropTargetId !== tab.id) setDropTargetId(tab.id);
              }}
              onDragLeave={() => {
                if (dropTargetId === tab.id) setDropTargetId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                dropOn(tab.id);
              }}
              onDragEnd={() => {
                dragIdRef.current = null;
                setDropTargetId(null);
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                className="inline-flex items-center gap-1.5 py-1.5 pl-3 pr-1"
                onClick={() => props.onSelect(tab.id)}
                onDoubleClick={() => startRename(tab.id)}
                title={props.disabled ? tab.name : `${tab.name} — double-click to rename, drag to reorder`}
              >
                {tab.name}
                {status === "error" ? (
                  <span role="img" aria-label="has errors" className="inline-block h-2 w-2 rounded-full bg-rose-500" />
                ) : status === "stale" ? (
                  <span role="img" aria-label="stale" className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                ) : null}
              </button>
              <button
                type="button"
                data-tab-menu-btn
                aria-label={`Tab options for ${tab.name}`}
                aria-haspopup="menu"
                aria-expanded={menuOpenId === tab.id}
                disabled={props.disabled}
                className="mr-1 rounded-full p-1 opacity-70 transition hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => setMenuOpenId((prev) => (prev === tab.id ? null : tab.id))}
              >
                <FiMoreVertical className="h-3.5 w-3.5" aria-hidden="true" />
              </button>

              {menuOpenId === tab.id ? (
                <div
                  role="menu"
                  data-tab-menu-root
                  className="absolute left-0 top-full z-50 mt-1 w-36 rounded-xl border border-slate-200 bg-white p-1 font-normal shadow-sm dark:border-slate-700 dark:bg-slate-950/95"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/5"
                    onClick={() => startRename(tab.id)}
                  >
                    <FiEdit2 className="h-4 w-4" aria-hidden="true" />
                    Rename
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={ordered.length <= 1}
                    title={ordered.length <= 1 ? "The last tab can't be deleted" : undefined}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-rose-800 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-200"
                    onClick={() => {
                      setMenuOpenId(null);
                      props.onRequestDelete(tab.id);
                    }}
                  >
                    <FiTrash2 className="h-4 w-4" aria-hidden="true" />
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {adding ? (
        <TabNameInput
          label="New tab name"
          initialValue=""
          onCancel={() => setAdding(false)}
          onCommit={async (name) => {
            if (name !== "") {
              await props.onCreate(name);
            }
            setAdding(false);
          }}
        />
      ) : (
        <button
          type="button"
          aria-label="Add tab"
          title="Add tab"
          disabled={props.disabled}
          className="inline-flex items-center justify-center rounded-full border border-dashed border-slate-300 p-2 text-slate-600 transition hover:border-slate-400 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-slate-100"
          onClick={() => {
            setRenamingId(null);
            setAdding(true);
          }}
        >
          <FiPlus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
