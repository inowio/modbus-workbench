import { describe, expect, it } from "vitest";

import css from "./index.css?raw";

describe("index.css dark-mode option highlight", () => {
  it("uses an opaque emerald background with light text (readable over any list colour)", () => {
    const rule = /\.dark option:checked:not\(:disabled\),\s*\.dark option:hover:not\(:disabled\)\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    const body = rule![1];
    const bg = /background-color:\s*([^;!]+)/.exec(body)?.[1].trim();
    expect(bg).toBe("rgb(6 95 70)");
    expect(body).toMatch(/color:\s*rgb\(236 253 245\)/);
  });
});
