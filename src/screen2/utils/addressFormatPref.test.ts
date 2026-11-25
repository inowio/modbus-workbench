import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_ADDRESS_FORMAT_KEY,
  readAppAddressFormat,
  useAppAddressFormat,
  writeAppAddressFormat,
} from "./addressFormatPref";

describe("addressFormatPref", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("defaults to dec with no keys", () => {
    expect(readAppAddressFormat()).toBe("dec");
  });

  it("inherits hex from a legacy simulator key and persists it", () => {
    window.localStorage.setItem("inowio.simulator.addressFormat.wsA", "hex");
    expect(readAppAddressFormat()).toBe("hex");
    expect(window.localStorage.getItem(APP_ADDRESS_FORMAT_KEY)).toBe("hex");
  });

  it("app key wins over legacy keys", () => {
    window.localStorage.setItem(APP_ADDRESS_FORMAT_KEY, "dec");
    window.localStorage.setItem("inowio.simulator.addressFormat.wsA", "hex");
    expect(readAppAddressFormat()).toBe("dec");
  });

  it("propagates a write to other hook instances", () => {
    const a = renderHook(() => useAppAddressFormat());
    const b = renderHook(() => useAppAddressFormat());
    expect(b.result.current[0]).toBe("dec");
    act(() => a.result.current[1]("hex"));
    expect(a.result.current[0]).toBe("hex");
    expect(b.result.current[0]).toBe("hex");
  });

  it("writeAppAddressFormat notifies mounted hooks", () => {
    const h = renderHook(() => useAppAddressFormat());
    act(() => writeAppAddressFormat("hex"));
    expect(h.result.current[0]).toBe("hex");
  });

  it("degrades to dec when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readAppAddressFormat()).toBe("dec");
    expect(() => writeAppAddressFormat("hex")).not.toThrow();
  });
});
