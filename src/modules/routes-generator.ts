import { curveCatmullRom, line } from "d3";
import Delaunator from "delaunator";
import { distanceSquared, findClosestCell, findPath, getAdjective, isLand, ra, rn, round, rw } from "../utils";
import type { Burg } from "./burgs-generator";
import type { Point } from "./voronoi";

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

        // Exclude flying/skyPort burgs from land/sea routes
        if (burg.flying || burg.skyPort) continue;

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
  private calculateUrquhartEdges(points: Point[]) {
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

    function getWaterPathCost(current: number, next: number) {
      if (pack.cells.h[next] >= 20) return Infinity;
      if (grid.cells.temp[pack.cells.g[next]] < MIN_PASSABLE_SEA_TEMP) return Infinity;

      const distanceCost = distanceSquared(pack.cells.p[current], pack.cells.p[next]);
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

  private findPathSegments({
    isWater,
    connections,
    start,
    exit,
    routeType
  }: {
    isWater: boolean;
    connections: Set<number>;
    start: number;
    exit: number;
    routeType?: string;
  }) {
    const getCost = this.createCostEvaluator({ isWater, connections, routeType });
    const pathCells = findPath(start, current => current === exit, getCost, pack, exit);
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

  private generateSeaRoutes(connections: Set<number>, burgIndex: RouteBurgIndex) {
    TIME && console.time("generateSeaRoutes");
    const { portsByFeature } = burgIndex;
    const seaRoutes: Route[] = [];
    const mapScale = Math.sqrt((graphWidth * graphHeight) / 1_000_000);

    for (const [featureId, featurePorts] of Object.entries(portsByFeature)) {
      if (featurePorts.length < 2) continue;

      const points = featurePorts.map(burg => [burg.x, burg.y] as Point);
      const urquhartEdges = this.calculateUrquhartEdges(points);

      for (const [fromId, toId] of urquhartEdges) {
        const a = featurePorts[fromId];
        const b = featurePorts[toId];

        const kmDistance = Math.sqrt(distanceSquared([a.x, a.y], [b.x, b.y])) / mapScale;
        if (kmDistance > 50) continue;

        const segments = this.findPathSegments({
          isWater: true,
          connections,
          start: a.cell,
          exit: b.cell
        });
        for (const segment of segments) {
          this.addConnections(segment, connections);
          seaRoutes.push({
            feature: Number(featureId),
            cells: segment,
            type: "local"
          } as Route);
        }
      }
    }

    TIME && console.timeEnd("generateSeaRoutes");
    return seaRoutes;
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

  private generateMajorSeaRoutes(connections: Set<number>, burgIndex: RouteBurgIndex) {
    TIME && console.time("generateMajorSeaRoutes");
    const { capitalPortsByFeature } = burgIndex;
    const majorSeaRoutes: Route[] = [];

    for (const [key, featurePorts] of Object.entries(capitalPortsByFeature)) {
      if (featurePorts.length < 2) continue;

      const edges: { from: number; to: number; dist: number }[] = [];
      for (let i = 0; i < featurePorts.length; i++) {
        for (let j = i + 1; j < featurePorts.length; j++) {
          const a = featurePorts[i];
          const b = featurePorts[j];
          edges.push({
            from: i,
            to: j,
            dist: distanceSquared([a.x, a.y], [b.x, b.y])
          });
        }
      }
      edges.sort((a, b) => a.dist - b.dist);

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

      for (const edge of edges) {
        if (!union(edge.from, edge.to)) continue;

        const start = featurePorts[edge.from].cell;
        const exit = featurePorts[edge.to].cell;

        const segments = this.findPathSegments({
          isWater: true,
          connections,
          start,
          exit
        });
        for (const segment of segments) {
          this.addConnections(segment, connections);
          majorSeaRoutes.push({
            feature: Number(key),
            cells: segment,
            type: "major"
          } as Route);
        }
      }
    }

    TIME && console.timeEnd("generateMajorSeaRoutes");
    return majorSeaRoutes;
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

  // merge routes so that the last cell of one route is the first cell of the next route
  private mergeRoutes(routes: Route[]): Route[] {
    let routesMerged = 0;

    for (let i = 0; i < routes.length; i++) {
      const thisRoute = routes[i];
      if (thisRoute.merged) continue;

      for (let j = i + 1; j < routes.length; j++) {
        const nextRoute = routes[j];
        if (nextRoute.merged) continue;

        if (nextRoute.cells!.at(0) === thisRoute.cells!.at(-1)) {
          routesMerged++;
          thisRoute.cells = thisRoute.cells!.concat(nextRoute.cells!.slice(1));
          nextRoute.merged = true;
        }
      }
    }

    return routesMerged > 1 ? this.mergeRoutes(routes) : routes;
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
    const urquhartEdges = this.calculateUrquhartEdges(points);

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
    const royalRoads = this.generateRoyalRoads(connections, burgIndex);
    const mainRoads = this.generateMainRoads(connections, burgIndex);
    const marketRoads = this.generateMarketRoads(connections, burgIndex);
    const townRoads = this.generateTownRoads(connections, burgIndex);
    const trails = this.generateTrails(connections, burgIndex);
    const footpaths = this.generateFootpaths(connections, burgIndex);
    const majorSeaRoutes = this.generateMajorSeaRoutes(connections, burgIndex);
    const seaRoutes = this.generateSeaRoutes(connections, burgIndex);
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

  getRoute(from: number, to: number) {
    const routeId = pack.cells.routes[from]?.[to];
    if (routeId === undefined) return null;

    const route = pack.routes.find(route => route.i === routeId);
    if (!route) return null;

    return route;
  }

  hasRoad(cellId: number): boolean {
    const connections = pack.cells.routes[cellId];
    if (!connections) return false;

    return Object.values(connections).some(routeId => {
      const route = pack.routes.find(route => route.i === routeId);
      if (!route) return false;
      return route.group === "roads";
    });
  }

  isCrossroad(cellId: number): boolean {
    const connections = pack.cells.routes[cellId];
    if (!connections) return false;
    if (Object.keys(connections).length > 3) return true;
    const roadConnections = Object.values(connections).filter(routeId => {
      const route = pack.routes.find(route => route.i === routeId);
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
    const path = round(lineGen(points.map(p => [p[0], p[1]])) as string, 1);
    return path;
  }

  getLength(routeId: number): number {
    const path = routes.select(`#route${routeId}`).node() as SVGPathElement;
    return path.getTotalLength();
  }
}

window.Routes = new RoutesModule();
