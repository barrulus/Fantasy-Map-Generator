import { describe, expect, it } from "vitest";
import type { WaterPoint as Point } from "./water-context-types";
import { packWaterPolygons } from "./water-polygon-pack";

const rectangle = (left: number, bottom: number, right: number, top: number): Point[] => [
  { x: left, y: bottom },
  { x: right, y: bottom },
  { x: right, y: top },
  { x: left, y: top }
];
const area = (rings: Point[][]) =>
  rings.reduce(
    (sum, ring) =>
      sum +
      Math.abs(
        ring.reduce((a, p, i) => {
          const q = ring[(i + 1) % ring.length];
          return a + p.x * q.y - q.x * p.y;
        }, 0)
      ) /
        2,
    0
  );
const wet = (rings: Point[][], x: number, y: number) =>
  rings.some(ring => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  });

describe("lossless water polygon packing", () => {
  it("collapses adjacent scanline slabs without rounding the coast", () => {
    const rings = Array.from({ length: 100 }, (_, i) => [
      { x: Math.sin(i) + 0.0000003, y: i },
      { x: 10, y: i },
      { x: 10, y: i + 1 },
      { x: Math.sin(i + 1) + 0.0000003, y: i + 1 }
    ]);
    const packed = packWaterPolygons(rings);
    expect(packed).toHaveLength(1);
    expect(packed[0]).toHaveLength(103);
    expect(area(packed)).toBeCloseTo(area(rings), 10);
    for (const ring of rings) expect(packed[0]).toContainEqual(ring[0]);
  });

  it("splits partially shared horizontal boundaries at existing endpoints", () => {
    const rings = [rectangle(0, 0, 10, 2), rectangle(2, 2, 8, 4)];
    const packed = packWaterPolygons(rings);
    expect(packed).toHaveLength(1);
    expect(packed[0]).toHaveLength(8);
    expect(area(packed)).toBe(32);
    expect(wet(packed, 1, 3)).toBe(false);
    expect(wet(packed, 3, 3)).toBe(true);
  });

  it("keeps islands dry by retaining separate positive fill pieces around holes", () => {
    const rings = [rectangle(0, 0, 10, 2), rectangle(0, 2, 2, 8), rectangle(8, 2, 10, 8), rectangle(0, 8, 10, 10)];
    const packed = packWaterPolygons(rings);
    expect(packed.length).toBeGreaterThan(1);
    expect(packed.length).toBeLessThan(rings.length);
    expect(area(packed)).toBe(64);
    for (let x = 0.25; x < 10; x += 0.5)
      for (let y = 0.25; y < 10; y += 0.5) expect(wet(packed, x, y)).toBe(wet(rings, x, y));
    expect(wet(packed, 5, 5)).toBe(false);
  });

  it("does not join disconnected water or pieces touching at only one point", () => {
    const rings = [rectangle(0, 0, 2, 2), rectangle(2, 2, 4, 4), rectangle(7, 0, 8, 2)];
    expect(packWaterPolygons(rings)).toHaveLength(3);
  });

  it("preserves a narrow dry gap instead of snapping nearly matching boundaries", () => {
    const rings = [rectangle(0, 0, 2, 2), rectangle(0, 2.000000001, 2, 4)];
    expect(packWaterPolygons(rings)).toHaveLength(2);
    expect(wet(packWaterPolygons(rings), 1, 2.0000000005)).toBe(false);
  });

  it("removes interpolation roundoff but retains genuine small shoreline bends", () => {
    const point = { x: 1000 + Number.EPSILON * 512, y: 1 };
    const ring = [{ x: 1000, y: 0 }, { x: 1010, y: 0 }, { x: 1010, y: 2 }, { x: 1000, y: 2 }, point];
    expect(packWaterPolygons([ring])[0]).toHaveLength(4);
    const bent = [...ring.slice(0, -1), { x: 1000.00000001, y: 1 }];
    expect(packWaterPolygons([bent])[0]).toContainEqual(bent.at(-1));
  });

  it("retains a 0.0001m dry channel at survey-scale coordinates", () => {
    const rings = [rectangle(7990, 0, 7999, 4), rectangle(7999.0001, 0, 8000, 4)];
    const packed = packWaterPolygons(rings);
    expect(packed).toHaveLength(2);
    expect(wet(packed, 7999.00005, 2)).toBe(false);
    expect(packed).toEqual(rings);
  });

  it("retains shared contact vertices even when they look like interpolation roundoff", () => {
    const contact = { x: 1000 + Number.EPSILON * 512, y: 1 };
    const first = [{ x: 1000, y: 0 }, { x: 1010, y: 0 }, { x: 1010, y: 2 }, { x: 1000, y: 2 }, contact];
    const second = [contact, { x: 999, y: 0.5 }, { x: 999, y: 1.5 }];
    const packed = packWaterPolygons([first, second]);
    expect(packed).toHaveLength(2);
    for (const ring of packed) expect(ring).toContainEqual(contact);
  });

  it("handles reversed winding and explicit closure without mutating input", () => {
    const first = rectangle(0, 0, 4, 2).reverse();
    first.push(first[0]);
    const rings = [first, rectangle(0, 2, 4, 4)];
    const original = structuredClone(rings);
    const packed = packWaterPolygons(rings);
    expect(packed).toHaveLength(1);
    expect(packed[0]).toHaveLength(4);
    expect(rings).toEqual(original);
    expect(packWaterPolygons(rings)).toEqual(packed);
  });

  it("accepts empty input", () => expect(packWaterPolygons([])).toEqual([]));
});
