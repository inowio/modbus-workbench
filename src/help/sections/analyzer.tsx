import React from "react";
import SectionBlock from "./SectionBlock";
import type { HelpSectionDefinition } from "../types";

const analyzerSection: HelpSectionDefinition = {
  slug: "analyzer",
  title: "Analyzer",
  description: "Turn raw Modbus registers into reusable signals and visualize them as value or trend tiles.",
  keywords: [
    "analyzer",
    "signals",
    "tiles",
    "trend",
    "decoder",
    "poll interval",
    "value tile",
    "chart",
    "math",
    "variables",
    "rules",
    "calculated signal",
    "unit",
    "try it",
    "tabs",
    "focus view",
    "full screen",
    "cycle tabs",
    "duplicate tile",
    "address format",
  ],
  searchText:
    "Analyzer pipeline Register → Signal → Tile. Learn screen controls, how to define signals, configure decoders (unit, scale, offset, bit, clamp), manage poll intervals, add tiles (value/trend), use tile menus, run/stop polling, avoid anti-patterns, and follow real-world examples. Pick a unit from the grouped dropdown, add math with variables, calculations and rules (IF / AND / OR, OTHERWISE), choose what a tile shows, create calculated signals from other signals, and test with Try it. Organize tiles into tabs, rename, reorder and delete tabs, move or duplicate tiles between tabs, switch tabs with Ctrl+1 to Ctrl+9, and use Focus view with cycle tabs and full screen. Register address format (Dec / Hex) lives in Settings.",
  anchors: [
    { id: "overview", label: "Register → Signal → Tile" },
    { id: "controls", label: "Screen controls" },
    { id: "signal-definition", label: "Signals (concept)" },
    { id: "signal-list", label: "Signal list & reuse" },
    { id: "create-signal", label: "Create / edit signal" },
    { id: "signal-decoder", label: "Decoder configuration" },
    { id: "poll-delete", label: "Poll interval & delete" },
    { id: "units", label: "Units" },
    { id: "math", label: "Math: variables, calculations and rules" },
    { id: "calculated-signals", label: "Calculated signals" },
    { id: "try-it", label: "Try it" },
    { id: "tiles", label: "Tiles" },
    { id: "tile-types", label: "Tile types" },
    { id: "add-tile", label: "Add tile" },
    { id: "tile-menu", label: "Tile menu" },
    { id: "tabs", label: "Tabs" },
    { id: "focus-view", label: "Focus view" },
    { id: "run-stop", label: "Run / Stop" },
    { id: "examples", label: "Examples" },
    { id: "anti-patterns", label: "What not to do" },
    { id: "mental-model", label: "Mental model" },
  ],
  Component: (): React.ReactElement => (
    <div className="space-y-6">
      <SectionBlock section="analyzer" anchor="overview" title="Why Analyzer matters">
        <p>
          Analyzer is the live dashboard where the pipeline <strong>Register → Signal → Tile</strong> plays out. Registers provide raw bytes, <strong>Signals</strong> decode those bytes into engineering values, and <strong>Tiles</strong> decide how the value is visualized. Keep the layers separate: signals are data contracts, tiles are UI.
        </p>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="controls" title="Screen controls">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Trends to show</h3>
            <p>Limits the historical window (Last 1/5/10/30/60 min or All) for every trend tile. Only the on-screen history changes—the Modbus reads do not.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Run</h3>
            <p>Starts/stops Analyzer-wide polling while respecting each signal’s poll interval. Stopped dashboards label tiles as <em>Stopped</em>.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Edit layout</h3>
            <p>Drag and resize tiles to group by equipment, enlarge important trends, or prioritize alarms.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Control bar</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><strong>Signals</strong> – open the signal panel.</li>
              <li><strong>Connection</strong> – adjust RTU/TCP parameters without leaving Analyzer.</li>
              <li><strong>+ Tile</strong> – add value or trend tiles to the current tab.</li>
              <li><strong>Refresh</strong> (icon) – reload layout after structural changes.</li>
              <li><strong>Focus view</strong> (⛶) – see Focus view below.</li>
            </ul>
            <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">Register addresses are shown in decimal or hex. Change this in <strong>Settings → Display → Register addresses</strong>; it is app-wide, remembered, and also used by the TCP Simulator. It only changes how addresses are written, never values.</p>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="signal-definition" title="Signals — what they are">
        <p>
          A signal is the semantic definition of a register: it answers <em>what the value means, how to decode it, what unit it uses, and how fast it should update</em>. It is not a tile or a chart. Configure signals once and reuse them everywhere.
        </p>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="signal-list" title="Signal list & reuse">
        <p>The Signals panel lists every configured signal with:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Name</li>
          <li>Slave reference and register type</li>
          <li>Register address</li>
          <li>Status indicator (green healthy, red error)</li>
        </ul>
        <p className="mt-3">Typical reuse targets: value tiles, trend charts, logs, future alarms/analytics.</p>
        <pre className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 dark:border-slate-800/60 dark:bg-slate-900/40 dark:text-slate-100">
Signal name: temp_inlet
Slave: TCP-Simulator (Unit 2)
Register type: Read Input Registers (0x04)
Address: 0
        </pre>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="create-signal" title="Create / edit signal">
        <ol className="list-decimal space-y-2 pl-5">
          <li><strong>Signals</strong> in the control bar → <strong>Add Signal</strong>.</li>
          <li>Select the <strong>Slave</strong>, <strong>Register type</strong>, and <strong>Register address</strong>.</li>
          <li>Provide a unique <strong>Signal ID</strong> plus decoder settings (below).</li>
          <li>Save. Duplicate combinations of (Slave + Register type + Address) are blocked intentionally.</li>
        </ol>
        <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">Editing follows the same dialog. Deleting removes the signal from the list and automatically unlinks any tiles that referenced it.</p>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="signal-decoder" title="Signal decoder configuration">
        <p>Decoder fields convert raw registers into engineering truth:</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Unit</strong> – pick from the grouped list (see Units below); it is only a label.</li>
              <li><strong>Scale</strong> – multiplier; raw 268 × 0.1 = 26.8 °C.</li>
              <li><strong>Offset</strong> – applied after scaling, e.g., subtract 40 for RTD sensors.</li>
              <li><strong>Decimals</strong> – rounds only what tiles show; the stored value keeps full precision.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Clamp min/max</strong> – clip noisy spikes (e.g., -40 to 150).</li>
              <li><strong>Bit (0–63)</strong> – extract a single bit for alarms/flags.</li>
              <li><strong>Formula</strong> – <code>(raw × scale) + offset</code> before clamping.</li>
            </ul>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="poll-delete" title="Poll interval & deleting signals">
        <p>
          Each signal can override its poll interval (e.g., 500 ms for fast loops, 5000 ms for slow sensors). Analyzer respects these intervals even when multiple signals live on the same tile layout.
        </p>
        <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">Deleting a signal removes it from the workspace and automatically detaches it from any tiles—no orphaned bindings remain. A signal that a calculated signal uses as an input cannot be deleted; remove it from those calculated signals first.</p>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="units" title="Units">
        <p>
          The <strong>Unit</strong> field is a dropdown grouped by topic: Temperature, Electrical, Pressure, Flow, Level / volume / mass, Speed / motion, Vibration, Time, and Ratio / environment. Choose <strong>None</strong> for a unitless number, or <strong>Custom…</strong> to type your own label (up to 16 characters).
        </p>
        <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
          The unit is only a label shown next to the value. Choosing kPa instead of bar does <strong>not</strong> convert the number—do any conversion in the Math tab. Signals saved earlier with a unit that is not in the list open with <strong>Custom…</strong> and keep their text.
        </p>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="math" title="Math: variables, calculations and rules">
        <p>
          The signal editor has two tabs: <strong>Data</strong> (where the value comes from, scale, offset, clamp, what tiles show, unit, decimals) and <strong>Math</strong>. In Math you build named <strong>variables</strong>, each one a <em>Calculation</em> or a <em>Rules</em> card. Variables run top to bottom and can use the register value, inputs, and any variable above them.
        </p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Calculation</h3>
            <p>Start with a value, then add steps such as + − × ÷, remainder, min, max, power, abs, round, floor, ceil, bit N of, or negate. Steps run strictly <strong>left to right</strong>, with no operator precedence: V × A ÷ 1000 means ((V × A) ÷ 1000). To group differently, put part of the work in another variable and use it.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Rules</h3>
            <p>Rows of <strong>IF</strong> conditions joined by <strong>AND</strong> or <strong>OR</strong> (one choice per row) that give a number or text. The first matching row wins, and <strong>OTHERWISE</strong> covers everything else. To mix AND and OR, use a second variable.</p>
          </div>
        </div>
        <p className="mt-3">
          <strong>Show value</strong> (on the Data tab) picks what tiles display: the register value or any variable. A variable that gives text, such as Low or Medium, can appear on a value tile but <strong>can't be charted</strong>; trend tiles list only numeric signals.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>If a step cannot produce a number (for example dividing by zero, or a missing input), the tile shows the reason instead of a value, such as <em>division by zero</em> or <em>missing: V</em>. In the editor, the tile preview shows <strong>—</strong> with the same reason. Analyzer never invents a number.</li>
          <li><strong>Decimals</strong> rounds only what tiles show. Calculations keep full precision.</li>
          <li>The Unit is only a label; it never changes the value.</li>
        </ul>
        <div className="mt-3 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800/60 dark:bg-slate-900/20 dark:text-slate-300">
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">Example 1 — scale a register</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li><code>x</code> = Register value (328).</li>
              <li><code>y</code> = x ÷ 10 = 32.8.</li>
              <li>On the Data tab set <strong>Show value</strong> to <code>y</code> and <strong>Unit</strong> to °C. The tile shows <strong>32.8 °C</strong>.</li>
            </ol>
          </div>
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">Example 2 — turn a number into a label</p>
            <p className="mt-2"><code>z</code> is a Rules variable on <code>y</code>:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>y &lt; 20 → Low</li>
              <li>y ≥ 20 AND y &lt; 40 → Medium</li>
              <li>y ≥ 40 AND y &lt; 60 → High</li>
              <li>y ≥ 60 AND y &lt; 80 → Critical</li>
              <li>OTHERWISE → Unknown</li>
            </ul>
            <p className="mt-2">With y = 32.8 the result is <strong>Medium</strong>.</p>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="calculated-signals" title="Calculated signals">
        <p>
          A <strong>calculated signal</strong> has no register of its own. When adding a signal, choose <strong>Calculated signal</strong> as the kind (it cannot be changed after saving). On the Math tab, add <strong>inputs</strong>: each is a register signal plus which of its values to use (its shown value, register value, or one of its variables). Then build variables from those inputs as usual.
        </p>
        <pre className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 dark:border-slate-800/60 dark:bg-slate-900/40 dark:text-slate-100">
Inputs:  V = voltage signal,  A = current signal
Variable p = V × A ÷ 1000   → Show value p, Unit kW
        </pre>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>It updates whenever one of its inputs updates, and its tile state follows the worst input (for example Disconnected or Stale if a source stops).</li>
          <li>Inputs must be register signals; calculated signals cannot be chained.</li>
          <li>A signal used as an input cannot be deleted until it is removed from every calculated signal that uses it.</li>
          <li>The Signals list labels each signal as Register or Calculated.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="try-it" title="Try it">
        <p>
          The panel on the right of the Math tab lets you test your math before saving. It has one box for the register value (or each input) and lists the result of every variable, or the error if one fails.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li><strong>Use live values</strong> fills the boxes from the latest polled data. Typing your own value switches it off so you can test edge cases such as 0 or 100.</li>
          <li>Try it is a preview only: nothing is saved and nothing is written to the device.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="tiles" title="Tiles">
        <p>
          Tiles are pure views. Each tile references exactly one primary signal and inherits its decoder, units, and poll cadence. Use them to spotlight key KPIs or trends without duplicating signal logic.
        </p>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="tile-types" title="Tile types">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Value tile</h3>
            <p>Shows the latest value, its unit, and state (Running / Stopped). Ideal for temperatures, pressures, setpoints, or digital flags.</p>
            <pre className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 dark:border-slate-800/60 dark:bg-slate-950/40 dark:text-slate-100">Temp
VALUE
26.80 °C</pre>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-black/5 dark:border-slate-800/60 dark:bg-slate-900/20 dark:shadow-black/0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Trend chart</h3>
            <p>Plots historical samples (time on X, value on Y) and updates as polling runs. Perfect for drift detection, oscillations, and stability analysis.</p>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="add-tile" title="Adding a tile">
        <ol className="list-decimal space-y-2 pl-5">
          <li>Click <strong>+ Tile</strong> in the control bar. The tile is added to the current tab.</li>
          <li>Choose tile type (Value or Trend).</li>
          <li>Select the <strong>Primary signal</strong> (required) and optionally override the title.</li>
          <li>Click <strong>Add</strong>; the tile appears immediately and reflects live signal state.</li>
        </ol>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="tile-menu" title="Tile menu">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Disable Polling</strong> – pauses only this tile’s signal binding, marking it as <em>Disabled</em>.</li>
          <li><strong>Information</strong> – quick reference for slave, register, decoder, and poll interval.</li>
          <li><strong>Edit</strong> – change the title or rebind to another signal without touching the signal itself.</li>
          <li><strong>Move to tab…</strong> – send the tile to another tab.</li>
          <li><strong>Duplicate…</strong> – copy the tile to a tab. The copy is named “&lt;title&gt; (copy)” and placed below that tab’s tiles.</li>
          <li><strong>Delete</strong> – removes the tile; the signal remains available.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="tabs" title="Tabs">
        <p>
          The tab strip under the control bar lets you group tiles, for example one tab per machine. Existing tiles start in a tab named <strong>Main</strong>. Each tile lives on exactly one tab, and <strong>+ Tile</strong> and <strong>Edit layout</strong> act on the current tab.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>Click a tab to switch. Double-click it, or use ⋮ → <strong>Rename</strong>, to rename.</li>
          <li>Drag tabs to reorder them. Click <strong>+</strong> to add a tab.</li>
          <li>While running, a dot on a tab turns <strong>red</strong> if a tile has an error and <strong>amber</strong> if a tile is stale.</li>
          <li>Press <strong>Ctrl+1</strong> to <strong>Ctrl+9</strong> to jump to a tab. The last open tab is remembered.</li>
          <li>⋮ → <strong>Delete</strong>: if the tab has tiles, choose <strong>Move N tiles to [tab]</strong> (default) or <strong>Delete N tiles</strong>. Signals are never deleted. The last remaining tab can’t be deleted.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="focus-view" title="Focus view">
        <p>
          Click <strong>Focus view</strong> (⛶) to hide the sidebar, app header, control bar and tabs so the tiles fill the window. Polling keeps running on all tabs.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>Move the mouse to show the overlay. It hides 2 seconds after the mouse stops or leaves.</li>
          <li>The overlay has the tab name, ◀ ▶ to change tab, <strong>Run/Stop</strong>, <strong>Cycle tabs</strong>, <strong>Full screen</strong> and <strong>Exit</strong>.</li>
          <li><strong>Cycle tabs</strong> can be Off, 10 s, 30 s or 60 s. It pauses while the mouse is over the overlay and is remembered per workspace.</li>
          <li><strong>Esc</strong> closes an open popup first; pressing it again exits focus view (and full screen).</li>
          <li>Tile menus and layout editing are off in focus view. Use the ⓘ button on a tile to see its information.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="run-stop" title="Run / Stop Analyzer">
        <p>
          The Run toggle starts polling for all active tiles, observes per-signal intervals, and never overlaps poll cycles—Analyzer waits for each round-trip to finish to avoid flooding Modbus devices. Stop halts everything immediately.
        </p>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="examples" title="Real-world example">
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800/60 dark:bg-slate-900/20 dark:text-slate-300">
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">Classic temperature loop</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Register: Input Register 0 returns 268.</li>
              <li>Decoder: data type i16, scale 0.1, unit °C → final value 26.8 °C.</li>
              <li>Tiles: value tile for live reading, trend chart for history.</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">Digital status from packed bits</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Add signal to the register carrying flags.</li>
              <li>Set <strong>Bit (0–63)</strong> to the alarm bit (e.g., bit 4).</li>
              <li>Add a value tile to display 0/1 state instantly.</li>
            </ol>
          </div>
        </div>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="anti-patterns" title="What not to do">
        <ul className="list-disc space-y-1 pl-5">
          <li>❌ Create multiple signals for the same register – reuse signals; tiles exist for visualization.</li>
          <li>❌ Apply scaling inside tiles – scaling belongs in the signal decoder.</li>
          <li>❌ Poll too fast – start around 1000&nbsp;ms; many devices lock up when spammed.</li>
          <li>❌ Guess byte order – verify with Register Value Details and raw bytes.</li>
          <li>❌ Use trend charts for booleans – value tiles suit discrete states.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="analyzer" anchor="mental-model" title="Mental model">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Slaves</strong> define where data originates.</li>
          <li><strong>Registers</strong> define what raw data exists.</li>
          <li><strong>Signals</strong> define meaning and math.</li>
          <li><strong>Tiles</strong> define visibility and UI.</li>
        </ul>
      </SectionBlock>
    </div>
  ),
};

export default analyzerSection;
