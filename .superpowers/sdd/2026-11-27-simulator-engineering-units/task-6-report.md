# Task 6 report: Virtual Device editor scaling

Status: DONE.

- New shared `src/screen2/simulator/ScalingFields.tsx` (component + `scalingTexts`, `parseOptionalNumber`, `validateScaling`). RegisterInspector now uses it; accessible names unchanged ("Scale", "Offset", "Decimals", Unit picker id `register-unit`).
- TemplateEditorModal: selected-register pane shows the block for numeric registers (hidden for bit banks; switching to a bit bank clears scale/scaleOffset/decimals/unit). Accessible names: "Scale N", "Scaling offset N" (register "Offset N" already exists), "Decimals N". Invalid text (scale 0 / non-numeric / decimals outside 0-6) keeps the stored value and blocks Save with the reason in the footer status. Cleared fields are removed from the register (absent stays absent, no nulls).
- `TemplateRegister` gains `scale?`, `scaleOffset?`, `decimals?` (R2).
- `sourceSummary`: generator with a range and unit -> `sine 20–30 °C` (unit after the range, before the period).
- Help: Scaling bullet in virtualDevices.tsx.
- The editor has no hold-value field, so no engineering-unit hold entry was added; generator/preset min/max are engineering units (backend interprets them so).
- Tests: 739 pass (baseline 733, +6 net new in editor/utils); `npm run build` clean.

## Fix round 1

Finding: Scale 0 / bad decimals were written into the register and only a selection-scoped error blocked Save, which cleared on selecting another register.

Fix (TemplateEditorModal.tsx):
- `editScaling` no longer writes a value that fails `validateScaling`; the typed text stays in the field with its error.
- The modal computes `scalingBlock` over all non-bit-bank `t.registers` (scale 0 / non-finite scale or offset / decimals not integer 0-6), reason "Register N: ...", so loaded templates that are already invalid also block Save.
- The selected register's invalid draft still blocks Save while it is on screen (`draftError`).

Tests added: "keeps Scale 0 out of the saved register even after selecting another register" (type 0, select register 2, save -> scale stays 0.1); "blocks Save for a loaded register that already has scale 0" (reason text shown).

Verification: `npx vitest run` (PowerShell) -> Test Files 62 passed, Tests 741 passed (741). `npm run build` -> built in 6.03s, no errors.
