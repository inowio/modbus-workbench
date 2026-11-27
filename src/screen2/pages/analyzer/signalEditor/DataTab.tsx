import { useId } from "react";
import type { SlaveItem, SlaveRegisterRow } from "../../../api/slaves";
import type { MathResult } from "../../../utils/analyzerMath";
import type { SignalEvaluation } from "../../../utils/analyzerSignalEval";
import { formatAnalyzerAddress, type AnalyzerAddressFormat } from "../../../utils/analyzerAddressFormat";
import TilesShowSection, { type SavedDisplay } from "./TilesShowSection";
import type { DataField, SignalDraft } from "./signalDraft";
import { FieldError, FIELD_CLASS, LABEL_CLASS, SECTION_CLASS, SectionTitle } from "./dataTabUi";

type DraftField = "scale" | "offset" | "clampMin" | "clampMax" | "bit";

function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  error?: string;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>
        {props.label}
      </label>
      <input
        id={id}
        className={`mt-1 ${FIELD_CLASS}`}
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value)}
        placeholder={props.placeholder}
        disabled={props.disabled}
      />
      <FieldError message={props.error} />
    </div>
  );
}

const REGISTER_VALUE_FIELDS: { key: DraftField; label: string; placeholder: string }[] = [
  { key: "scale", label: "Scale", placeholder: "e.g. 0.1" },
  { key: "offset", label: "Offset", placeholder: "Optional" },
  { key: "clampMin", label: "Clamp min", placeholder: "Optional" },
  { key: "clampMax", label: "Clamp max", placeholder: "Optional" },
  { key: "bit", label: "Bit (0-63)", placeholder: "Optional" },
];

export default function DataTab(props: {
  mode: "add" | "edit";
  draft: SignalDraft;
  onChange: (patch: Partial<SignalDraft>) => void;
  onSignalIdInput: (value: string) => void;
  signalIdPlaceholder: string;
  fields: Partial<Record<DataField, string>>;
  rows: SlaveRegisterRow[];
  rowsLoadedKey: string | null;
  slaves: SlaveItem[];
  addressFormat: AnalyzerAddressFormat;
  results: Record<string, MathResult>;
  registerSample: MathResult | undefined;
  saved: SavedDisplay | null;
  live: SignalEvaluation | undefined;
  resultsFromLive: boolean;
  polling: boolean;
  unitKey: string;
  disabled: boolean;
}) {
  const { mode, draft, onChange, fields, rows, slaves, addressFormat, disabled } = props;
  const slaveFieldId = useId();
  const typeFieldId = useId();
  const addressFieldId = useId();
  const signalIdFieldId = useId();
  const isRegister = draft.kind === "register";
  const slave = draft.slaveId != null ? (slaves.find((s) => s.id === draft.slaveId) ?? null) : null;
  const noRows = isRegister && draft.slaveId != null && props.rowsLoadedKey === `${draft.slaveId}:${draft.functionCode}` && rows.length === 0;
  // Hidden while rows load, and when the no-rows hint already explains it.
  const rowsLoaded = props.rowsLoadedKey === `${draft.slaveId}:${draft.functionCode}`;
  const showRegisterError = !!fields.register && !noRows && (draft.slaveId == null || rowsLoaded);

  const signalIdField = (
    <div>
      <label htmlFor={signalIdFieldId} className={LABEL_CLASS}>
        Signal ID
      </label>
      <input
        id={signalIdFieldId}
        className={`mt-1 ${FIELD_CLASS}`}
        value={draft.id}
        onChange={(e) => props.onSignalIdInput(e.currentTarget.value)}
        disabled={disabled || mode === "edit"}
        placeholder={mode === "add" ? props.signalIdPlaceholder : ""}
      />
      {mode === "edit" ? (
        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Signal IDs are immutable (rename not supported)</div>
      ) : (
        <FieldError message={fields.id} />
      )}
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">
        {isRegister ? (
          <section aria-label="Register" className={SECTION_CLASS}>
            <SectionTitle title="Register" caption="Where the value is read from." />
            <div className="grid grid-cols-1 gap-3">
              {showRegisterError ? <div className="text-xs text-rose-800 dark:text-rose-200">{fields.register}</div> : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor={slaveFieldId} className={LABEL_CLASS}>
                    Slave
                  </label>
                  <select
                    id={slaveFieldId}
                    className={`mt-1 ${FIELD_CLASS}`}
                    value={draft.slaveId ?? ""}
                    onChange={(e) => onChange({ slaveId: Number(e.currentTarget.value) })}
                    disabled={disabled || slaves.length === 0}
                  >
                    {slaves.length === 0 ? (
                      <option value="">No slaves yet</option>
                    ) : (
                      slaves.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} (Unit {s.unitId})
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label htmlFor={typeFieldId} className={LABEL_CLASS}>
                    Register type
                  </label>
                  <select
                    id={typeFieldId}
                    className={`mt-1 ${FIELD_CLASS}`}
                    value={draft.functionCode}
                    onChange={(e) => onChange({ functionCode: Number(e.currentTarget.value) })}
                    disabled={disabled || draft.slaveId == null}
                  >
                    <option value={1}>Read Coils (0x01)</option>
                    <option value={2}>Read Discrete Inputs (0x02)</option>
                    <option value={3}>Read Holding Registers (0x03)</option>
                    <option value={4}>Read Input Registers (0x04)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor={addressFieldId} className={LABEL_CLASS}>
                    Register address
                  </label>
                  <select
                    id={addressFieldId}
                    className={`mt-1 ${FIELD_CLASS}`}
                    value={draft.registerRowId ?? ""}
                    onChange={(e) => onChange({ registerRowId: Number(e.currentTarget.value) })}
                    disabled={disabled || draft.slaveId == null || rows.length === 0}
                  >
                    {rows.length === 0 ? (
                      <option value="">No register rows for this function</option>
                    ) : (
                      rows.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.alias?.trim() ? r.alias : `Address ${formatAnalyzerAddress(r.address, addressFormat)}`} · {r.dataType} [{formatAnalyzerAddress(r.address, addressFormat)}]
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              {noRows ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
                  This register type has no rows for the selected slave. Add register rows for it on the Slaves page, or choose a different register type.
                </div>
              ) : null}

              {signalIdField}
            </div>
          </section>
        ) : (
          <section aria-label="Calculated signal" className={SECTION_CLASS}>
            <SectionTitle title="Calculated signal" caption="Built from other signals. Add its inputs and math in the Math tab." />
            {signalIdField}
          </section>
        )}

        {isRegister ? (
          <section aria-label="Register value" className={SECTION_CLASS}>
            <SectionTitle title="Register value" caption="Applied to the raw register before any math." />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {REGISTER_VALUE_FIELDS.map((f) => (
                <TextField
                  key={f.key}
                  label={f.label}
                  value={draft[f.key]}
                  onChange={(v) => onChange({ [f.key]: v } as Partial<SignalDraft>)}
                  placeholder={f.placeholder}
                  error={fields[f.key]}
                  disabled={disabled}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <TilesShowSection
          draft={draft}
          onChange={onChange}
          results={props.results}
          registerSample={props.registerSample}
          saved={props.saved}
          live={props.live}
          resultsFromLive={props.resultsFromLive}
          polling={props.polling}
          errors={{ show: fields.show, decimals: fields.decimals }}
          unitKey={props.unitKey}
          disabled={disabled}
        />

        <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
          {isRegister ? (
            <>
              Poll interval: <span className="font-semibold text-slate-900 dark:text-slate-100">{slave?.pollIntervalMs ?? "—"} ms</span>
            </>
          ) : (
            "Updates whenever an input updates."
          )}
        </div>
      </div>
    </div>
  );
}
