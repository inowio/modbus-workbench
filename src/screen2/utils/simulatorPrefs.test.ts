import { describe, expect, it } from "vitest";

import { addressFormatStorageKey } from "./simulatorPrefs";

describe("simulatorPrefs", () => {
  it("scopes the address format per workspace", () => {
    expect(addressFormatStorageKey("Plant-A")).toBe("inowio.simulator.addressFormat.Plant-A");
    expect(addressFormatStorageKey("Plant-A")).not.toBe(addressFormatStorageKey("Plant-B"));
  });
});
