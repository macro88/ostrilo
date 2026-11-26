import { describe, expect, it } from "vitest";
import { fitWithin } from "@/domain/blossom/dimensions";
import { BLOSSOM_MAX_EDGE_PX } from "@/domain/blossom/constants";

describe("fitWithin", () => {
  it("caps the longest edge and keeps the aspect ratio", () => {
    expect(fitWithin(4000, 3000, BLOSSOM_MAX_EDGE_PX)).toEqual({
      width: 2048,
      height: 1536,
    });
    expect(fitWithin(3000, 4000, BLOSSOM_MAX_EDGE_PX)).toEqual({
      width: 1536,
      height: 2048,
    });
  });

  it("never enlarges an image", () => {
    expect(fitWithin(800, 600, BLOSSOM_MAX_EDGE_PX)).toEqual({
      width: 800,
      height: 600,
    });
    expect(fitWithin(2048, 2048, BLOSSOM_MAX_EDGE_PX)).toEqual({
      width: 2048,
      height: 2048,
    });
  });

  it("scales an image one pixel over the cap", () => {
    expect(fitWithin(2049, 100, BLOSSOM_MAX_EDGE_PX)).toEqual({
      width: 2048,
      height: 100,
    });
  });

  it("keeps a very thin image at least one pixel high", () => {
    expect(fitWithin(5000, 1, BLOSSOM_MAX_EDGE_PX)).toEqual({
      width: 2048,
      height: 1,
    });
    expect(fitWithin(1, 5000, BLOSSOM_MAX_EDGE_PX)).toEqual({
      width: 1,
      height: 2048,
    });
  });

  it.each([
    [0, 100],
    [100, 0],
    [-5, 100],
    [100.5, 100],
    [Number.NaN, 100],
    [Number.POSITIVE_INFINITY, 100],
  ])("refuses dimensions %s by %s", (width, height) => {
    expect(() => fitWithin(width, height, BLOSSOM_MAX_EDGE_PX)).toThrow(
      RangeError
    );
  });
});
