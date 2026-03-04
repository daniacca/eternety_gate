import { describe, it, expect } from "vitest";
import { getMcSpentForMode, getCastModifierForMode, getOvercastLevel } from "./castModes";

describe("getMcSpentForMode", () => {
  it("FETTERED returns CN", () => {
    expect(getMcSpentForMode("FETTERED", 4, 7)).toBe(4);
  });
  it("FULL_POWER returns max(CN, PM)", () => {
    expect(getMcSpentForMode("FULL_POWER", 4, 7)).toBe(7);
    expect(getMcSpentForMode("FULL_POWER", 10, 7)).toBe(10);
  });
  it("PUSH returns PM+2, at least CN", () => {
    expect(getMcSpentForMode("PUSH", 4, 7)).toBe(9);
    expect(getMcSpentForMode("PUSH", 12, 7)).toBe(12);
  });
});

describe("getCastModifierForMode", () => {
  it("Full Power (mcSpent === PM) => 0", () => {
    expect(getCastModifierForMode(7, 7)).toBe(0);
  });
  it("Push (mcSpent === PM+2) => -20", () => {
    expect(getCastModifierForMode(7, 9)).toBe(-20);
  });
  it("Fettered CN=4 PM=7 => +30", () => {
    expect(getCastModifierForMode(7, 4)).toBe(30);
  });
});

describe("getOvercastLevel", () => {
  it("floor((mcSpent - CN) / 2), min 0", () => {
    expect(getOvercastLevel(7, 4)).toBe(1);
    expect(getOvercastLevel(4, 4)).toBe(0);
    expect(getOvercastLevel(6, 4)).toBe(1);
    expect(getOvercastLevel(8, 4)).toBe(2);
  });
});
