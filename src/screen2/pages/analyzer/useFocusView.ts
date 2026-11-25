import { useEffect, useRef, useState } from "react";
import { isWindowFullscreen, onWindowResized, setWindowFullscreen } from "../../utils/windowFullscreen";
import { readCycleSeconds, writeCycleSeconds, type CycleSeconds } from "./tabs";

/**
 * Focus view: hides the app chrome (via `setFocusMode`), optional OS full screen, Esc to exit.
 * Exiting — by Esc, the exit control, or leaving the page — restores the chrome and leaves OS full screen.
 */
export function useFocusView(opts: { setFocusMode?: (on: boolean) => void; onError: (message: string) => void }) {
  const [focus, setFocus] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const focusRef = useRef(false);
  /** The OS state as last requested or observed; read by the exit cleanup and the toggle. */
  const fullscreenRef = useRef(false);
  const setFocusModeRef = useRef(opts.setFocusMode);
  setFocusModeRef.current = opts.setFocusMode;
  const onErrorRef = useRef(opts.onError);
  onErrorRef.current = opts.onError;

  function enter() {
    focusRef.current = true;
    setFocus(true);
  }

  function exit() {
    focusRef.current = false;
    setFocus(false);
    setFullscreen(false);
  }

  async function toggleFullscreen() {
    const next = !fullscreenRef.current;
    try {
      await setWindowFullscreen(next);
    } catch (e) {
      onErrorRef.current(String(e));
      return;
    }
    if (!focusRef.current) {
      // Focus view ended while the request was in flight: don't strand the window in full screen.
      if (next) void setWindowFullscreen(false).catch(() => {});
      return;
    }
    fullscreenRef.current = next;
    setFullscreen(next);
  }

  // Chrome follows focus; the cleanup also runs when the page unmounts (leaving the Analyzer route).
  useEffect(() => {
    if (!focus) return;
    setFocusModeRef.current?.(true);
    return () => {
      focusRef.current = false;
      setFocusModeRef.current?.(false);
      if (fullscreenRef.current) {
        fullscreenRef.current = false;
        void setWindowFullscreen(false).catch((e) => onErrorRef.current(String(e)));
      }
    };
  }, [focus]);

  // The OS can leave full screen by itself (e.g. the Win key): keep the toggle truthful, stay in focus view.
  useEffect(() => {
    if (!focus) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    onWindowResized(() => {
      void isWindowFullscreen()
        .then((on) => {
          if (disposed) return;
          fullscreenRef.current = on;
          setFullscreen(on);
        })
        .catch(() => {});
    })
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
      })
      .catch(() => {
        /* no Tauri window (browser preview): the toggle simply can't be corrected */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [focus]);

  // Registered on window (bubble), so document-level popover/dialog handlers run first; they preventDefault.
  useEffect(() => {
    if (!focus) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A dialog without its own Escape handling still blocks exiting: the user closes it first.
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      exit();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focus]);

  return { focus, enter, exit, fullscreen, toggleFullscreen: () => void toggleFullscreen() };
}

/**
 * Tab cycling for focus view: Off / 10 / 30 / 60 s, remembered per workspace. While `active`, calls
 * `advance` once per period; the period restarts whenever the selected tab changes (manually or by cycling).
 */
export function useTabCycle(opts: {
  workspace: string;
  active: boolean;
  currentTabId: number | null;
  advance: () => void;
}): [CycleSeconds, (s: CycleSeconds) => void] {
  const { workspace, active, currentTabId } = opts;
  const [seconds, setSeconds] = useState<CycleSeconds>(() => readCycleSeconds(workspace));
  const advanceRef = useRef(opts.advance);
  advanceRef.current = opts.advance;

  useEffect(() => {
    setSeconds(readCycleSeconds(workspace));
  }, [workspace]);

  useEffect(() => {
    if (!active || seconds <= 0 || currentTabId == null) return;
    const id = window.setTimeout(() => advanceRef.current(), seconds * 1000);
    return () => window.clearTimeout(id);
  }, [active, seconds, currentTabId]);

  function change(s: CycleSeconds) {
    setSeconds(s);
    writeCycleSeconds(workspace, s);
  }

  return [seconds, change];
}
