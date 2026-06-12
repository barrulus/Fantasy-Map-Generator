import polylabel from "polylabel";
import { rn } from "./numberUtils";

/**
 * Generates SVG path data for filling a shape defined by a chain of vertices.
 * @param {object} vertices - The vertices object containing positions.
 * @param {number[]} vertexChain - An array of vertex IDs defining the shape.
 * @returns {string} SVG path data for the filled shape.
 */
const getFillPath = (vertices: any, vertexChain: number[]) => {
  const points = vertexChain.map(vertexId => vertices.p[vertexId]);
  const firstPoint = points.shift();
  return `M${firstPoint} L${points.join(" ")} Z`;
};

/**
 * Generates SVG path data for borders based on a chain of vertices and a discontinuation condition.
 * @param {object} vertices - The vertices object containing positions.
 * @param {number[]} vertexChain - An array of vertex IDs defining the border.
 * @param {(vertexId: number) => boolean} discontinue - A function that determines if the path should discontinue at a vertex.
 * @returns {string} SVG path data for the border.
 */
const getBorderPath = (vertices: any, vertexChain: number[], discontinue: (vertexId: number) => boolean) => {
  let discontinued = true;
  let lastOperation = "";
  const path = vertexChain.map(vertexId => {
    if (discontinue(vertexId)) {
      discontinued = true;
      return "";
    }

    const operation = discontinued ? "M" : "L";
    discontinued = false;
    lastOperation = operation;

    const command = operation === "L" && operation === lastOperation ? "" : operation;
    return ` ${command}${vertices.p[vertexId]}`;
  });

  return path.join("").trim();
};

/**
 * Restores the path from exit to start using the 'from' mapping.
 * @param {number} exit - The ID of the exit cell.
 * @param {number} start - The ID of the starting cell.
 * @param {number[]} from - An array mapping each cell ID to the cell ID it came from.
 * @returns {number[]} An array of cell IDs representing the path from start to exit.
 */
const restorePath = (exit: number, start: number, from: Int32Array | number[]) => {
  const pathCells = [];

  let current = exit;
  let prev = exit;

  while (current !== start) {
    pathCells.push(current);
    prev = from[current];
    current = prev;
  }

  pathCells.push(current);

  return pathCells.reverse();
};

/**
 * Returns isolines (borders) for different types of cells in the graph.
 * @param {object} graph - The graph object containing cells and vertices.
 * @param {(cellId: number) => any} getType - A function that returns the type of a cell given its ID.
 * @param {object} [options] - Options to specify which isoline formats to generate.
 * @param {boolean} [options.polygons=false] - Whether to generate polygons for each type.
 * @param {boolean} [options.fill=false] - Whether to generate fill paths for each type.
 * @param {boolean} [options.halo=false] - Whether to generate halo paths for each type.
 * @param {boolean} [options.waterGap=false] - Whether to generate water gap paths for each type.
 * @returns {object} An object containing isolines for each type based on the specified options.
 */
export const getIsolines = (
  graph: any,
  getType: (cellId: number) => any,
  options: {
    polygons?: boolean;
    fill?: boolean;
    halo?: boolean;
    waterGap?: boolean;
  } = { polygons: false, fill: false, halo: false, waterGap: false }
): any => {
  const { cells, vertices } = graph;
  const isolines: any = {};

  const checkedCells = new Uint8Array(cells.i.length);
  const addToChecked = (cellId: number) => {
    checkedCells[cellId] = 1;
  };
  const isChecked = (cellId: number) => checkedCells[cellId] === 1;

  for (const cellId of cells.i) {
    if (isChecked(cellId) || !getType(cellId)) continue;
    addToChecked(cellId);

    const type = getType(cellId);
    const ofSameType = (cellId: number) => getType(cellId) === type;
    const ofDifferentType = (cellId: number) => getType(cellId) !== type;

    const onborderCell = cells.c[cellId].find(ofDifferentType);
    if (onborderCell === undefined) continue;

    // check if inner lake. Note there is no shoreline for grid features
    const feature = graph.features[cells.f[onborderCell]];
    if (feature.type === "lake" && feature.shoreline?.every(ofSameType)) continue;

    const startingVertex = cells.v[cellId].find((v: number) => vertices.c[v].some(ofDifferentType));
    if (startingVertex === undefined) throw new Error(`Starting vertex for cell ${cellId} is not found`);

    const vertexChain = connectVertices({
      vertices,
      startingVertex,
      ofSameType,
      addToChecked,
      closeRing: true
    });
    if (vertexChain.length < 3) continue;

    addIsolineTo(type, vertices, vertexChain, isolines, options);
  }

  return isolines;

  function addIsolineTo(type: any, vertices: any, vertexChain: number[], isolines: any, options: any) {
    if (!isolines[type]) isolines[type] = {};

    if (options.polygons) {
      if (!isolines[type].polygons) isolines[type].polygons = [];
      isolines[type].polygons.push(vertexChain.map(vertexId => vertices.p[vertexId]));
    }

    if (options.fill) {
      if (!isolines[type].fill) isolines[type].fill = "";
      isolines[type].fill += getFillPath(vertices, vertexChain);
    }

    if (options.waterGap) {
      if (!isolines[type].waterGap) isolines[type].waterGap = "";
      const isLandVertex = (vertexId: number) => vertices.c[vertexId].every((i: number) => cells.h[i] >= 20);
      isolines[type].waterGap += getBorderPath(vertices, vertexChain, isLandVertex);
    }

    if (options.halo) {
      if (!isolines[type].halo) isolines[type].halo = "";
      const isBorderVertex = (vertexId: number) => vertices.c[vertexId].some((i: number) => cells.b[i]);
      isolines[type].halo += getBorderPath(vertices, vertexChain, isBorderVertex);
    }
  }
};

/**
 * Generates SVG path data for the border of a shape defined by a chain of vertices.
 * @param {number[]} cellsArray - An array of cell IDs defining the shape.
 * @param {object} packedGraph - The packed graph object containing cells and vertices.
 * @returns {string} SVG path data for the border of the shape.
 */
export const getVertexPath = (cellsArray: number[], packedGraph: any = {}) => {
  const { cells, vertices } = packedGraph;

  const cellsObj = Object.fromEntries(cellsArray.map(cellId => [cellId, true]));
  const ofSameType = (cellId: number) => cellsObj[cellId];
  const ofDifferentType = (cellId: number) => !cellsObj[cellId];

  const checkedCells = new Uint8Array(cells.c.length);
  const addToChecked = (cellId: number) => {
    checkedCells[cellId] = 1;
  };
  const isChecked = (cellId: number) => checkedCells[cellId] === 1;
  let path = "";

  for (const cellId of cellsArray) {
    if (isChecked(cellId)) continue;

    const onborderCell = cells.c[cellId].find(ofDifferentType);
    if (onborderCell === undefined) continue;

    const feature = packedGraph.features[cells.f[onborderCell]];
    if (feature.type === "lake" && feature.shoreline) {
      if (feature.shoreline.every(ofSameType)) continue; // inner lake
    }

    const startingVertex = cells.v[cellId].find((v: number) => vertices.c[v].some(ofDifferentType));
    if (startingVertex === undefined) throw new Error(`Starting vertex for cell ${cellId} is not found`);

    const vertexChain = connectVertices({
      vertices,
      startingVertex,
      ofSameType,
      addToChecked,
      closeRing: true
    });
    if (vertexChain.length < 3) continue;

    path += getFillPath(vertices, vertexChain);
  }

  return path;
};

/**
 * Finds the poles of inaccessibility for each type of cell in the graph.
 * @param {object} graph - The graph object containing cells and vertices.
 * @param {(cellId: number) => any} getType - A function that returns the type of a cell given its ID.
 * @returns {object} An object mapping each type to its pole of inaccessibility coordinates [x, y].
 */
export const getPolesOfInaccessibility = (graph: any, getType: (cellId: number) => any) => {
  const isolines = getIsolines(graph, getType, { polygons: true });

  const poles = Object.entries(isolines).map(([id, isoline]) => {
    const multiPolygon = (isoline as any).polygons.sort((a: any, b: any) => b.length - a.length);
    const [x, y] = polylabel(multiPolygon, 20);
    return [id, [rn(x), rn(y)]];
  });

  return Object.fromEntries(poles);
};

/**
 * Connects vertices to form a closed path based on cell type.
 * @param {object} options - Options for connecting vertices.
 * @param {object} options.vertices - The vertices object containing connections.
 * @param {number} options.startingVertex - The ID of the starting vertex.
 * @param {(cellId: number) => boolean} options.ofSameType - A function that checks if a cell is of the same type.
 * @param {(cellId: number) => void} [options.addToChecked] - A function to mark cells as checked.
 * @param {boolean} [options.closeRing=false] - Whether to close the path into a ring.
 * @returns {number[]} An array of vertex IDs forming the connected path.
 */
export const connectVertices = ({
  vertices,
  startingVertex,
  ofSameType,
  addToChecked,
  closeRing
}: {
  vertices: any;
  startingVertex: number;
  ofSameType: (cellId: number) => boolean;
  addToChecked?: (cellId: number) => void;
  closeRing?: boolean;
}) => {
  const MAX_ITERATIONS = vertices.c.length;
  const chain = []; // vertices chain to form a path

  let next = startingVertex;
  for (let i = 0; i === 0 || next !== startingVertex; i++) {
    const previous = chain.at(-1);
    const current = next;
    chain.push(current);

    const neibCells = vertices.c[current];
    if (addToChecked) neibCells.filter(ofSameType).forEach(addToChecked);

    const [c1, c2, c3] = neibCells.map(ofSameType);
    const [v1, v2, v3] = vertices.v[current];

    if (v1 !== previous && c1 !== c2) next = v1;
    else if (v2 !== previous && c2 !== c3) next = v2;
    else if (v3 !== previous && c1 !== c3) next = v3;

    if (next >= vertices.c.length) {
      window.ERROR && console.error("ConnectVertices: next vertex is out of bounds");
      break;
    }

    if (next === current) {
      window.ERROR && console.error("ConnectVertices: next vertex is not found");
      break;
    }

    if (i === MAX_ITERATIONS) {
      window.ERROR && console.error("ConnectVertices: max iterations reached", MAX_ITERATIONS);
      break;
    }
  }

  if (closeRing) chain.push(startingVertex);
  return chain;
};

let scratchFrom: Int32Array | null = null;
let scratchCost: Float32Array | null = null;
let scratchMark: Uint32Array | null = null;
let scratchClosed: Uint32Array | null = null;
let scratchGen = 0;

function ensureScratch(cellCount: number) {
  if (!scratchFrom || scratchFrom.length !== cellCount) {
    scratchFrom = new Int32Array(cellCount);
    scratchCost = new Float32Array(cellCount);
    scratchMark = new Uint32Array(cellCount);
    scratchClosed = new Uint32Array(cellCount);
    scratchGen = 0;
  }
}

export const findPath = (
  start: number,
  isExit: (id: number) => boolean,
  getCost: (current: number, next: number) => number,
  packedGraph: any = {},
  goal?: number,
  wrapWidth?: number
): number[] | null => {
  if (isExit(start)) return null;

  const cellCount = packedGraph.cells.i.length;
  ensureScratch(cellCount);
  scratchGen++;
  const gen = scratchGen;
  const from = scratchFrom!;
  const cost = scratchCost!;
  const mark = scratchMark!;

  const queue = new window.FlatQueue();
  queue.push(start, 0);
  cost[start] = 0;
  from[start] = -1;
  mark[start] = gen;

  const cellsP = packedGraph.cells.p as [number, number][];
  const useHeuristic = typeof goal === "number" && goal >= 0 && cellsP[goal] !== undefined;
  const gx = useHeuristic ? cellsP[goal as number][0] : 0;
  const gy = useHeuristic ? cellsP[goal as number][1] : 0;

  const heuristic = useHeuristic
    ? (cellId: number) => {
        const p = cellsP[cellId];
        let dx = p[0] - gx;
        if (wrapWidth) {
          const abs = Math.abs(dx);
          dx = Math.min(abs, wrapWidth - abs);
        }
        const dy = p[1] - gy;
        return Math.sqrt(dx * dx + dy * dy);
      }
    : null;

  while (queue.length) {
    const current = queue.pop();
    const currentCost = cost[current];

    const neighbors = packedGraph.cells.c[current];
    for (let i = 0; i < neighbors.length; i++) {
      const next = neighbors[i];
      if (isExit(next)) {
        from[next] = current;
        return restorePath(next, start, from);
      }

      const nextCost = getCost(current, next);
      if (nextCost === Infinity) continue;
      const totalCost = currentCost + nextCost;

      const existing = mark[next] === gen ? cost[next] : Infinity;
      if (totalCost >= existing) continue;

      from[next] = current;
      cost[next] = totalCost;
      mark[next] = gen;
      const priority = heuristic ? totalCost + heuristic(next) : totalCost;
      queue.push(next, priority);
    }
  }

  return null;
};

/**
 * Single-source, multi-target shortest paths (plain Dijkstra) returning one path
 * per reachable target. Cheaper than running findPath once per target because the
 * search tree is shared: every target's path branches off one expansion from
 * `start`. Targets settle when first popped (optimal for non-negative costs), and
 * the search stops once all are settled. Paths from the same tree share a common
 * prefix near `start`, which downstream segment-dedup collapses into one corridor.
 *
 * No A* heuristic — with many goals there is no single point to aim at, and the
 * targets are clustered near the source so the explored frontier stays bounded.
 *
 * `maxCost` bounds the search ball: Dijkstra pops in non-decreasing cost order,
 * so once a popped cell exceeds it every unsettled target is farther than the
 * bound and the search stops (those targets are omitted from the result). A
 * target discovered from a frontier cell within the bound still settles.
 */
export const findPathTree = (
  start: number,
  targets: Iterable<number>,
  getCost: (current: number, next: number) => number,
  packedGraph: any = {},
  options?: { maxCost?: number; stats?: { expanded: number } }
): Map<number, number[]> => {
  const result = new Map<number, number[]>();
  const remaining = new Set<number>();
  for (const t of targets) if (t !== start) remaining.add(t);
  if (!remaining.size) return result;

  const cellCount = packedGraph.cells.i.length;
  ensureScratch(cellCount);
  scratchGen++;
  const gen = scratchGen;
  const from = scratchFrom!;
  const cost = scratchCost!;
  const mark = scratchMark!;

  const queue = new window.FlatQueue();
  queue.push(start, 0);
  cost[start] = 0;
  from[start] = -1;
  mark[start] = gen;
  const closed = scratchClosed!;

  const maxCost = options?.maxCost ?? Infinity;
  const stats = options?.stats;

  while (queue.length && remaining.size) {
    const current = queue.pop();
    // Closed-set skip: a cell relaxed k times leaves k-1 stale queue entries;
    // re-expanding them re-scans every neighbor for nothing. Plain Dijkstra
    // (no heuristic) settles optimally on first pop, so later pops are pure
    // waste. Generation-marked to avoid clearing between calls; NOT a float
    // cost comparison — Float32 scratch vs Float64 priorities breaks equality
    // (see the expandStates staleness comment in states-generator).
    if (closed[current] === gen) continue;
    closed[current] = gen;
    const currentCost = cost[current];
    if (currentCost > maxCost) break;
    if (stats) stats.expanded++;
    const neighbors = packedGraph.cells.c[current];
    for (let i = 0; i < neighbors.length; i++) {
      const next = neighbors[i];

      // Settle a target on DISCOVERY, before the cost gate — exactly like findPath's
      // isExit check. Real destinations (ports) sit on land cells that cost Infinity
      // to enter, so they are never relaxed/enqueued; discovery is the only way to
      // reach them. We do not expand through a settled target (don't relax it below).
      if (remaining.has(next)) {
        from[next] = current;
        result.set(next, restorePath(next, start, from));
        remaining.delete(next);
        if (!remaining.size) return result;
        continue;
      }

      const nextCost = getCost(current, next);
      if (nextCost === Infinity) continue;
      const totalCost = currentCost + nextCost;

      const existing = mark[next] === gen ? cost[next] : Infinity;
      if (totalCost >= existing) continue;

      from[next] = current;
      cost[next] = totalCost;
      mark[next] = gen;
      queue.push(next, totalCost);
    }
  }

  return result;
};

declare global {
  interface Window {
    ERROR: boolean;
    FlatQueue: any;

    getIsolines: typeof getIsolines;
    getPolesOfInaccessibility: typeof getPolesOfInaccessibility;
    connectVertices: typeof connectVertices;
    findPath: typeof findPath;
    getVertexPath: typeof getVertexPath;
  }
}
