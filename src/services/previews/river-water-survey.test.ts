// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/generators/river-generator";
import type { Burg } from "@/generators/burgs-generator";
import type { River } from "@/generators/river-generator";
import { projectRiverSurvey, surveyBurgRivers, surveyRiver } from "./river-water-survey";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const river = { i: 7, cells: [0, 1, 2, 3], widthFactor: 1, sourceWidth: 0.15, width: 99 } as River;
const burg = { x: 0, y: 0 } as Burg;

describe("local model river surveys", () => {
  it("preserves the deterministic edited course shared with drawing without changing saved anchors", () => {
    vi.stubGlobal("options", { map: { graph: { width: 100, height: 100 } } });
    vi.stubGlobal("pack", {
      cells: {
        p: [
          [0, 0],
          [10, 0],
          [20, 0]
        ],
        h: [30, 30, 10],
        fl: [100, 200, 300]
      }
    });
    const edited = {
      ...river,
      cells: [0, 1, 2],
      points: [
        [0, 2],
        [10, 4],
        [20, 2]
      ] as [number, number][]
    };
    const original = structuredClone(edited);
    const canonical = Rivers.addMeandering(edited.cells, edited.points);
    const drawn = Rivers.getRiverPath(canonical, edited.widthFactor, edited.sourceWidth);
    const survey = surveyRiver(edited, { x: 10, y: 20 }, 100, 3000).rivers[0];
    expect(survey.centreline.length).toBeGreaterThan(canonical.length);
    expect(survey.courseSource).toBe("fmg-catmull-rom-0.1");
    for (const [x, y] of canonical)
      expect(survey.centreline).toContainEqual({
        x: Math.round((x - 10) * 10000) / 100,
        y: Math.round((y - 20) * 10000) / 100
      });
    expect(edited).toEqual(original);
    expect(
      Rivers.getRiverPath(Rivers.addMeandering(edited.cells, edited.points), edited.widthFactor, edited.sourceWidth)
    ).toBe(drawn);
    expect(survey.widthsM.every(width => width > 0)).toBe(true);
  });

  it("retains bends, varying widths and source identity without meandering again", () => {
    const course: [number, number, number][] = [
      [-10000, 0, 0],
      [-100, 0, 0],
      [0, 80, 0],
      [100, 0, 0],
      [10000, 0, 0]
    ];
    const result = projectRiverSurvey(7, course, [10, 20, 30, 40, 100], burg, 1, 3000);
    expect(result.omitted).toBe(false);
    expect(result.rivers).toHaveLength(1);
    const survey = result.rivers[0];
    expect(survey).toMatchObject({ id: "7", widthSource: "fmg-local-width-model", meander: false });
    expect(survey.centreline.slice(1, -1)).toEqual([
      { x: -100, y: 0 },
      { x: 0, y: 80 },
      { x: 100, y: 0 }
    ]);
    expect(survey.widthsM.slice(1, -1)).toEqual([20, 30, 40]);
    expect(survey.centreline[0].x).toBe(-3201);
    expect(survey.centreline.at(-1)!.x).toBeCloseTo(3201, 8);
    expect(survey.widthsM[0]).toBeCloseTo(10 + ((10000 - 3201) / 9900) * 10);
    expect(survey.widthM).toBeGreaterThan(20);
    expect(survey.widthM).toBeLessThan(40);
  });

  it("does not join disconnected river reentries across unsurveyed geography", () => {
    const course: [number, number, number][] = [
      [-5000, -100, 0],
      [5000, -100, 0],
      [5000, 100, 0],
      [-5000, 100, 0]
    ];
    const result = projectRiverSurvey(7, course, [20, 20, 20, 20], burg, 1, 3000);
    expect(result.rivers).toHaveLength(2);
    expect(result.rivers.map(r => r.centreline.map(p => p.y))).toEqual([
      [-100, -100],
      [100, 100]
    ]);
  });

  it("keeps a river whose bank enters coverage while its centreline is outside", () => {
    const result = projectRiverSurvey(
      7,
      [
        [-5000, 3010, 0],
        [5000, 3010, 0]
      ],
      [40, 40],
      burg,
      1,
      3000
    );
    expect(result.rivers).toHaveLength(1);
  });

  it("retains an exterior sharp bend whose capped bank miter enters the survey", () => {
    const result = projectRiverSurvey(
      7,
      [
        [3100, -10, 0],
        [3025, 0, 0],
        [3100, 10, 0]
      ],
      [20, 20, 20],
      burg,
      1,
      3000
    );
    expect(result.rivers).toHaveLength(1);
    const course = result.rivers[0].centreline;
    expect(course).toHaveLength(3);
    expect(course[1]).toEqual({ x: 3025, y: 0 });
    expect(course[0].x).toBeCloseTo(3041);
    expect(course[2].x).toBeCloseTo(3041);
    expect((course[1].y - course[0].y) / (course[1].x - course[0].x)).toBeCloseTo(-10 / 75);
    expect((course[2].y - course[1].y) / (course[2].x - course[1].x)).toBeCloseTo(10 / 75);
    expect(course[1].x - (4 * result.rivers[0].widthsM[1]) / 2).toBe(2985);
  });

  it("reports an unavailable local width rather than clamping it or using mouth width", () => {
    expect(
      projectRiverSurvey(
        7,
        [
          [-100, 0, 0],
          [100, 0, 0]
        ],
        [0, 20],
        burg,
        1,
        3000
      )
    ).toEqual({ rivers: [], omitted: true });
    const distant = projectRiverSurvey(
      7,
      [
        [10000, 0, 0],
        [0, 0, 0]
      ],
      [0, 20],
      burg,
      1,
      3000
    );
    expect(distant.omitted).toBe(false);
    expect(distant.rivers[0].widthsM.every(w => w > 0)).toBe(true);
  });

  it("keeps the full-course index and cumulative discharge before clipping", () => {
    const course: [number, number, number][] = [
      [-20000, 0, 100],
      [-10000, 0, 0],
      [0, 0, 900],
      [10000, 0, 0]
    ];
    vi.spyOn(Rivers, "addMeandering").mockReturnValue(course);
    const offset = vi.spyOn(Rivers, "getOffset");
    const projected = surveyRiver(river, burg, 1, 3000);
    expect(offset.mock.calls.map(([p]) => [p.pointIndex, p.flux])).toEqual([
      [0, 100],
      [1, 100],
      [2, 900],
      [3, 900]
    ]);
    expect(projected.rivers[0].widthsM).toHaveLength(3);
    expect(projected.rivers[0].widthsM[1]).toBe(Rivers.getWidth(offset.mock.results[2].value) * 1000);
    expect(projected.rivers[0].widthM).toBeLessThan(river.width * 1000);
  });

  it("converts course coordinates once without rescaling locally modelled kilometre widths", () => {
    vi.spyOn(Rivers, "addMeandering").mockReturnValue([
      [-1, 0, 100],
      [0, 0, 100],
      [1, 0, 100]
    ]);
    const a = surveyRiver(river, burg, 1000, 3000).rivers[0];
    const b = surveyRiver(river, burg, 1609.344, 3000).rivers[0];
    expect(a.widthsM).toEqual(b.widthsM);
    expect(a.widthM).toBe(b.widthM);
    expect(a.centreline[0].x).toBe(-1000);
    expect(b.centreline[0].x).toBeCloseTo(-1609.344, 2);
  });

  it("uses edited anchors, matching the renderer's mismatched-anchor fallback", () => {
    const anchors: [number, number][] = [
      [0, 0],
      [1, 2],
      [2, 3],
      [4, 5]
    ];
    const course = vi.spyOn(Rivers, "addMeandering").mockReturnValue([
      [-10, 0, 100],
      [10, 0, 100]
    ]);
    surveyRiver({ ...river, points: anchors }, burg, 1, 3000);
    expect(course).toHaveBeenLastCalledWith(river.cells, anchors);
    surveyRiver({ ...river, points: anchors.slice(1) }, burg, 1, 3000);
    expect(course).toHaveBeenLastCalledWith(river.cells, undefined);
  });

  it("discovers crossings outside the coarse context and retains warnings for missing rivers", () => {
    vi.stubGlobal("pack", { rivers: [river] });
    vi.spyOn(Rivers, "addMeandering").mockReturnValue([
      [-10000, 0, 100],
      [10000, 0, 100]
    ]);
    const result = surveyBurgRivers(burg, 1, 3000, [99]);
    expect(result.rivers).toHaveLength(1);
    expect(result.omittedRiverIds).toEqual([99]);
  });

  it("does not report unrelated malformed rivers as missing beside this burg", () => {
    vi.stubGlobal("pack", {
      rivers: [
        { ...river, cells: [] },
        { ...river, i: 8, cells: [] }
      ]
    });
    expect(surveyBurgRivers(burg, 1, 3000, [8]).omittedRiverIds).toEqual([8]);
  });

  it("reports a local profile missing a width and rejects a one-point course", () => {
    expect(
      projectRiverSurvey(
        7,
        [
          [-100, 0, 0],
          [100, 0, 0]
        ],
        [20],
        burg,
        1,
        3000
      ).omitted
    ).toBe(true);
    expect(projectRiverSurvey(7, [[0, 0, 0]], [20], burg, 1, 3000).omitted).toBe(true);
  });
});
