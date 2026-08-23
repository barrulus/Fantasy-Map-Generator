import { describe, expect, test } from "vitest";
import { getNextFreeId } from "./ice-generator";

describe("getNextFreeId", () => {
  test("returns 0 when no ids exist", () => {
    expect(getNextFreeId([])).toBe(0);
  });

  test("fills the lowest gap", () => {
    expect(getNextFreeId([0, 1, 3])).toBe(2);
  });

  test("appends after a dense range", () => {
    expect(getNextFreeId([0, 1, 2])).toBe(3);
  });

  test("does not depend on input order", () => {
    expect(getNextFreeId([3, 0, 1])).toBe(2);
  });
});
