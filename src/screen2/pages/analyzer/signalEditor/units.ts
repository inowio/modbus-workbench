export const UNIT_GROUPS: ReadonlyArray<{ label: string; units: readonly string[] }> = [
  { label: "Temperature", units: ["°C", "°F", "K"] },
  {
    label: "Electrical",
    units: ["V", "mV", "kV", "A", "mA", "W", "kW", "MW", "VA", "kVA", "var", "kvar", "Wh", "kWh", "MWh", "Hz", "Ω", "kΩ", "MΩ", "PF"],
  },
  { label: "Pressure", units: ["Pa", "kPa", "MPa", "bar", "mbar", "psi"] },
  { label: "Flow", units: ["m³/h", "L/min", "L/s", "GPM"] },
  { label: "Level / volume / mass", units: ["m", "mm", "cm", "L", "m³", "kg", "t"] },
  { label: "Speed / motion", units: ["rpm", "m/s", "km/h"] },
  { label: "Vibration", units: ["m/s²", "g", "mm/s", "in/s", "µm", "mil"] },
  { label: "Time", units: ["ms", "s", "min", "h"] },
  { label: "Ratio / environment", units: ["%", "%RH", "ppm", "ppb", "pH", "lux", "dB"] },
];

const KNOWN = new Set(UNIT_GROUPS.flatMap((g) => g.units));

export function isKnownUnit(u: string): boolean {
  return KNOWN.has(u);
}
