// @vitest-environment node
import { describe, expect, it } from "vitest";
import { packWaterCoordinates, WATER_COORDINATE_ERROR_M } from "./water-coordinate-pack";

const box = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h }
];
describe("bounded water coordinate packing", () => {
  it("shortens numeric tails within a ten-micrometre budget without mutating source", () => {
    const source = [box(0.123456789123, 10.0123456789, 100, 100)],
      before = structuredClone(source),
      packed = packWaterCoordinates(source);
    expect(packed).not.toEqual(source);
    expect(source).toEqual(before);
    for (let i = 0; i < 4; i++)
      expect(Math.hypot(packed[0][i].x - source[0][i].x, packed[0][i].y - source[0][i].y)).toBeLessThan(
        WATER_COORDINATE_ERROR_M
      );
  });
  it.each([1e-10, 1e-6])("retains exact geometry if rounding would close a %sm channel", width => {
    const source = [box(0, 0, 10, 100), box(10 + width, 0, 10, 100)];
    expect(packWaterCoordinates(source)).toBe(source);
  });
  it.each([1e-10, 1e-6])("retains %sm thin rings rather than collapsing them", width => {
    const source = [box(0, 0, width, 100)];
    expect(packWaterCoordinates(source)).toBe(source);
  });
  it("keeps microscopic source edges while compacting unrelated vertices", () => {
    const source = [
      [
        { x: -12.093654374897246, y: -1104.742361250057 },
        { x: 12.408731422223605, y: -1126.610817121642 },
        { x: 12.4087314222236, y: -1126.610817121642 },
        { x: 36.48981735362183, y: -1148.5428133008445 },
        { x: 100.123456789123, y: 0.123456789123 }
      ]
    ];
    const packed = packWaterCoordinates(source);
    expect(packed[0][1]).toEqual(source[0][1]);
    expect(packed[0][2]).toEqual(source[0][2]);
    expect(packed[0][4]).not.toEqual(source[0][4]);
    expect(packWaterCoordinates(packed)).toEqual(packed);
  });
  it("retains holes and coincident piece joins", () => {
    const source = [box(0, 0, 100, 20), box(0, 80, 100, 20), box(0, 20, 20, 60), box(80, 20, 20, 60)];
    expect(packWaterCoordinates(source)).toEqual(source);
  });
});
