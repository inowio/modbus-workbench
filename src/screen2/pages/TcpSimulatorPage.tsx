import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiDownload, FiTrash2, FiUpload, FiX } from "react-icons/fi";
import { useOutletContext } from "react-router-dom";

import type { Screen2OutletContext } from "../Screen2Layout";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useToast } from "../../components/ToastProvider";
import AddDeviceModal from "../components/AddDeviceModal";
import TemplateEditorModal from "../components/TemplateEditorModal";
import type { DeviceTemplate } from "../components/AddDeviceModal";
import SimRuleModal, { type SimRule } from "../components/SimRuleModal";
import ActivityTab from "../simulator/ActivityTab";
import DevicesTab from "../simulator/DevicesTab";
import LiveValuesTab from "../simulator/LiveValuesTab";
import PromptDialog from "../simulator/PromptDialog";
import LiveRegisterInspector from "../simulator/LiveRegisterInspector";
import RegistersTab from "../simulator/RegistersTab";
import RulesTab from "../simulator/RulesTab";
import SimFooterBar from "../simulator/SimFooterBar";
import { fmtAddr } from "../simulator/ruleTargets";
import { blankRegister } from "../simulator/simRegister";
import SimStatusDashboard from "../simulator/SimStatusDashboard";
import SimTabBar, { type TabKey } from "../simulator/SimTabBar";
import { useSimulatorData, type PageRegister, type SimDevice } from "../simulator/useSimulatorData";
import { useAppAddressFormat } from "../utils/addressFormatPref";

const TAB_KEY = (ws: string) => `sim.tab.${ws}`;
function readTab(ws: string): TabKey {
  const v = window.localStorage.getItem(TAB_KEY(ws));
  return v === "devices" || v === "rules" || v === "live" || v === "activity" ? v : "registers";
}
function writeTab(ws: string, tab: TabKey) {
  try { window.localStorage.setItem(TAB_KEY(ws), tab); } catch { /* ignore */ }
}

// Turn raw backend/SQLite errors into something a user can act on. Unknown
// errors pass through unchanged so we never hide real diagnostics.
function humanizeError(raw: string): string {
  const msg = raw.replace(/^Error:\s*/i, "");
  if (/UNIQUE constraint failed/i.test(msg)) {
    return "A register already exists at that unit and address. Pick a different address or unit.";
  }
  if (/would overlap existing register/i.test(msg)) {
    return "This device or register would overlap addresses already in use. Choose a different base address or unit.";
  }
  if (/address .* out of range/i.test(msg)) {
    return "Address is out of range (0–65535).";
  }
  if (/port/i.test(msg) && /(in use|address already|bind)/i.test(msg)) {
    return "That port is already in use. Stop the other server or choose a different port.";
  }
  return msg;
}

export default function TcpSimulatorPage() {
  const { workspace } = useOutletContext<Screen2OutletContext>();
  const ws = workspace.name;
  const sim = useSimulatorData(ws);
  const { pushToast } = useToast();

  const [activeTab, setActiveTab] = useState<TabKey>(() => readTab(ws));
  const [addrFmt, changeAddrFmt] = useAppAddressFormat();
  const [selectedRegisterId, setSelectedRegisterId] = useState<number | null>(null);
  // Blank "New register" draft shown in the inspector panel (null = none).
  const [draft, setDraft] = useState<PageRegister | null>(null);
  // Address of a just-created register to select once the reload lands.
  const [pendingSelect, setPendingSelect] = useState<{ unitId: number; functionCode: number; address: number } | null>(null);
  // True once Create was pressed on the draft: only then does a page error belong in the panel.
  const [draftCreateTried, setDraftCreateTried] = useState(false);
  const [inspectorDirty, setInspectorDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<{ run: () => void; label: string } | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [modalRule, setModalRule] = useState<SimRule | null>(null);
  const [deviceEdit, setDeviceEdit] = useState<{ kind: "rename" | "rebase"; device: SimDevice } | null>(null);
  const [confirmDeleteDevice, setConfirmDeleteDevice] = useState<SimDevice | null>(null);
  const [confirmDeleteRule, setConfirmDeleteRule] = useState<SimRule | null>(null);
  const [confirmDeleteRegister, setConfirmDeleteRegister] = useState<PageRegister | null>(null);
  // Pre-filled draft for "Save as virtual device" (null = closed). Opens the full
  // template editor so the layout is visible and the key is clash-guarded.
  const [saveTemplateDraft, setSaveTemplateDraft] = useState<DeviceTemplate | null>(null);

  // While a save dialog is open its own error shows inside it, not in the page banner.
  const draftOwnsError = draft !== null && draftCreateTried;
  const dialogOpen = draftOwnsError || deviceModalOpen || ruleModalOpen;
  const dialogError = sim.error ? humanizeError(sim.error) : null;
  const { setError: setSimError } = sim;
  const openDialog = useCallback((open: () => void) => { setSimError(null); open(); }, [setSimError]);
  const closeDialog = useCallback((close: () => void) => { setSimError(null); close(); }, [setSimError]);

  // Run `run` now, or after the user confirms discarding unsaved inspector edits.
  const guardDiscard = useCallback((run: () => void, label: string) => {
    if (inspectorDirty) setPendingNav({ run, label });
    else run();
  }, [inspectorDirty]);

  const applyTab = useCallback((tab: TabKey) => { setActiveTab(tab); writeTab(ws, tab); }, [ws]);
  const selectedRegister = useMemo<PageRegister | null>(
    () => sim.registers.find((r) => r.id === selectedRegisterId) ?? null,
    [sim.registers, selectedRegisterId],
  );
  const inspectorRegister = draft ?? selectedRegister;
  const inspectorLabel = draft
    ? "the new register"
    : selectedRegister
      ? (selectedRegister.alias?.trim() || `unit ${selectedRegister.unitId} address ${fmtAddr(selectedRegister.address, addrFmt)}`)
      : "this register";
  const changeTab = useCallback((tab: TabKey) => {
    if (tab === activeTab) return;
    guardDiscard(() => applyTab(tab), inspectorLabel);
  }, [activeTab, guardDiscard, applyTab, inspectorLabel]);

  // The draft's own address is "taken" by the register it just created for one
  // render (before the panel swaps to it); hide that match so no false alert flashes.
  const inspectorRegisters = useMemo(
    () => !pendingSelect ? sim.registers : sim.registers.filter((r) => !(
      r.unitId === pendingSelect.unitId && r.functionCode === pendingSelect.functionCode && r.address === pendingSelect.address
    )),
    [sim.registers, pendingSelect],
  );

  // Draft ended: forget that Create was tried.
  useEffect(() => { if (!draft) setDraftCreateTried(false); }, [draft]);

  // Below lg the inspector is a drawer: move focus into it when it opens.
  const inspectorWrapRef = useRef<HTMLDivElement>(null);
  const inspectorOpen = activeTab === "registers" && inspectorRegister !== null;
  useEffect(() => {
    if (!inspectorOpen) return;
    const narrow = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 1023.98px)").matches;
    if (!narrow) return;
    inspectorWrapRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )?.focus();
  }, [inspectorOpen]);

  // After a successful Create, switch the panel to editing the new register.
  useEffect(() => {
    if (!pendingSelect) return;
    const created = sim.registers.find(
      (r) => r.unitId === pendingSelect.unitId && r.functionCode === pendingSelect.functionCode && r.address === pendingSelect.address,
    );
    if (!created) return;
    setSelectedRegisterId(created.id);
    setDraft(null);
    setPendingSelect(null);
  }, [pendingSelect, sim.registers]);

  const closeInspector = useCallback(() => {
    guardDiscard(() => { setDraft(null); setSelectedRegisterId(null); setSimError(null); }, inspectorLabel);
  }, [guardDiscard, inspectorLabel, setSimError]);

  const selectRegister = useCallback((r: PageRegister) => {
    if (!draft && r.id === selectedRegisterId) return;
    guardDiscard(() => { setDraft(null); setSimError(null); setSelectedRegisterId(r.id); }, inspectorLabel);
  }, [draft, selectedRegisterId, guardDiscard, inspectorLabel, setSimError]);

  const startNewRegister = useCallback(() => {
    if (draft) return;
    guardDiscard(() => { setSimError(null); setSelectedRegisterId(null); setDraft(blankRegister(sim.registers)); }, inspectorLabel);
  }, [draft, guardDiscard, inspectorLabel, setSimError, sim.registers]);

  const createRegister = useCallback(async (reg: PageRegister): Promise<boolean> => {
    setSimError(null);
    setDraftCreateTried(true);
    // Mark the pending address up-front so the panel never sees the new register
    // as a conflict with its own draft while the reload lands.
    setPendingSelect({ unitId: reg.unitId, functionCode: reg.functionCode, address: reg.address });
    const ok = await sim.addRegister(reg);
    if (!ok) setPendingSelect(null);
    return ok;
  }, [sim, setSimError]);

  const deleteRegister = useCallback(async (id: number) => {
    await sim.deleteRegister(id);
    if (selectedRegisterId === id) setSelectedRegisterId(null);
  }, [sim, selectedRegisterId]);

  const handleRename = useCallback((device: SimDevice) => setDeviceEdit({ kind: "rename", device }), []);
  const handleRebase = useCallback((device: SimDevice) => setDeviceEdit({ kind: "rebase", device }), []);

  const handleSaveAsTemplate = useCallback(async (device: SimDevice) => {
    const draft = await sim.buildDeviceTemplate(device.id, device.name);
    if (draft) setSaveTemplateDraft(draft);
  }, [sim]);

  const handleExportProfile = useCallback(() => { void sim.exportProfile(); }, [sim]);

  const handleImportProfile = useCallback(() => {
    if (sim.status.running) {
      sim.setError("Stop the simulator before importing a profile.");
      return;
    }
    void sim.importProfile();
  }, [sim]);

  const counts: Partial<Record<TabKey, number>> = {
    registers: sim.registers.length,
    devices: sim.devices.length,
    rules: sim.rules.length,
  };

  return (
    <div className="flex min-h-full flex-1 flex-col gap-4 px-3 sm:px-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-emerald-700 dark:font-normal dark:text-emerald-300">TCP Simulator</p>
          <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">Expose devices (including TCP & RTU) and registers as a Modbus TCP server for external clients.</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExportProfile()}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-200"
          >
            <FiUpload className="h-3.5 w-3.5" aria-hidden="true" /> Export Profile
          </button>
          <button
            type="button"
            onClick={() => void handleImportProfile()}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-200"
          >
            <FiDownload className="h-3.5 w-3.5" aria-hidden="true" /> Import Profile
          </button>
        </div>
      </div>

      {sim.error && !dialogOpen ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          <span>{humanizeError(sim.error)}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            title="Dismiss"
            onClick={() => sim.setError(null)}
            className="shrink-0 rounded-md p-0.5 text-rose-600 transition hover:bg-rose-500/15 dark:text-rose-300"
          >
            <FiX className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <SimStatusDashboard
        config={sim.config}
        status={sim.status}
        listen={sim.listen}
        busy={sim.busy}
        onStart={() => void sim.start()}
        onStop={() => void sim.stop()}
        onSaveConfig={(patch) => sim.saveConfig(patch)}
        onChangeExpose={(host) => void sim.saveConfig({ host })}
        onChangePort={(port) => sim.saveConfig({ port })}
        onRefresh={() => void sim.reload()}
        registerCount={sim.registers.length}
        unitCount={new Set(sim.registers.map((r) => r.unitId)).size}
        deviceCount={sim.devices.length}
      />

      <SimTabBar active={activeTab} onChange={changeTab} counts={counts} />

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          {activeTab === "registers" ? (
            <RegistersTab
              ws={ws}
              registers={sim.registers}
              devices={sim.devices}
              status={sim.status}
              live={sim.live}
              addrFmt={addrFmt}
              onAddrFmt={changeAddrFmt}
              selectedId={selectedRegister?.id ?? null}
              onSelectRegister={selectRegister}
              onDelete={(id) => setConfirmDeleteRegister(sim.registers.find((r) => r.id === id) ?? null)}
              onAddRegister={startNewRegister}
              onAddDevice={() => openDialog(() => setDeviceModalOpen(true))}
            />
          ) : null}

          {activeTab === "devices" ? (
            <DevicesTab
              devices={sim.devices}
              registers={sim.registers}
              templates={sim.deviceTemplates}
              addrFmt={addrFmt}
              onAddDevice={() => openDialog(() => setDeviceModalOpen(true))}
              onRename={handleRename}
              onRebase={handleRebase}
              onDelete={(device) => setConfirmDeleteDevice(device)}
              onSaveAsTemplate={(device) => void handleSaveAsTemplate(device)}
            />
          ) : null}

          {activeTab === "rules" ? (
            <RulesTab
              rules={sim.rules}
              devices={sim.devices}
              registers={sim.registers}
              addrFmt={addrFmt}
              onAdd={() => openDialog(() => { setModalRule(null); setRuleModalOpen(true); })}
              onEdit={(rule) => openDialog(() => { setModalRule(rule); setRuleModalOpen(true); })}
              onToggle={(rule, enabled) => void sim.updateRule({ ...rule, enabled })}
              onDelete={(id) => setConfirmDeleteRule(sim.rules.find((r) => r.id === id) ?? null)}
            />
          ) : null}

          {activeTab === "live" ? (
            <LiveValuesTab registers={sim.registers} live={sim.live} status={sim.status} addrFmt={addrFmt} onStart={() => void sim.start()} busy={sim.busy} />
          ) : null}

          {activeTab === "activity" ? (
            <ActivityTab status={sim.status} events={sim.events} />
          ) : null}
        </div>

        {activeTab === "registers" && inspectorRegister ? (
          <>
            {/* Below lg the inspector is a right-side drawer; the backdrop closes it. */}
            <div
              data-testid="inspector-backdrop"
              aria-hidden="true"
              onClick={closeInspector}
              className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden"
            />
            <div ref={inspectorWrapRef} className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col rounded-l-2xl bg-white shadow-2xl dark:bg-slate-900 lg:static lg:z-auto lg:block lg:w-96 lg:max-w-none lg:shrink-0 lg:self-start lg:rounded-none lg:bg-transparent lg:pb-2 lg:shadow-none dark:lg:bg-transparent lg:sticky lg:inset-auto lg:top-0">
              <LiveRegisterInspector
                live={sim.live}
                selected={selectedRegister}
                register={inspectorRegister}
                devices={sim.devices}
                registers={inspectorRegisters}
                addrFmt={addrFmt}
                running={sim.status.running}
                error={draftOwnsError ? dialogError : null}
                onSave={(reg) => sim.updateRegister(reg)}
                onCreate={createRegister}
                onDuplicate={(reg) => void sim.duplicateRegister(reg)}
                onDelete={(id) => setConfirmDeleteRegister(sim.registers.find((r) => r.id === id) ?? null)}
                onClose={closeInspector}
                onDirtyChange={setInspectorDirty}
                onViewDevice={() => changeTab("devices")}
              />
            </div>
          </>
        ) : null}
      </div>

      <SimFooterBar status={sim.status} config={sim.config} lastUpdated={sim.lastUpdated} />

      <AddDeviceModal
        open={deviceModalOpen}
        templates={sim.deviceTemplates}
        existingRegisters={sim.registers}
        error={dialogError}
        onClose={() => closeDialog(() => setDeviceModalOpen(false))}
        onSubmit={async (payload) => {
          // "Workspace" slave devices aren't in the shared catalog — their route
          // map is inline on the selected template, so add them via the inline path.
          const tpl = sim.deviceTemplates.find((t) => t.templateKey === payload.templateKey);
          const ok = tpl && payload.templateKey.startsWith("ws-slave:")
            ? await sim.addSlaveDevice(tpl, payload)
            : await sim.addDevice(payload);
          if (ok) setDeviceModalOpen(false);
        }}
      />

      <SimRuleModal
        open={ruleModalOpen}
        initial={modalRule}
        registers={sim.registers}
        addrFmt={addrFmt}
        error={dialogError}
        onClose={() => closeDialog(() => setRuleModalOpen(false))}
        onSubmit={async (rule: SimRule) => {
          const ok = rule.id ? await sim.updateRule(rule) : await sim.addRule(rule);
          if (ok) setRuleModalOpen(false);
        }}
      />

      <ConfirmDialog
        open={pendingNav !== null}
        title="Discard changes"
        description={<p>Discard changes to <span className="font-semibold text-emerald-700 dark:text-emerald-300">{pendingNav?.label}</span>?</p>}
        confirmText="Discard"
        cancelText="Keep editing"
        onConfirm={() => {
          const nav = pendingNav;
          setPendingNav(null);
          setInspectorDirty(false);
          nav?.run();
        }}
        onClose={() => setPendingNav(null)}
      />

      <PromptDialog
        open={deviceEdit?.kind === "rename"}
        title="Rename device"
        label="Device name"
        initialValue={deviceEdit?.device.name ?? ""}
        submitLabel="Rename"
        validate={(v) => (v.trim() === "" ? "Name can't be empty" : null)}
        onSubmit={(v) => { if (deviceEdit) void sim.renameDevice(deviceEdit.device, v.trim()); setDeviceEdit(null); }}
        onClose={() => setDeviceEdit(null)}
      />

      <ConfirmDialog
        open={confirmDeleteDevice !== null}
        tone="danger"
        title="Delete device"
        description={
          confirmDeleteDevice ? (
            <>
              <p className="mb-2">
                Delete <span className="font-semibold text-emerald-700 dark:text-emerald-300">{confirmDeleteDevice.name}</span> and all{" "}
                {sim.registers.filter((r) => r.deviceInstanceId === confirmDeleteDevice.id).length} of its registers?
              </p>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">This action cannot be undone.</p>
            </>
          ) : null
        }
        confirmIcon={<FiTrash2 className="h-4 w-4" aria-hidden="true" />}
        confirmText="Delete device"
        onConfirm={() => {
          if (confirmDeleteDevice) void sim.deleteDevice(confirmDeleteDevice.id);
          setConfirmDeleteDevice(null);
        }}
        onClose={() => setConfirmDeleteDevice(null)}
      />

      <ConfirmDialog
        open={confirmDeleteRule !== null}
        tone="danger"
        title="Delete rule"
        description={
          confirmDeleteRule ? (
            <>
              <p className="mb-2">
                Delete rule{" "}
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                  {confirmDeleteRule.name?.trim() ? confirmDeleteRule.name.trim() : `#${confirmDeleteRule.id}`}
                </span>?
              </p>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">This action cannot be undone.</p>
            </>
          ) : null
        }
        confirmIcon={<FiTrash2 className="h-4 w-4" aria-hidden="true" />}
        confirmText="Delete rule"
        onConfirm={() => {
          if (confirmDeleteRule) void sim.deleteRule(confirmDeleteRule.id);
          setConfirmDeleteRule(null);
        }}
        onClose={() => setConfirmDeleteRule(null)}
      />

      <ConfirmDialog
        open={confirmDeleteRegister !== null}
        tone="danger"
        title="Delete register"
        description={(() => {
          if (!confirmDeleteRegister) return null;
          const r = confirmDeleteRegister;
          const label = r.alias?.trim() ? r.alias.trim() : `unit ${r.unitId}, address ${fmtAddr(r.address, addrFmt)}`;
          const lastOfDevice =
            r.deviceInstanceId != null &&
            sim.registers.filter((x) => x.deviceInstanceId === r.deviceInstanceId).length === 1;
          const dev = lastOfDevice ? sim.devices.find((d) => d.id === r.deviceInstanceId) : undefined;
          return (
            <>
              <p className="mb-2">
                Delete <span className="font-semibold text-emerald-700 dark:text-emerald-300">{label}</span>?
              </p>
              {dev ? (
                <p className="mb-2">This is the last register of device "{dev.name}", which will also be removed.</p>
              ) : null}
              <p className="text-[11px] text-slate-600 dark:text-slate-400">This action cannot be undone.</p>
            </>
          );
        })()}
        confirmIcon={<FiTrash2 className="h-4 w-4" aria-hidden="true" />}
        confirmText="Delete register"
        onConfirm={() => {
          if (confirmDeleteRegister) void deleteRegister(confirmDeleteRegister.id);
          setConfirmDeleteRegister(null);
        }}
        onClose={() => setConfirmDeleteRegister(null)}
      />

      <TemplateEditorModal
        open={saveTemplateDraft !== null}
        initial={saveTemplateDraft}
        forceNew
        takenKeys={sim.deviceTemplates.map((t) => t.templateKey)}
        categories={sim.deviceTemplates.map((t) => t.category)}
        onClose={() => setSaveTemplateDraft(null)}
        onSave={async (t) => {
          const ok = await sim.saveCustomTemplate(t);
          if (ok) {
            pushToast(`Saved “${t.name}” to Virtual Devices`, "info");
            setSaveTemplateDraft(null);
          }
        }}
      />

      <PromptDialog
        open={deviceEdit?.kind === "rebase"}
        title="Re-base device"
        label="New base address"
        initialValue={deviceEdit ? String(deviceEdit.device.baseAddress) : "0"}
        inputMode="numeric"
        hint="Moves all of this device's registers together to a new start address — their relative offsets stay the same (e.g. base 0→100 shifts Temp 0→100, Humidity 1→101)."
        submitLabel="Re-base"
        validate={(v) => {
          const t = v.trim();
          if (t === "") return "Enter a base address";
          const n = Number(t);
          if (!Number.isInteger(n) || n < 0 || n > 65535) return "Enter a whole number between 0 and 65535";
          return null;
        }}
        onSubmit={(v) => { if (deviceEdit) void sim.rebaseDevice(deviceEdit.device.id, Number(v.trim())); setDeviceEdit(null); }}
        onClose={() => setDeviceEdit(null)}
      />
    </div>
  );
}
