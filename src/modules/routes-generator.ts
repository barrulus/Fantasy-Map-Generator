import { curveCatmullRom, line } from "d3";
import Delaunator from "delaunator";
import { distanceSquared, findClosestCell, findPath, getAdjective, isLand, ra, rn, round, rw } from "../utils";
import type { Burg } from "./burgs-generator";
import type { Point } from "./voronoi";

// --- Seam wrapping (full-globe maps only) ----------------------------------
// On a 360° equirectangular map the east/west edges are a seam: cells and burgs
// near opposite edges are close on the globe but far on the flat map. These
// helpers let sea & air routes cross that seam. Everything is inert unless the
// map spans a full 360° of longitude.

export function isWrapEnabled(): boolean {
  return typeof mapCoordinates !== "undefined" && !!mapCoordinates && mapCoordinates.lonT === 360;
}

// Horizontal gap on a cylinder of the given width: the shorter of going
// directly or around the seam.
export function wrapDeltaX(dx: number, width: number): number {
  const abs = Math.abs(dx);
  return Math.min(abs, width - abs);
}

// distanceSquared variant that wraps in X (and only X) when `wrap` is true.
export function wrapDistanceSquared(a: [number, number], b: [number, number], wrap: boolean, width: number): number {
  const dx = wrap ? wrapDeltaX(a[0] - b[0], width) : a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

// Trade-importance role weights (population multiplier). Higher = bigger hub.
const ROLE_MULT: Record<string, number> = {
  capital: 3.0,
  largePort: 2.2,
  regionalCenter: 1.6,
  marketTown: 1.2,
  largeVillage: 1.0,
  smallVillage: 1.0,
  hamlet: 0.8
};

// Sea-trade-network density preset ("medium/balanced"). Retune here.
const SEA_FEEDER_LINKS = 3; // top gravity partners each port connects to
const SEA_TRUNK_HUB_FRACTION = 0.1; // fraction of a component's ports that are hubs (min 2)
const SEA_TRUNK_LINKS = 3; // top hub-to-hub gravity partners per hub
const SEA_COASTAL_CAP_KM = 120; // max length for short coastal Urquhart pairs
const SEA_FEEDER_CAP_KM = 300; // feeders are regional; only trunk routes go long-haul
const SEA_TRUNK_SAFETY_CAP_KM = 600; // upper bound so two lone hubs cannot span the map
// Long-haul trade (trunk+feeder) only runs over the top-N most important ports per
// navigable component. Bounds the O(k^2) gravity selection and the long-haul A* path
// count regardless of map size; every port still gets short coastal links. Big maps
// can have tens of thousands of ports in one ocean, so this cap is essential.
const SEA_TRADE_MAX_PORTS = 500;

// Trade importance of a port: population weighted by its settlement role.
export function portImportance(burg: Burg): number {
  const role = burg.capital ? "capital" : (burg.settlementType ?? "");
  const mult = ROLE_MULT[role] ?? 1.0;
  return (burg.population ?? 0) * mult;
}

const ROUTES_SHARP_ANGLE = 135;
const ROUTES_VERY_SHARP_ANGLE = 115;

const MIN_PASSABLE_SEA_TEMP = -4;
const ROUTE_TYPE_MODIFIERS: Record<string, number> = {
  "-1": 1, // coastline
  "-2": 1.8, // sea
  "-3": 4, // open sea
  "-4": 6, // ocean
  default: 8 // far ocean
};

const ROUTE_TIER_MODIFIERS: Record<string, { cost: number }> = {
  royal: { cost: 0.4 },
  main: { cost: 0.6 },
  market: { cost: 1.0 }
};

const encodeConnection = (a: number, b: number) => a * (1 << 24) + b;

// name generator data
const models: Record<string, Record<string, number>> = {
  roads: {
    burg_suffix: 3,
    prefix_suffix: 6,
    the_descriptor_prefix_suffix: 2,
    the_descriptor_burg_suffix: 1
  },
  trails: { burg_suffix: 8, prefix_suffix: 1, the_descriptor_burg_suffix: 1 },
  searoutes: {
    burg_suffix: 4,
    prefix_suffix: 2,
    the_descriptor_prefix_suffix: 1
  },
  airroutes: {
    burg_suffix: 3,
    prefix_suffix: 4,
    the_descriptor_prefix_suffix: 2,
    the_descriptor_burg_suffix: 1
  }
};

const prefixes: string[] = [
  "King",
  "Queen",
  "Military",
  "Old",
  "New",
  "Ancient",
  "Royal",
  "Imperial",
  "Great",
  "Grand",
  "High",
  "Silver",
  "Dragon",
  "Shadow",
  "Star",
  "Mystic",
  "Whisper",
  "Eagle",
  "Golden",
  "Crystal",
  "Enchanted",
  "Frost",
  "Moon",
  "Sun",
  "Thunder",
  "Phoenix",
  "Sapphire",
  "Celestial",
  "Wandering",
  "Echo",
  "Twilight",
  "Crimson",
  "Serpent",
  "Iron",
  "Forest",
  "Flower",
  "Whispering",
  "Eternal",
  "Frozen",
  "Rain",
  "Luminous",
  "Stardust",
  "Arcane",
  "Glimmering",
  "Jade",
  "Ember",
  "Azure",
  "Gilded",
  "Divine",
  "Shadowed",
  "Cursed",
  "Moonlit",
  "Sable",
  "Everlasting",
  "Amber",
  "Nightshade",
  "Wraith",
  "Scarlet",
  "Platinum",
  "Whirlwind",
  "Obsidian",
  "Ethereal",
  "Ghost",
  "Spike",
  "Dusk",
  "Raven",
  "Spectral",
  "Burning",
  "Verdant",
  "Copper",
  "Velvet",
  "Falcon",
  "Enigma",
  "Glowing",
  "Silvered",
  "Molten",
  "Radiant",
  "Astral",
  "Wild",
  "Flame",
  "Amethyst",
  "Aurora",
  "Shadowy",
  "Solar",
  "Lunar",
  "Whisperwind",
  "Fading",
  "Titan",
  "Dawn",
  "Crystalline",
  "Jeweled",
  "Sylvan",
  "Twisted",
  "Ebon",
  "Thorn",
  "Cerulean",
  "Halcyon",
  "Infernal",
  "Storm",
  "Eldritch",
  "Sapphire",
  "Crimson",
  "Tranquil",
  "Paved"
];

const descriptors = [
  "Great",
  "Shrouded",
  "Sacred",
  "Fabled",
  "Frosty",
  "Winding",
  "Echoing",
  "Serpentine",
  "Breezy",
  "Misty",
  "Rustic",
  "Silent",
  "Cobbled",
  "Cracked",
  "Shaky",
  "Obscure"
];

const suffixes: Record<string, Record<string, number>> = {
  roads: { road: 7, route: 3, way: 2, highway: 1 },
  trails: { trail: 4, path: 1, track: 1, pass: 1 },
  searoutes: { "sea route": 5, lane: 2, passage: 1, seaway: 1 },
  airroutes: {
    "sky route": 3,
    "air lane": 2,
    skyway: 2,
    airway: 2,
    "aerial path": 1
  }
};

export interface Route {
  i: number;
  group: "roads" | "trails" | "searoutes" | "airroutes";
  type?: string;
  feature: number;
  points: number[][];
  cells?: number[];
  merged?: boolean;
}

type SeaTradeTier = "trunk" | "feeder" | "coastal";
interface SeaTradeEdge {
  from: number;
  to: number;
  tier: SeaTradeTier;
}

type RouteBurgIndex = {
  burgsByFeature: Record<number, Burg[]>;
  capitalsByFeature: Record<number, Burg[]>;
  portsByFeature: Record<number, Burg[]>;
  marketTownsByFeature: Record<number, Burg[]>;
  regionalCentersByFeature: Record<number, Burg[]>;
  villagesByFeature: Record<number, Burg[]>;
  hamletsByFeature: Record<number, Burg[]>;
  capitalPortsByFeature: Record<number, Burg[]>;
  skyPorts: Burg[];
};

class RoutesModule {
  buildLinks(routes: Route[]): Record<number, Record<number, number>> {
    const links: Record<number, Record<number, number>> = {};

    for (const { points, i: routeId } of routes) {
      const cells = points.map(p => p[2]);

      for (let i = 0; i < cells.length - 1; i++) {
        const cellId = cells[i];
        const nextCellId = cells[i + 1];

        if (cellId !== nextCellId) {
          if (!links[cellId]) links[cellId] = {};
          links[cellId][nextCellId] = routeId;

          if (!links[nextCellId]) links[nextCellId] = {};
          links[nextCellId][cellId] = routeId;
        }
      }
    }

    return links;
  }

  private sortBurgsByFeature(burgs: Burg[]) {
    const burgsByFeature: Record<number, Burg[]> = {};
    const capitalsByFeature: Record<number, Burg[]> = {};
    const portsByFeature: Record<number, Burg[]> = {};
    const marketTownsByFeature: Record<number, Burg[]> = {};
    const regionalCentersByFeature: Record<number, Burg[]> = {};
    const villagesByFeature: Record<number, Burg[]> = {};
    const hamletsByFeature: Record<number, Burg[]> = {};
    const capitalPortsByFeature: Record<number, Burg[]> = {};
    const skyPorts: Burg[] = [];

    const addBurg = (collection: Record<number, Burg[]>, feature: number, burg: Burg) => {
      if (!collection[feature]) collection[feature] = [];
      collection[feature].push(burg);
    };

    for (const burg of burgs) {
      if (burg.i && !burg.removed) {
        // Collect sky ports separately
        if (burg.skyPort) {
          skyPorts.push(burg);
        }

        // Flying burgs are excluded from land/sea routes (they're in the sky).
        // Sky-port burgs that aren't flying are normal ground settlements with
        // an aerial-hub designation — they keep their land/sea connectivity.
        if (burg.flying) continue;

        const { feature, capital, port } = burg;
        addBurg(burgsByFeature, feature as number, burg);
        if (capital) addBurg(capitalsByFeature, feature as number, burg);
        if (port) addBurg(portsByFeature, port as number, burg);
        if (burg.settlementType === "marketTown" || burg.plaza === 1)
          addBurg(marketTownsByFeature, feature as number, burg);
        if (burg.isRegionalCenter || burg.isLargePort) addBurg(regionalCentersByFeature, feature as number, burg);
        if (burg.settlementType === "largeVillage" || burg.settlementType === "smallVillage")
          addBurg(villagesByFeature, feature as number, burg);
        if (burg.settlementType === "hamlet") addBurg(hamletsByFeature, feature as number, burg);
        if (port && (capital || burg.isLargePort)) addBurg(capitalPortsByFeature, port as number, burg);
      }
    }

    return {
      burgsByFeature,
      capitalsByFeature,
      portsByFeature,
      marketTownsByFeature,
      regionalCentersByFeature,
      villagesByFeature,
      hamletsByFeature,
      capitalPortsByFeature,
      skyPorts
    };
  }

  // Urquhart graph is obtained by removing the longest edge from each triangle in the Delaunay triangulation
  // this gives us an aproximation of a desired road network, i.e. connections between burgs
  // code from https://observablehq.com/@mbostock/urquhart-graph
  private calculateUrquhartEdges(points: Point[], wrap = false, width = 0) {
    if (points.length < 2) return []; // No connection for less than 2 points
    if (points.length === 2) return [[0, 1]]; // Direct connection for exactly two points
    if (wrap && width > 0) return this.calculateWrapUrquhartEdges(points, width);

    const score = (p0: number, p1: number) => distanceSquared(points[p0], points[p1]);

    const { halfedges, triangles } = Delaunator.from(points);
    const n = triangles.length;

    const removed = new Uint8Array(n);
    const edges = [];

    for (let e = 0; e < n; e += 3) {
      const p0 = triangles[e],
        p1 = triangles[e + 1],
        p2 = triangles[e + 2];

      const p01 = score(p0, p1),
        p12 = score(p1, p2),
        p20 = score(p2, p0);

      removed[
        p20 > p01 && p20 > p12
          ? Math.max(e + 2, halfedges[e + 2])
          : p12 > p01 && p12 > p20
            ? Math.max(e + 1, halfedges[e + 1])
            : Math.max(e, halfedges[e])
      ] = 1;
    }

    for (let e = 0; e < n; ++e) {
      if (e > halfedges[e] && !removed[e]) {
        const t0 = triangles[e];
        const t1 = triangles[e % 3 === 2 ? e - 2 : e + 1];
        edges.push([t0, t1]);
      }
    }

    return edges;
  }

  // Toroidal (periodic-X) Urquhart graph. Duplicate every point shifted by
  // ±width, triangulate the augmented set, map each edge back to its real
  // index, drop self-loops, and dedupe. Edges from a real left point to a
  // ghost of a real right point become real cross-seam pairings.
  private calculateWrapUrquhartEdges(points: Point[], width: number) {
    const aug: Point[] = [];
    const realOf: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i];
      aug.push([x, y]);
      realOf.push(i);
      aug.push([x + width, y]);
      realOf.push(i);
      aug.push([x - width, y]);
      realOf.push(i);
    }

    const score = (p0: number, p1: number) => distanceSquared(aug[p0], aug[p1]);
    const { halfedges, triangles } = Delaunator.from(aug);
    const n = triangles.length;
    const removed = new Uint8Array(n);

    for (let e = 0; e < n; e += 3) {
      const p0 = triangles[e];
      const p1 = triangles[e + 1];
      const p2 = triangles[e + 2];
      const p01 = score(p0, p1);
      const p12 = score(p1, p2);
      const p20 = score(p2, p0);
      removed[
        p20 > p01 && p20 > p12
          ? Math.max(e + 2, halfedges[e + 2])
          : p12 > p01 && p12 > p20
            ? Math.max(e + 1, halfedges[e + 1])
            : Math.max(e, halfedges[e])
      ] = 1;
    }

    const seen = new Set<number>();
    const edges: number[][] = [];
    for (let e = 0; e < n; ++e) {
      if (e > halfedges[e] && !removed[e]) {
        const a = realOf[triangles[e]];
        const b = realOf[triangles[e % 3 === 2 ? e - 2 : e + 1]];
        if (a === b) continue;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const key = lo * points.length + hi;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([a, b]);
      }
    }

    return edges;
  }

  private getBorderPenalty(current: number, next: number, routeType?: string): number {
    if (!routeType || routeType === "royal" || routeType === "main") return 1;
    if (pack.cells.state[current] !== pack.cells.state[next]) return 1.5;
    return 1;
  }

  private createCostEvaluator({
    isWater,
    connections,
    routeType
  }: {
    isWater: boolean;
    connections: Set<number>;
    routeType?: string;
  }) {
    const tierModifier = ROUTE_TIER_MODIFIERS[routeType!]?.cost ?? 1;
    const getBorderPenalty = this.getBorderPenalty.bind(this);
    // Hoisted out of the per-edge cost functions: the wrap gate is constant for
    // the lifetime of an A* search, so evaluate it once rather than per edge.
    const wrap = isWrapEnabled();

    function getLandPathCost(current: number, next: number) {
      if (pack.cells.h[next] < 20) return Infinity;

      const habitability = biomesData.habitability[pack.cells.biome[next]];
      if (!habitability) return Infinity;

      const distanceCost = distanceSquared(pack.cells.p[current], pack.cells.p[next]);
      const habitabilityModifier = 1 + Math.max(100 - habitability, 0) / 1000;
      const heightModifier = 1 + Math.max(pack.cells.h[next] - 25, 25) / 25;
      const connectionModifier = connections.has(encodeConnection(current, next)) ? 0.5 : 1;
      const burgModifier = pack.cells.burg[next] ? 1 : 3;
      const borderPenalty = getBorderPenalty(current, next, routeType);

      return (
        distanceCost *
        habitabilityModifier *
        heightModifier *
        connectionModifier *
        burgModifier *
        tierModifier *
        borderPenalty
      );
    }

    // Only water routes wrap across the seam, so only the water cost uses
    // wrapDistanceSquared; getLandPathCost stays on plain distanceSquared.
    function getWaterPathCost(current: number, next: number) {
      if (pack.cells.h[next] >= 20) return Infinity;
      if (grid.cells.temp[pack.cells.g[next]] < MIN_PASSABLE_SEA_TEMP) return Infinity;

      const distanceCost = wrapDistanceSquared(pack.cells.p[current], pack.cells.p[next], wrap, graphWidth);
      const typeModifier = ROUTE_TYPE_MODIFIERS[pack.cells.t[next]] || ROUTE_TYPE_MODIFIERS.default;
      const connectionModifier = connections.has(encodeConnection(current, next)) ? 0.5 : 1;

      return distanceCost * typeModifier * connectionModifier;
    }
    return isWater ? getWaterPathCost : getLandPathCost;
  }

  private getRouteSegments(pathCells: number[], connections: Set<number>) {
    const segments: number[][] = [];
    let segment: number[] = [];

    for (let i = 0; i < pathCells.length; i++) {
      const cellId = pathCells[i];
      const nextCellId = pathCells[i + 1];
      const isConnected =
        nextCellId !== undefined &&
        (connections.has(encodeConnection(cellId, nextCellId)) ||
          connections.has(encodeConnection(nextCellId, cellId)));

      if (isConnected) {
        if (segment.length) {
          segment.push(pathCells[i]);
          segments.push(segment);
          segment = [];
        }
        continue;
      }

      segment.push(pathCells[i]);
    }

    if (segment.length > 1) segments.push(segment);
    return segments;
  }

  // Copy of pack.cells.c with seam links added between west-edge and east-edge
  // water cells, matched by latitude. pack.cells.c itself is never mutated.
  // Used only for sea-route pathfinding on full-globe maps.
  // West/east edge water-cell pairs matched by latitude. Shared by buildSeaAdjacency
  // (to add neighbour links) and buildNavigableComponents (to union features).
  private collectSeamLinks(): Array<[number, number]> {
    const { cells } = pack;
    const width = graphWidth;
    const margin = grid.spacing; // one-cell band at each edge
    const isWater = (c: number) => cells.h[c] < 20;

    const westEdge: number[] = [];
    const eastEdge: number[] = [];
    for (let i = 0; i < cells.i.length; i++) {
      if (!isWater(i)) continue;
      const x = cells.p[i][0];
      if (x <= margin) westEdge.push(i);
      else if (x >= width - margin) eastEdge.push(i);
    }

    if (!westEdge.length || !eastEdge.length) return [];

    // Sort east cells by latitude for nearest-y matching via binary search.
    eastEdge.sort((a, b) => cells.p[a][1] - cells.p[b][1]);
    const eastY = eastEdge.map(c => cells.p[c][1]);

    const links: Array<[number, number]> = [];
    for (const w of westEdge) {
      const y = cells.p[w][1];
      let lo = 0;
      let hi = eastY.length - 1;
      let best = 0;
      let bestD = Infinity;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const d = Math.abs(eastY[mid] - y);
        if (d < bestD) {
          bestD = d;
          best = mid;
        }
        if (eastY[mid] < y) lo = mid + 1;
        else hi = mid - 1;
      }
      links.push([w, eastEdge[best]]);
    }

    return links;
  }

  // Copy of pack.cells.c with seam links added between west-edge and east-edge
  // water cells. pack.cells.c itself is never mutated. Sea-route pathfinding only.
  private buildSeaAdjacency(): number[][] {
    const { cells } = pack;
    const links = this.collectSeamLinks();
    if (!links.length) return cells.c;

    // Shallow-copy the neighbour array; only edge cells get fresh inner arrays.
    const c = cells.c.slice();
    const link = (a: number, b: number) => {
      if (c[a] === cells.c[a]) c[a] = cells.c[a].slice();
      if (c[b] === cells.c[b]) c[b] = cells.c[b].slice();
      if (!c[a].includes(b)) c[a].push(b);
      if (!c[b].includes(a)) c[b].push(a);
    };

    for (const [w, e] of links) link(w, e);

    return c;
  }

  // Map each port-bearing water feature to a navigable-component id. Components are
  // feature ids unioned by seam links (360 maps only); on non-360 maps every
  // feature is its own component (identity), so behaviour is unchanged.
  private buildNavigableComponents(): Map<number, number> {
    const { cells, burgs } = pack;
    const parent = new Map<number, number>();

    const find = (x: number): number => {
      if (!parent.has(x)) parent.set(x, x);
      let root = x;
      while (parent.get(root)! !== root) root = parent.get(root)!;
      let cur = x;
      while (parent.get(cur)! !== root) {
        const next = parent.get(cur)!;
        parent.set(cur, root);
        cur = next;
      }
      return root;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    const isRoutablePort = (burg: Burg) => Boolean(burg.i) && !burg.removed && !burg.flying && Boolean(burg.port);

    // Seed union-find with every port-bearing feature.
    for (const burg of burgs) {
      if (isRoutablePort(burg)) find(burg.port as number);
    }

    // Union features joined across the seam (360 maps only).
    if (isWrapEnabled()) {
      for (const [w, e] of this.collectSeamLinks()) union(cells.f[w], cells.f[e]);
    }

    const components = new Map<number, number>();
    for (const burg of burgs) {
      if (isRoutablePort(burg)) {
        const feature = burg.port as number;
        components.set(feature, find(feature));
      }
    }
    return components;
  }

  private findPathSegments({
    isWater,
    connections,
    start,
    exit,
    routeType,
    seaAdjacency
  }: {
    isWater: boolean;
    connections: Set<number>;
    start: number;
    exit: number;
    routeType?: string;
    seaAdjacency?: number[][];
  }) {
    const getCost = this.createCostEvaluator({ isWater, connections, routeType });
    const wrap = isWater && isWrapEnabled() && !!seaAdjacency;
    const graph = wrap ? { ...pack, cells: { ...pack.cells, c: seaAdjacency } } : pack;
    const pathCells = findPath(start, current => current === exit, getCost, graph, exit, wrap ? graphWidth : undefined);
    if (!pathCells) return [];
    const segments = this.getRouteSegments(pathCells, connections);
    return segments;
  }

  private generateRoyalRoads(connections: Set<number>, burgIndex: RouteBurgIndex) {
    TIME && console.time("generateRoyalRoads");
    const { capitalsByFeature } = burgIndex;
    const royalRoads: Route[] = [];

    // Collect all capitals grouped by feature (landmass)
    for (const [key, featureCapitals] of Object.entries(capitalsByFeature)) {
      if (featureCapitals.length < 2) continue;

      // Build edges between every pair of capitals on this landmass, sorted by distance
      const edges: { from: number; to: number; dist: number }[] = [];
      for (let i = 0; i < featureCapitals.length; i++) {
        for (let j = i + 1; j < featureCapitals.length; j++) {
          const a = featureCapitals[i];
          const b = featureCapitals[j];
          edges.push({
            from: i,
            to: j,
            dist: distanceSquared([a.x, a.y], [b.x, b.y])
          });
        }
      }
      edges.sort((a, b) => a.dist - b.dist);

      // Union-find for Kruskal's MST
      const parent = new Map<number, number>();
      function find(x: number): number {
        if (!parent.has(x)) parent.set(x, x);
        if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
        return parent.get(x)!;
      }
      function union(a: number, b: number): boolean {
        const ra = find(a);
        const rb = find(b);
        if (ra === rb) return false;
        parent.set(ra, rb);
        return true;
      }

      // Build MST
      for (const edge of edges) {
        if (!union(edge.from, edge.to)) continue;

        const start = featureCapitals[edge.from].cell;
        const exit = featureCapitals[edge.to].cell;

        const segments = this.findPathSegments({
          isWater: false,
          connections,
          start,
          exit,
          routeType: "royal"
        });
        for (const segment of segments) {
          this.addConnections(segment, connections);
          royalRoads.push({
            feature: Number(key),
            cells: segment,
            type: "royal"
          } as Route);
        }
      }
    }

    TIME && console.timeEnd("generateRoyalRoads");
    return royalRoads;
  }

  private generateMarketRoads(connections: Set<number>, burgIndex: RouteBurgIndex) {
    TIME && console.time("generateMarketRoads");
    const { marketTownsByFeature } = burgIndex;
    const marketRoads: Route[] = [];
    const mapScale = Math.sqrt((graphWidth * graphHeight) / 1_000_000);

    for (const [key, featureMarketTowns] of Object.entries(marketTownsByFeature)) {
      if (featureMarketTowns.length < 2) continue;

      const points = featureMarketTowns.map(burg => [burg.x, burg.y] as Point);
      const urquhartEdges = this.calculateUrquhartEdges(points);

      for (const [fromId, toId] of urquhartEdges) {
        const a = featureMarketTowns[fromId];
        const b = featureMarketTowns[toId];

        // Skip edges exceeding ~35 map-km
        const kmDistance = Math.sqrt(distanceSquared([a.x, a.y], [b.x, b.y])) / mapScale;
        if (kmDistance > 35) continue;

        const segments = this.findPathSegments({
          isWater: false,
          connections,
          start: a.cell,
          exit: b.cell,
          routeType: "market"
        });
        for (const segment of segments) {
          this.addConnections(segment, connections);
          marketRoads.push({
            feature: Number(key),
            cells: segment,
            type: "market"
          } as Route);
        }
      }
    }

    TIME && console.timeEnd("generateMarketRoads");
    return marketRoads;
  }

  private generateMainRoads(connections: Set<number>, burgIndex: RouteBurgIndex) {
    TIME && console.time("generateMainRoads");
    const { capitalsByFeature } = burgIndex;
    const mainRoads: Route[] = [];

    for (const [key, featureCapitals] of Object.entries(capitalsByFeature)) {
      const points = featureCapitals.map(burg => [burg.x, burg.y] as Point);
      const urquhartEdges = this.calculateUrquhartEdges(points);
      urquhartEdges.forEach(([fromId, toId]) => {
        const start = featureCapitals[fromId].cell;
        const exit = featureCapitals[toId].cell;

        const segments = this.findPathSegments({
          isWater: false,
          connections,
          start,
          exit,
          routeType: "main"
        });
        for (const segment of segments) {
          this.addConnections(segment, connections);
          mainRoads.push({
            feature: Number(key),
            cells: segment,
            type: "main"
          } as Route);
        }
      });
    }

    TIME && console.timeEnd("generateMainRoads");
    return mainRoads;
  }

  private addConnections(segment: number[], connections: Set<number>) {
    for (let i = 0; i < segment.length - 1; i++) {
      const cellId = segment[i];
      const nextCellId = segment[i + 1];
      connections.add(encodeConnection(cellId, nextCellId));
      connections.add(encodeConnection(nextCellId, cellId));
    }
  }

  private generateTrails(connections: Set<number>, burgIndex: RouteBurgIndex) {
    TIME && console.time("generateTrails");
    const { villagesByFeature } = burgIndex;
    const trails: Route[] = [];
    const mapScale = Math.sqrt((graphWidth * graphHeight) / 1_000_000);

    for (const [key, featureVillages] of Object.entries(villagesByFeature)) {
      if (featureVillages.length < 2) continue;

      const points = featureVillages.map(burg => [burg.x, burg.y] as Point);
      const urquhartEdges = this.calculateUrquhartEdges(points);

      for (const [fromId, toId] of urquhartEdges) {
        const a = featureVillages[fromId];
        const b = featureVillages[toId];

        const kmDistance = Math.sqrt(distanceSquared([a.x, a.y], [b.x, b.y])) / mapScale;
        if (kmDistance > 25) continue;

        const segments = this.findPathSegments({
          isWater: false,
          connections,
          start: a.cell,
          exit: b.cell,
          routeType: "trail"
        });
        for (const segment of segments) {
          this.addConnections(segment, connections);
          trails.push({
            feature: Number(key),
            cells: segment,
            type: "trail"
          } as Route);
        }
      }
    }

    TIME && console.timeEnd("generateTrails");
    return trails;
  }

  private generateTownRoads(connections: Set<number>, burgIndex: RouteBurgIndex) {
    TIME && console.time("generateTownRoads");
    const { regionalCentersByFeature } = burgIndex;
    const townRoads: Route[] = [];
    const mapScale = Math.sqrt((graphWidth * graphHeight) / 1_000_000);

    for (const [key, featureCenters] of Object.entries(regionalCentersByFeature)) {
      if (featureCenters.length < 2) continue;

      const points = featureCenters.map(burg => [burg.x, burg.y] as Point);
      const urquhartEdges = this.calculateUrquhartEdges(points);

      for (const [fromId, toId] of urquhartEdges) {
        const a = featureCenters[fromId];
        const b = featureCenters[toId];

        const kmDistance = Math.sqrt(distanceSquared([a.x, a.y], [b.x, b.y])) / mapScale;
        if (kmDistance > 40) continue;

        const segments = this.findPathSegments({
          isWater: false,
          connections,
          start: a.cell,
          exit: b.cell,
          routeType: "town"
        });
        for (const segment of segments) {
          this.addConnections(segment, connections);
          townRoads.push({
            feature: Number(key),
            cells: segment,
            type: "town"
          } as Route);
        }
      }
    }

    TIME && console.timeEnd("generateTownRoads");
    return townRoads;
  }

  private generateFootpaths(connections: Set<number>, burgIndex: RouteBurgIndex) {
    TIME && console.time("generateFootpaths");
    const { hamletsByFeature } = burgIndex;
    const footpaths: Route[] = [];
    const mapScale = Math.sqrt((graphWidth * graphHeight) / 1_000_000);

    for (const [key, featureHamlets] of Object.entries(hamletsByFeature)) {
      if (featureHamlets.length < 2) continue;

      const points = featureHamlets.map(burg => [burg.x, burg.y] as Point);
      const urquhartEdges = this.calculateUrquhartEdges(points);

      for (const [fromId, toId] of urquhartEdges) {
        const a = featureHamlets[fromId];
        const b = featureHamlets[toId];

        const kmDistance = Math.sqrt(distanceSquared([a.x, a.y], [b.x, b.y])) / mapScale;
        if (kmDistance > 15) continue;

        const segments = this.findPathSegments({
          isWater: false,
          connections,
          start: a.cell,
          exit: b.cell,
          routeType: "footpath"
        });
        for (const segment of segments) {
          this.addConnections(segment, connections);
          footpaths.push({
            feature: Number(key),
            cells: segment,
            type: "footpath"
          } as Route);
        }
      }
    }

    TIME && console.timeEnd("generateFootpaths");
    return footpaths;
  }

  // Gravity-based edge selection for one navigable component's ports.
  // Produces deduped trunk/feeder/coastal edges (highest tier wins on collision).
  private selectSeaTradeEdges(ports: Burg[]): SeaTradeEdge[] {
    const n = ports.length;
    const wrap = isWrapEnabled();
    const mapScale = Math.sqrt((graphWidth * graphHeight) / 1_000_000);

    const imp = ports.map(portImportance);
    const d2 = (i: number, j: number) =>
      wrapDistanceSquared([ports[i].x, ports[i].y], [ports[j].x, ports[j].y], wrap, graphWidth);
    const gravity = (i: number, j: number) => (imp[i] * imp[j]) / Math.max(d2(i, j), 1e-9);
    const km = (i: number, j: number) => Math.sqrt(d2(i, j)) / mapScale;

    const tierRank: Record<SeaTradeTier, number> = { coastal: 0, feeder: 1, trunk: 2 };
    const edges = new Map<number, SeaTradeTier>();
    const addEdge = (a: number, b: number, tier: SeaTradeTier) => {
      if (a === b) return;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = lo * n + hi;
      const current = edges.get(key);
      if (current === undefined || tierRank[tier] > tierRank[current]) edges.set(key, tier);
    };

    const allIndices = Array.from({ length: n }, (_, i) => i);

    // Long-haul trade runs only over the most important ports. Tens of thousands of
    // ports can share one ocean, so the gravity tiers (O(major^2) selection + a
    // long-haul A* per edge) must be bounded; coastal below still covers every port.
    const major =
      n <= SEA_TRADE_MAX_PORTS
        ? allIndices
        : [...allIndices].sort((a, b) => imp[b] - imp[a]).slice(0, SEA_TRADE_MAX_PORTS);

    // feeder: each major port -> its top SEA_FEEDER_LINKS gravity partners within regional
    // reach. Capping distance keeps feeder A* paths short and leaves long hauls to trunk.
    for (const i of major) {
      const partners = major
        .filter(j => j !== i && km(i, j) <= SEA_FEEDER_CAP_KM)
        .sort((a, b) => gravity(i, b) - gravity(i, a));
      for (let k = 0; k < Math.min(SEA_FEEDER_LINKS, partners.length); k++) addEdge(i, partners[k], "feeder");
    }

    // trunk: top hubs by importance, each linked to its top SEA_TRUNK_LINKS hub partners
    const hubCount = Math.min(major.length, Math.max(2, Math.ceil(SEA_TRUNK_HUB_FRACTION * major.length)));
    const hubs = [...major].sort((a, b) => imp[b] - imp[a]).slice(0, hubCount);
    for (const h of hubs) {
      const partners = hubs.filter(j => j !== h).sort((a, b) => gravity(h, b) - gravity(h, a));
      let added = 0;
      for (const j of partners) {
        if (added >= SEA_TRUNK_LINKS) break;
        if (km(h, j) > SEA_TRUNK_SAFETY_CAP_KM) continue;
        addEdge(h, j, "trunk");
        added++;
      }
    }

    // coastal: existing Urquhart short pairs, capped at SEA_COASTAL_CAP_KM
    const points = ports.map(p => [p.x, p.y] as Point);
    const urquhartEdges = this.calculateUrquhartEdges(points, wrap, graphWidth);
    for (const [a, b] of urquhartEdges) {
      if (km(a, b) <= SEA_COASTAL_CAP_KM) addEdge(a, b, "coastal");
    }

    const result: SeaTradeEdge[] = [];
    for (const [key, tier] of edges) {
      result.push({ from: Math.floor(key / n), to: key % n, tier });
    }
    return result;
  }

  // Build the full sea-trade network for all navigable components.
  // Returns trunk routes (rendered as "major") and feeder+coastal routes ("local").
  private generateSeaTradeNetwork(
    connections: Set<number>,
    burgIndex: RouteBurgIndex,
    components: Map<number, number>,
    seaAdjacency?: number[][]
  ) {
    TIME && console.time("generateSeaTradeNetwork");
    const { portsByFeature } = burgIndex;

    // Re-pool ports by navigable component (seam-joined features share a pool on 360).
    const portsByComponent: Record<number, Burg[]> = {};
    for (const [featureId, ports] of Object.entries(portsByFeature)) {
      const component = components.get(Number(featureId)) ?? Number(featureId);
      if (!portsByComponent[component]) portsByComponent[component] = [];
      portsByComponent[component].push(...ports);
    }

    const trunkRoutes: Route[] = [];
    const localRoutes: Route[] = [];

    // Diagnostics: confirm the dominant cost on real maps (ports vs edges vs A*).
    let diagPorts = 0;
    let diagMaxComp = 0;
    const diagTiers: Record<string, number> = { trunk: 0, feeder: 0, coastal: 0 };

    for (const ports of Object.values(portsByComponent)) {
      if (ports.length < 2) continue;
      diagPorts += ports.length;
      if (ports.length > diagMaxComp) diagMaxComp = ports.length;

      const edges = this.selectSeaTradeEdges(ports);
      for (const { from, to, tier } of edges) {
        diagTiers[tier]++;
        const a = ports[from];
        const b = ports[to];

        const segments = this.findPathSegments({
          isWater: true,
          connections,
          start: a.cell,
          exit: b.cell,
          seaAdjacency
        });
        for (const segment of segments) {
          this.addConnections(segment, connections);
          const route = {
            feature: a.port as number, // originating port's real feature id
            cells: segment,
            type: tier === "trunk" ? "major" : "local"
          } as Route;
          (tier === "trunk" ? trunkRoutes : localRoutes).push(route);
        }
      }
    }

    TIME &&
      console.log(
        `  sea-trade: ${diagPorts} ports, largest ocean ${diagMaxComp} ports, edges`,
        diagTiers
      );
    TIME && console.timeEnd("generateSeaTradeNetwork");
    return { trunkRoutes, localRoutes };
  }

  private preparePointsArray(): Point[] {
    const { cells, burgs } = pack;
    return cells.p.map(([x, y], cellId) => {
      const burgId = cells.burg[cellId];
      if (burgId) return [burgs[burgId].x, burgs[burgId].y];
      return [x, y];
    });
  }

  private getPoints(group: string, cells: number[], points: Point[]) {
    const data = cells.map(cellId => [...points[cellId], cellId]);

    // resolve sharp angles
    if (group !== "searoutes") {
      for (let i = 1; i < cells.length - 1; i++) {
        const cellId = cells[i];
        if (pack.cells.burg[cellId]) continue;

        const [prevX, prevY] = data[i - 1];
        const [currX, currY] = data[i];
        const [nextX, nextY] = data[i + 1];

        const dAx = prevX - currX;
        const dAy = prevY - currY;
        const dBx = nextX - currX;
        const dBy = nextY - currY;
        const angle = Math.abs((Math.atan2(dAx * dBy - dAy * dBx, dAx * dBx + dAy * dBy) * 180) / Math.PI);

        if (angle < ROUTES_SHARP_ANGLE) {
          const middleX = (prevX + nextX) / 2;
          const middleY = (prevY + nextY) / 2;
          let newX: number, newY: number;

          if (angle < ROUTES_VERY_SHARP_ANGLE) {
            newX = rn((currX + middleX * 2) / 3, 2);
            newY = rn((currY + middleY * 2) / 3, 2);
          } else {
            newX = rn((currX + middleX) / 2, 2);
            newY = rn((currY + middleY) / 2, 2);
          }

          if (findClosestCell(newX, newY, undefined, pack) === cellId) {
            data[i] = [newX, newY, cellId];
            points[cellId] = [data[i][0], data[i][1]]; // change cell coordinate for all routes
          }
        }
      }
    }

    return data; // [[x, y, cell], [x, y, cell]];
  }

  // Merge routes whose endpoints chain (last cell of A == first cell of B).
  // Linear-time stitch via an index keyed by the first cell of each route.
  private mergeRoutes(routes: Route[]): Route[] {
    const startIndex = new Map<number, number>();
    for (let i = 0; i < routes.length; i++) {
      const cells = routes[i].cells;
      if (!cells || cells.length === 0) continue;
      const start = cells[0];
      // First route to claim a start cell wins; later duplicates stay unmerged.
      if (!startIndex.has(start)) startIndex.set(start, i);
    }

    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      if (route.merged) continue;
      if (!route.cells || route.cells.length === 0) continue;

      let tail = route.cells[route.cells.length - 1];
      // Walk the chain: keep stitching while the tail matches some
      // unconsumed route's head.
      while (true) {
        const nextIdx = startIndex.get(tail);
        if (nextIdx === undefined || nextIdx === i) break;
        const nextRoute = routes[nextIdx];
        if (nextRoute.merged) {
          startIndex.delete(tail);
          break;
        }
        const nextCells = nextRoute.cells!;
        for (let k = 1; k < nextCells.length; k++) route.cells.push(nextCells[k]);
        nextRoute.merged = true;
        startIndex.delete(tail);
        tail = route.cells[route.cells.length - 1];
      }
    }

    return routes;
  }
  private generateAirRoutes(burgIndex: RouteBurgIndex) {
    TIME && console.time("generateAirRoutes");
    const { skyPorts } = burgIndex;
    const airRoutes: Route[] = [];

    if (skyPorts.length < 2) {
      TIME && console.timeEnd("generateAirRoutes");
      return airRoutes;
    }

    // Air routes use direct connections via Urquhart graph on sky port positions
    const points = skyPorts.map(burg => [burg.x, burg.y] as Point);
    const urquhartEdges = this.calculateUrquhartEdges(points, isWrapEnabled(), graphWidth);

    urquhartEdges.forEach(([fromId, toId]) => {
      const from = skyPorts[fromId];
      const to = skyPorts[toId];

      // Direct line between sky ports (no terrain cost - flying above obstacles)
      const airRoutePoints: number[][] = [
        [from.x, from.y, from.cell],
        [to.x, to.y, to.cell]
      ];

      airRoutes.push({
        i: 0, // will be assigned in createRoutesData
        group: "airroutes",
        feature: 0,
        points: airRoutePoints
      });
    });

    TIME && console.timeEnd("generateAirRoutes");
    return airRoutes;
  }

  private createRoutesData(routes: Route[], connections: Set<number>) {
    const burgIndex = this.sortBurgsByFeature(pack.burgs);
    const seaAdjacency = isWrapEnabled() ? this.buildSeaAdjacency() : undefined;
    const royalRoads = this.generateRoyalRoads(connections, burgIndex);
    const mainRoads = this.generateMainRoads(connections, burgIndex);
    const marketRoads = this.generateMarketRoads(connections, burgIndex);
    const townRoads = this.generateTownRoads(connections, burgIndex);
    const trails = this.generateTrails(connections, burgIndex);
    const footpaths = this.generateFootpaths(connections, burgIndex);
    const components = this.buildNavigableComponents();
    const { trunkRoutes: majorSeaRoutes, localRoutes: seaRoutes } = this.generateSeaTradeNetwork(
      connections,
      burgIndex,
      components,
      seaAdjacency
    );
    const airRoutes = this.generateAirRoutes(burgIndex);
    const pointsArray = this.preparePointsArray();

    for (const { feature, cells, merged, type } of this.mergeRoutes(royalRoads)) {
      if (merged) continue;
      const points = this.getPoints("roads", cells!, pointsArray);
      routes.push({ i: routes.length, group: "roads", type, feature, points });
    }

    for (const { feature, cells, merged, type } of this.mergeRoutes(mainRoads)) {
      if (merged) continue;
      const points = this.getPoints("roads", cells!, pointsArray);
      routes.push({ i: routes.length, group: "roads", type, feature, points });
    }

    for (const { feature, cells, merged, type } of this.mergeRoutes(marketRoads)) {
      if (merged) continue;
      const points = this.getPoints("roads", cells!, pointsArray);
      routes.push({ i: routes.length, group: "roads", type, feature, points });
    }

    for (const { feature, cells, merged, type } of this.mergeRoutes(townRoads)) {
      if (merged) continue;
      const points = this.getPoints("roads", cells!, pointsArray);
      routes.push({ i: routes.length, group: "roads", type, feature, points });
    }

    for (const { feature, cells, merged, type } of this.mergeRoutes(trails)) {
      if (merged) continue;
      const points = this.getPoints("trails", cells!, pointsArray);
      routes.push({
        i: routes.length,
        group: "trails",
        type,
        feature,
        points
      });
    }

    for (const { feature, cells, merged, type } of this.mergeRoutes(footpaths)) {
      if (merged) continue;
      const points = this.getPoints("trails", cells!, pointsArray);
      routes.push({
        i: routes.length,
        group: "trails",
        type,
        feature,
        points
      });
    }

    for (const { feature, cells, merged, type } of this.mergeRoutes(majorSeaRoutes)) {
      if (merged) continue;
      const points = this.getPoints("searoutes", cells!, pointsArray);
      routes.push({
        i: routes.length,
        group: "searoutes",
        type,
        feature,
        points
      });
    }

    for (const { feature, cells, merged, type } of this.mergeRoutes(seaRoutes)) {
      if (merged) continue;
      const points = this.getPoints("searoutes", cells!, pointsArray);
      routes.push({
        i: routes.length,
        group: "searoutes",
        type,
        feature,
        points
      });
    }

    // Air routes are already point-based (direct lines), no cell merging needed
    for (const airRoute of airRoutes) {
      airRoute.i = routes.length;
      routes.push(airRoute);
    }

    return routes;
  }

  generate(lockedRoutes: Route[] = []) {
    const connections = new Set<number>();
    lockedRoutes.forEach((route: Route) => {
      this.addConnections(
        route.points.map(p => p[2]),
        connections
      );
    });

    pack.routes = this.createRoutesData(lockedRoutes, connections);
    pack.cells.routes = this.buildLinks(pack.routes);
  }

  // utility functions
  isConnected(cellId: number): boolean {
    const routes = pack.cells.routes;
    return routes[cellId] && Object.keys(routes[cellId]).length > 0;
  }

  getNextId() {
    return pack.routes.length ? Math.max(...pack.routes.map(r => r.i)) + 1 : 0;
  }

  // Rebuild airroutes (Urquhart graph over all current skyPort burgs).
  // Called when sky ports are added, removed, or toggled.
  rebuildAirroutes(): void {
    TIME && console.time("rebuildAirroutes");

    for (const route of pack.routes.filter(r => r.group === "airroutes")) {
      this.remove(route);
    }

    const skyPorts = pack.burgs.filter(b => b.i && !b.removed && b.skyPort);
    if (skyPorts.length < 2) {
      TIME && console.timeEnd("rebuildAirroutes");
      return;
    }

    const points = skyPorts.map(b => [b.x, b.y] as Point);
    const urquhartEdges = this.calculateUrquhartEdges(points, isWrapEnabled(), graphWidth);

    let nextId = this.getNextId();
    for (const [fromIdx, toIdx] of urquhartEdges) {
      const from = skyPorts[fromIdx];
      const to = skyPorts[toIdx];
      const route: Route = {
        i: nextId++,
        group: "airroutes",
        feature: 0,
        points: [
          [from.x, from.y, from.cell],
          [to.x, to.y, to.cell]
        ]
      };
      pack.routes.push(route);

      const cellRoutes = pack.cells.routes;
      if (!cellRoutes[from.cell]) cellRoutes[from.cell] = {};
      cellRoutes[from.cell][to.cell] = route.i;
      if (!cellRoutes[to.cell]) cellRoutes[to.cell] = {};
      cellRoutes[to.cell][from.cell] = route.i;
    }

    if (layerIsOn("toggleRoutes")) drawRoutes();

    TIME && console.timeEnd("rebuildAirroutes");
  }

  // connect cell with routes system by land
  connect(cellId: number): Route | undefined {
    const getCost = this.createCostEvaluator({
      isWater: false,
      connections: new Set<number>()
    });
    const isExit = (c: number) => isLand(c, pack) && this.isConnected(c);
    const pathCells = findPath(cellId, isExit, getCost, pack);
    if (!pathCells) return;

    const pointsArray = this.preparePointsArray();
    const points = this.getPoints("trails", pathCells, pointsArray);
    const feature = pack.cells.f[cellId];
    const routeId = this.getNextId();
    const newRoute = { i: routeId, group: "trails", feature, points };
    pack.routes.push(newRoute as Route);

    const addConnection = (from: number, to: number, routeId: number) => {
      const routes = pack.cells.routes;

      if (!routes[from]) routes[from] = {};
      routes[from][to] = routeId;

      if (!routes[to]) routes[to] = {};
      routes[to][from] = routeId;
    };

    for (let i = 0; i < pathCells.length; i++) {
      const currentCell = pathCells[i];
      const nextCellId = pathCells[i + 1];
      if (nextCellId) addConnection(currentCell, nextCellId, routeId);
    }

    return newRoute as Route;
  }

  areConnected(from: number, to: number): boolean {
    const routeId = pack.cells.routes[from]?.[to];
    return routeId !== undefined;
  }

  private indexCache: { ref: Route[]; len: number; map: Map<number, Route> } | null = null;

  private getRoutesIndex(): Map<number, Route> {
    const routes = pack.routes as Route[];
    if (this.indexCache && this.indexCache.ref === routes && this.indexCache.len === routes.length) {
      return this.indexCache.map;
    }
    const map = new Map<number, Route>();
    for (const route of routes) {
      if (route && route.i !== undefined) map.set(route.i, route);
    }
    this.indexCache = { ref: routes, len: routes.length, map };
    return map;
  }

  getRoute(from: number, to: number) {
    const routeId = pack.cells.routes[from]?.[to];
    if (routeId === undefined) return null;
    return this.getRoutesIndex().get(routeId) ?? null;
  }

  hasRoad(cellId: number): boolean {
    const connections = pack.cells.routes[cellId];
    if (!connections) return false;
    const index = this.getRoutesIndex();
    return Object.values(connections).some(routeId => {
      const route = index.get(routeId);
      if (!route) return false;
      return route.group === "roads";
    });
  }

  isCrossroad(cellId: number): boolean {
    const connections = pack.cells.routes[cellId];
    if (!connections) return false;
    if (Object.keys(connections).length > 3) return true;
    const index = this.getRoutesIndex();
    const roadConnections = Object.values(connections).filter(routeId => {
      const route = index.get(routeId);
      return route?.group === "roads";
    });
    return roadConnections.length > 2;
  }

  remove(route: Route) {
    const routes = pack.cells.routes;

    for (const point of route.points) {
      const from = point[2];
      if (!routes[from]) continue;

      for (const [to, routeId] of Object.entries(routes[from])) {
        if (routeId === route.i) {
          delete routes[from][parseInt(to, 10)];
          delete routes[parseInt(to, 10)][from];
        }
      }
    }

    pack.routes = pack.routes.filter(r => r.i !== route.i);
    viewbox.select(`#route${route.i}`).remove();
  }

  getConnectivityRate(cellId: number): number {
    const connections = pack.cells.routes[cellId];
    if (!connections) return 0;

    const connectivityRateMap: Record<string, number> = {
      roads: 0.2,
      trails: 0.1,
      searoutes: 0.2,
      airroutes: 0.15,
      default: 0.1
    };

    const connectivity = Object.values(connections).reduce((acc, routeId) => {
      const route = pack.routes.find(route => route.i === routeId);
      if (!route) return acc;
      const rate = connectivityRateMap[route.group] || connectivityRateMap.default;
      return acc + rate;
    }, 0.8);

    return connectivity;
  }

  generateName({ group, points }: { group: string; points: number[][] }): string {
    if (points.length < 4) return "Unnamed route segment";

    function getBurgName() {
      const priority = [points.at(-1), points.at(0), points.slice(1, -1).reverse()];
      for (const [_x, _y, cellId] of priority as [number, number, number][]) {
        const burgId = pack.cells.burg[cellId as number];
        if (burgId) return getAdjective(pack.burgs[burgId].name!);
      }
      return null;
    }

    const model = rw(models[group]);
    const suffix = rw(suffixes[group]);

    const burgName = getBurgName();
    if (model === "burg_suffix" && burgName) return `${burgName} ${suffix}`;
    if (model === "prefix_suffix") return `${ra(prefixes)} ${suffix}`;
    if (model === "the_descriptor_prefix_suffix") return `The ${ra(descriptors)} ${ra(prefixes)} ${suffix}`;
    if (model === "the_descriptor_burg_suffix" && burgName) return `The ${ra(descriptors)} ${burgName} ${suffix}`;
    return "Unnamed route";
  }

  private hasSeamCrossing(points: number[][]): boolean {
    if (!isWrapEnabled()) return false;
    const half = graphWidth / 2;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i][0] - points[i - 1][0]) > half) return true;
    }
    return false;
  }

  // Split a point list at each seam crossing (|dx| > width/2). At a crossing
  // between prev and curr, append the frame-edge intersection (at the
  // interpolated crossing latitude) to the current run and start the next run
  // at the opposite frame edge. Returns one or more [x, y] runs.
  private splitAtSeam(points: number[][]): number[][][] {
    const width = graphWidth;
    const half = width / 2;
    const runs: number[][][] = [];
    let run: number[][] = [[points[0][0], points[0][1]]];

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const dx = curr[0] - prev[0];
      if (Math.abs(dx) > half) {
        // A crossing means the polyline takes the short way around the seam.
        // dx < 0: route wraps globe-eastward — prev exits the east frame (x=width), curr enters from the west frame (x=0).
        // dx > 0: route wraps globe-westward — prev exits the west frame (x=0),     curr enters from the east frame (x=width).
        const prevExitX = dx < 0 ? width : 0;
        const currEnterX = dx < 0 ? 0 : width;
        const gap = width - Math.abs(dx); // wrapped horizontal traversal
        const prevToEdge = dx < 0 ? width - prev[0] : prev[0];
        const frac = gap === 0 ? 0 : prevToEdge / gap;
        const yAtSeam = prev[1] + (curr[1] - prev[1]) * frac;
        run.push([prevExitX, yAtSeam]);
        runs.push(run);
        run = [
          [currEnterX, yAtSeam],
          [curr[0], curr[1]]
        ];
      } else {
        run.push([curr[0], curr[1]]);
      }
    }
    runs.push(run);
    return runs;
  }

  getPath({ group, points }: { group: string; points: number[][] }): string {
    const lineGen = line();
    const ROUTE_CURVES: Record<string, any> = {
      roads: curveCatmullRom.alpha(0.1),
      trails: curveCatmullRom.alpha(0.1),
      searoutes: curveCatmullRom.alpha(0.5),
      airroutes: curveCatmullRom.alpha(0.3),
      default: curveCatmullRom.alpha(0.1)
    };
    lineGen.curve(ROUTE_CURVES[group] || ROUTE_CURVES.default);

    if (this.hasSeamCrossing(points)) {
      return this.splitAtSeam(points)
        .map(run => round(lineGen(run as [number, number][]) as string, 1))
        .join(" ");
    }

    const path = round(lineGen(points.map(p => [p[0], p[1]])) as string, 1);
    return path;
  }

  private getWrappedLength(points: number[][]): number {
    let len = 0;
    for (let i = 1; i < points.length; i++) {
      len += Math.sqrt(
        wrapDistanceSquared([points[i - 1][0], points[i - 1][1]], [points[i][0], points[i][1]], true, graphWidth)
      );
    }
    return len;
  }

  getLength(routeId: number): number {
    const route = this.getRoutesIndex().get(routeId);
    if (route && this.hasSeamCrossing(route.points)) {
      return this.getWrappedLength(route.points);
    }
    const path = routes.select(`#route${routeId}`).node() as SVGPathElement;
    return path.getTotalLength();
  }
}

window.Routes = new RoutesModule();
