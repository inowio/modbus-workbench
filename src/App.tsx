import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

import Screen2Layout from "./screen2/Screen2Layout";
import AboutPage from "./screen2/pages/AboutPage";
import AnalyzerPage from "./screen2/pages/AnalyzerPage";
import ConnectionPage from "./screen2/pages/ConnectionPage";
import ClientPage from "./screen2/pages/ClientPage";
import SlaveDetailPage from "./screen2/pages/SlaveDetailPage";
import SlavesPage from "./screen2/pages/SlavesPage";
import WorkspacePage from "./screen2/pages/WorkspacePage";
import WorkspaceScreen, { Workspace } from "./screens/WorkspaceScreen";
import UpdateDialog from "./components/UpdateDialog";
import { checkForUpdate, installAndRelaunch } from "./screen2/api/updater";
import type { Update } from "@tauri-apps/plugin-updater";

function WorkspaceRoute() {
  const navigate = useNavigate();

  return (
    <WorkspaceScreen
      onOpen={(ws: Workspace) =>
        navigate(`/app/${encodeURIComponent(ws.name)}/workspace`)
      }
    />
  );
}

type UpdatePrompt = {
  version: string;
  currentVersion: string;
  notes: string | null;
  update: Update;
};

function App() {
  const [updatePrompt, setUpdatePrompt] = useState<UpdatePrompt | null>(null);
  const checkedOnceRef = useRef(false);

  // Run the silent startup update check exactly once per process. The Tauri
  // updater plugin is not available in the browser dev server / test runner,
  // so failures (including module-load errors) are swallowed silently here —
  // the manual "Check for updates" button on the About page surfaces errors
  // when the user explicitly asks.
  useEffect(() => {
    if (checkedOnceRef.current) return;
    checkedOnceRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const result = await checkForUpdate();
        if (cancelled) return;
        if (result.status === "available") {
          setUpdatePrompt({
            version: result.version,
            currentVersion: result.currentVersion,
            notes: result.notes,
            update: result.update,
          });
        }
      } catch {
        // Silent on startup; manual check surfaces errors.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Routes>
        <Route path="/" element={<WorkspaceRoute />} />

        <Route path="/app/:workspaceName" element={<Screen2Layout />}>
          <Route index element={<Navigate to="workspace" replace />} />
          <Route path="workspace" element={<WorkspacePage />} />
          <Route path="analyzer" element={<AnalyzerPage />} />
          <Route path="connection" element={<ConnectionPage />} />
          <Route path="client" element={<ClientPage />} />
          <Route path="slaves" element={<SlavesPage />} />
          <Route path="slaves/:slaveId" element={<SlaveDetailPage />} />
          <Route path="about" element={<AboutPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {updatePrompt ? (
        <UpdateDialog
          open
          version={updatePrompt.version}
          currentVersion={updatePrompt.currentVersion}
          notes={updatePrompt.notes}
          install={(onProgress) => installAndRelaunch(updatePrompt.update, onProgress)}
          onClose={() => setUpdatePrompt(null)}
        />
      ) : null}
    </>
  );
}

export default App;
