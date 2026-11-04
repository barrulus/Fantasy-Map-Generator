import Alea from "alea";
import { Lattice } from "@/model/graph/lattice";
import { calculateVoronoi } from "@/model/graph/voronoi";
import type { MapData } from "@/model/options/options-schema";
import type { Point } from "@/types/global";
import type { GridCells, GridGraph } from "@/types/grid-graph";
import { FlatQueue } from "@/utils/flat-queue";
import { SEA_LEVEL } from "@/utils/height-utils";
import { log } from "@/utils/logger";
import { rn } from "@/utils/number-utils";
// The initial graph: points on a sampling lattice and their Voronoi diagram

/** square pixels over the map, row by row, each holding the cell under its centre */
export interface GridRaster {
  width: number;
  height: number;
  cells: Uint32Array;
}

const EDGE_RINGS = 3;

class GridModule {
  private readonly rasters = new WeakMap<GridGraph, GridRaster>();
  private visited = new Uint32Array(0); // getRings stamps per cell
  private visit = 0;

  prepare(graph?: GridGraph): void {
    if (graph) this.resetHeights(graph);
    grid = graph ?? this.generate(options.map.seed);
  }

  generate(seed: string, settings: MapData["graph"] = options.map.graph): GridGraph {
    Math.random = Alea(seed); // reset PRNG

    const { width, height, points: cellsDesired, sampling, jitter } = settings;
    const spacing = this.getSpacing(cellsDesired, width, height);
    log.time("placePoints");
    const { cellsX, cellsY, points, boundary } = Lattice.placePoints(
      { sampling, width, height, spacing, jitter },
      Math.random
    );
    log.timeEnd("placePoints");

    const { cells, vertices } = calculateVoronoi(points, boundary);
    const graph = { sampling, spacing, cellsX, cellsY, boundary, points, cells, vertices } as GridGraph;
    this.resetHeights(graph);

    return graph;
  }

  /**
   * rebuild the Voronoi diagram of a stored graph: saves keep only the points and the boundary,
   * cells and vertices are derived from them on load, the sampling comes from the loaded map settings
   */
  rebuildGraph(graph: GridGraph): void {
    const { cells, vertices } = calculateVoronoi(graph.points, graph.boundary);
    graph.sampling = options.map.graph.sampling;
    graph.cells = cells as GridCells;
    graph.vertices = vertices;
    this.resetHeights(graph);
  }

  /** blank the heightmap, keeping the graph itself: the heightmap generator starts from an empty canvas */
  resetHeights(graph: GridGraph): void {
    graph.cells.h = new Uint8Array(graph.points.length);
  }

  /** number of cells requested by the user, the generated number is close but not equal to it */
  getCellsDesired(): number {
    return options.map.graph.points;
  }

  /** cell at the given coordinates: the lattice slot, then the closest neighbour until none is closer */
  findCell(x: number, y: number, graph: GridGraph = grid): number {
    const { points, cells } = graph;
    let cellId = Lattice.findSlot(x, y, graph);
    let distance = (points[cellId][0] - x) ** 2 + (points[cellId][1] - y) ** 2;

    for (let checked = -1; checked !== cellId; ) {
      checked = cellId;
      // the boundary pseudo-points cut the walk along the map edge, there it looks a few rings around
      const candidates = cells.b[checked] ? this.getRings(checked, EDGE_RINGS, cells.c) : cells.c[checked];
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        const candidateDistance = (points[candidate][0] - x) ** 2 + (points[candidate][1] - y) ** 2;
        if (candidateDistance >= distance) continue;
        cellId = candidate;
        distance = candidateDistance;
      }
    }

    return cellId;
  }

  /** cell indexes within the radius from the given coordinates */
  findAll(x: number, y: number, radius: number, graph: GridGraph = grid): number[] {
    const cellId = this.findCell(x, y, graph);
    const rings = Math.floor(radius / Lattice.getSteps(graph.sampling, graph.spacing).neighborDistance);
    if (!rings || radius === 1) return [cellId];
    return this.getRings(cellId, rings, graph.cells.c);
  }

  /** the cell and every cell up to the given number of neighbour steps away */
  private getRings(cellId: number, rings: number, neighbors: number[][]): number[] {
    // a visit stamps the cells it reaches, so no visited list is searched or allocated
    if (this.visited.length < neighbors.length || this.visit === 0xffffffff) {
      this.visited = new Uint32Array(neighbors.length);
      this.visit = 0;
    }
    const visit = ++this.visit;
    const { visited } = this;

    const found = [cellId];
    visited[cellId] = visit;
    for (let ring = 0, start = 0; ring < rings; ring++) {
      const end = found.length; // the previous ring is found[start..end)
      for (let i = start; i < end; i++) {
        const cellNeighbors = neighbors[found[i]];
        for (let j = 0; j < cellNeighbors.length; j++) {
          const neighborId = cellNeighbors[j];
          if (visited[neighborId] === visit) continue;
          visited[neighborId] = visit;
          found.push(neighborId);
        }
      }
      start = end;
    }
    return found;
  }

  /** the grid as square pixels for images and textures: the lattice slots themselves on the square lattice */
  getRaster(graph: GridGraph = grid, width = options.map.graph.width, height = options.map.graph.height): GridRaster {
    const { sampling, spacing, cellsX, cellsY, cells } = graph;
    if (sampling === "square") return { width: cellsX, height: cellsY, cells: cells.i as Uint32Array };

    const rasterWidth = Math.round(width / spacing);
    const rasterHeight = Math.round(height / spacing);
    const cached = this.rasters.get(graph);
    if (cached?.width === rasterWidth && cached.height === rasterHeight) return cached;

    const pixels = new Uint32Array(rasterWidth * rasterHeight);
    for (let row = 0, pixel = 0; row < rasterHeight; row++) {
      const y = ((row + 0.5) * height) / rasterHeight;
      for (let col = 0; col < rasterWidth; col++, pixel++) {
        pixels[pixel] = this.findCell(((col + 0.5) * width) / rasterWidth, y, graph);
      }
    }

    const raster = { width: rasterWidth, height: rasterHeight, cells: pixels };
    this.rasters.set(graph, raster);
    return raster;
  }

  /** per-cell values as raster pixels, `channels` values per cell and per pixel */
  rasterize(values: ArrayLike<number>, raster: GridRaster, channels = 1): Uint8Array {
    const pixels = new Uint8Array(raster.cells.length * channels);
    for (let pixel = 0; pixel < raster.cells.length; pixel++) {
      const cellId = raster.cells[pixel];
      for (let channel = 0; channel < channels; channel++) {
        pixels[pixel * channels + channel] = values[cellId * channels + channel];
      }
    }
    return pixels;
  }

  /** cell polygon points, empty for an orphan cell that got no Voronoi vertices */
  getPolygon(cellId: number, graph: GridGraph = grid): Point[] {
    const vertexIds = graph.cells.v[cellId];
    if (!vertexIds) return [];
    return vertexIds.map(vertexId => graph.vertices.p[vertexId]);
  }

  /** the lattice step that makes each cell cover the same area */
  private getSpacing(cellsDesired: number, width: number, height: number): number {
    return rn(Math.sqrt((width * height) / cellsDesired), 2);
  }

  /** turn depressions that cannot pour to water into lakes */
  addDeepDepressionLakes(): void {
    const { cells, features } = grid;

    for (const lakeCells of this.findDeepDepressionLakes(cells, options.generation.lakeElevationLimit)) {
      const featureId = features.length;

      for (const i of lakeCells) {
        cells.h[i] = 19;
        cells.t[i] = -1;
        cells.f[i] = featureId;

        // only a LAND neighbour becomes shore; an ocean one has to stay at t = -1
        for (const neibId of cells.c[i]) {
          if (cells.h[neibId] >= SEA_LEVEL && !lakeCells.includes(neibId)) cells.t[neibId] = 1;
        }
      }

      features.push({ i: featureId, land: false, border: false, type: "lake" });
    }
  }

  /** cell groups of the land depressions that cannot pour to water within the elevation limit: the lakes to be */
  findDeepDepressionLakes(cells: Pick<GridCells, "i" | "c" | "b" | "h">, elevationLimit: number): number[][] {
    if (elevationLimit === 80) return [];

    const { c, b } = cells;
    const h = Uint8Array.from(cells.h); // lakes form in turn: an earlier one is the water a later check can reach
    const lakes: number[][] = [];

    const n = cells.i.length;

    // Priority flood from the ocean: spillpoint[i] is the lowest water level that would flood cell i
    // from the ocean, i.e. the saddle height on the easiest way out. One O((N + E) log N) pass replaces
    // the per-minimum BFS, which degenerated on dense single-basin templates (volcano, taklamakan).
    const spillpoint = new Float32Array(n);
    const visited = new Uint8Array(n);
    const queue = new FlatQueue();

    for (let i = 0; i < n; i++) {
      if (h[i] < SEA_LEVEL || b[i]) {
        spillpoint[i] = h[i];
        visited[i] = 1;
        queue.push(i, h[i]);
      }
    }

    while (queue.length) {
      const cellSpill = queue.peekValue();
      const cellId = queue.pop();
      for (const neibId of c[cellId]) {
        if (visited[neibId]) continue;
        visited[neibId] = 1;
        const spill = Math.max(h[neibId], cellSpill);
        spillpoint[neibId] = spill;
        queue.push(neibId, spill);
      }
    }

    // a land local minimum sitting more than elevationLimit below its spillpoint is a deep depression
    for (let i = 0; i < n; i++) {
      if (b[i] || h[i] < SEA_LEVEL) continue;
      if (spillpoint[i] - h[i] < elevationLimit) continue;
      if (c[i].some(neibId => h[neibId] < h[i])) continue;

      const lakeCells = [i, ...c[i].filter(neibId => h[neibId] === h[i])];
      for (const cell of lakeCells) h[cell] = 19;
      lakes.push(lakeCells);
    }

    return lakes;
  }

  /** near sea lakes get a lot of water inflow, most of them should break the threshold and flow out to sea (see Ancylus Lake) */
  openNearSeaLakes(): void {
    if (options.generation.template === "Atoll") return; // no need for Atolls

    const { cells, features } = grid;
    if (!features.find(f => f.type === "lake")) return; // no lakes
    const LIMIT = 22; // max height that can be breached by water

    // Relabelling every cell of a breached lake on the spot is O(lakes x cells). Every guard below reads
    // features[id].type, which is flipped eagerly, never the raw cells.f id, so the relabel can be batched
    // into one final pass. A breach may target a lake whose own relabel is still pending, so entries chain
    // (A -> B -> ocean) and are resolved at the end.
    const remap = new Map<number, number>();
    const resolveFeature = (id: number) => {
      while (remap.has(id)) id = remap.get(id) as number;
      return id;
    };

    const removeLake = (thresholdCellId: number, lakeFeatureId: number, oceanFeatureId: number) => {
      cells.h[thresholdCellId] = 19;
      cells.t[thresholdCellId] = -1;
      cells.f[thresholdCellId] = oceanFeatureId;
      for (const c of cells.c[thresholdCellId]) {
        if (cells.h[c] >= SEA_LEVEL) cells.t[c] = 1; // mark as coastline
      }

      remap.set(lakeFeatureId, oceanFeatureId);
      features[lakeFeatureId].type = "ocean"; // mark former lake as ocean
    };

    for (const i of cells.i) {
      const lakeFeatureId = cells.f[i];
      if (features[lakeFeatureId].type !== "lake") continue; // not a lake

      check_neighbours: for (const c of cells.c[i]) {
        if (cells.t[c] !== 1 || cells.h[c] > LIMIT) continue; // water cannot break this

        for (const n of cells.c[c]) {
          const ocean = cells.f[n];
          if (features[ocean].type !== "ocean") continue; // not an ocean
          removeLake(c, lakeFeatureId, ocean);
          break check_neighbours;
        }
      }
    }

    if (remap.size) {
      for (const i of cells.i) {
        if (remap.has(cells.f[i])) cells.f[i] = resolveFeature(cells.f[i]);
      }
    }
  }
}

export const Grid = new GridModule();
