import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FiClipboard, FiCopy, FiScissors, FiTrash2 } from "react-icons/fi";
import { LuTextSelect } from "react-icons/lu";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

type Pos = { x: number; y: number };
type EditableTarget = HTMLInputElement | HTMLTextAreaElement;

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function isEditableTarget(el: EventTarget | null): el is EditableTarget {
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !el.disabled && !NON_TEXT_INPUT_TYPES.has(el.type);
  }
  if (el instanceof HTMLTextAreaElement) {
    return !el.readOnly && !el.disabled;
  }
  return false;
}

function applyNativeValue(target: EditableTarget, newValue: string, caret: number) {
  // React tracks input values via a hidden tracker, so directly mutating
  // `.value` doesn't trigger onChange. Use the prototype's native setter
  // and dispatch an InputEvent so controlled components stay in sync.
  const proto =
    target instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(target, newValue);
  } else {
    target.value = newValue;
  }
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.setSelectionRange(caret, caret);
}

export default function EditableContextMenu() {
  const [pos, setPos] = useState<Pos | null>(null);
  const [target, setTarget] = useState<EditableTarget | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setPos(null);
    setTarget(null);
  }, []);

  useEffect(() => {
    function onContextMenu(e: MouseEvent) {
      if (!isEditableTarget(e.target)) return;
      e.preventDefault();
      const el = e.target;
      el.focus();
      setTarget(el);
      setPos({ x: e.clientX, y: e.clientY });
    }

    function onDocPointerDown(e: MouseEvent) {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      close();
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }

    function onScroll() {
      close();
    }

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("mousedown", onDocPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("mousedown", onDocPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", close);
    };
  }, [close]);

  if (!pos || !target) return null;

  const start = target.selectionStart ?? 0;
  const end = target.selectionEnd ?? 0;
  const hasSelection = end > start;
  const hasContent = target.value.length > 0;

  async function readClipboard(): Promise<string | null> {
    try {
      return await readText();
    } catch {
      return null;
    }
  }

  async function writeClipboard(text: string): Promise<boolean> {
    try {
      await writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  async function doCopy() {
    if (target && hasSelection) {
      await writeClipboard(target.value.slice(start, end));
    }
    close();
  }

  async function doCut() {
    if (target && hasSelection) {
      const ok = await writeClipboard(target.value.slice(start, end));
      if (ok) {
        applyNativeValue(
          target,
          target.value.slice(0, start) + target.value.slice(end),
          start,
        );
      }
    }
    close();
  }

  async function doPaste() {
    if (!target) {
      close();
      return;
    }
    const text = await readClipboard();
    if (text != null) {
      const next = target.value.slice(0, start) + text + target.value.slice(end);
      applyNativeValue(target, next, start + text.length);
    }
    close();
  }

  function doDelete() {
    if (target && hasSelection) {
      applyNativeValue(
        target,
        target.value.slice(0, start) + target.value.slice(end),
        start,
      );
    }
    close();
  }

  function doSelectAll() {
    if (target) {
      target.focus();
      target.setSelectionRange(0, target.value.length);
    }
    close();
  }

  const items: Array<{
    label: string;
    icon: ReactNode;
    action: () => void | Promise<void>;
    disabled: boolean;
  }> = [
    {
      label: "Cut",
      icon: <FiScissors className="h-3 w-3" aria-hidden="true" />,
      action: doCut,
      disabled: !hasSelection,
    },
    {
      label: "Copy",
      icon: <FiCopy className="h-3 w-3" aria-hidden="true" />,
      action: doCopy,
      disabled: !hasSelection,
    },
    {
      label: "Paste",
      icon: <FiClipboard className="h-3 w-3" aria-hidden="true" />,
      action: doPaste,
      disabled: false,
    },
    {
      label: "Delete",
      icon: <FiTrash2 className="h-3 w-3" aria-hidden="true" />,
      action: doDelete,
      disabled: !hasSelection,
    },
    {
      label: "Select All",
      icon: <LuTextSelect className="h-3 w-3" aria-hidden="true" />,
      action: doSelectAll,
      disabled: !hasContent,
    },
  ];

  // Clamp to viewport so the menu never overflows the window edges.
  const MENU_W = 176;
  const MENU_H = items.length * 30 + 8;
  const left = Math.min(pos.x, window.innerWidth - MENU_W - 4);
  const top = Math.min(pos.y, window.innerHeight - MENU_H - 4);

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-[9999] min-w-44 rounded-lg border border-slate-200 bg-white py-1 text-xs shadow-xl dark:border-slate-700 dark:bg-slate-900"
      style={{ left, top }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-200 dark:hover:bg-slate-800"
          disabled={item.disabled}
          onClick={() => {
            if (!item.disabled) void item.action();
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
