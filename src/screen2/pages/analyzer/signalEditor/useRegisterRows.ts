import { useEffect, useRef, useState } from "react";
import { listSlaveRegisterRows, type SlaveRegisterRow } from "../../../api/slaves";

/**
 * Register rows of one slave + function code. `fresh` is true once the rows for the
 * current slave/function have loaded; until then `rows` is empty (no stale options).
 */
export function useRegisterRows(
  workspaceName: string,
  slaveId: number | null,
  functionCode: number,
  onError: (message: string) => void,
): { rows: SlaveRegisterRow[]; fresh: boolean; loadedKey: string | null } {
  const [loaded, setLoaded] = useState<{ key: string; rows: SlaveRegisterRow[] } | null>(null);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (slaveId == null) {
      setLoaded(null);
      return;
    }
    const key = `${slaveId}:${functionCode}`;
    let cancelled = false;
    listSlaveRegisterRows(workspaceName, slaveId, functionCode).then(
      (rows) => {
        if (!cancelled) setLoaded({ key, rows });
      },
      (e: unknown) => {
        if (!cancelled) onErrorRef.current(String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceName, slaveId, functionCode]);

  const key = slaveId == null ? null : `${slaveId}:${functionCode}`;
  const fresh = loaded != null && loaded.key === key;
  return { rows: fresh ? loaded.rows : EMPTY, fresh, loadedKey: loaded?.key ?? null };
}

const EMPTY: SlaveRegisterRow[] = [];
