import { quadtree } from "d3-quadtree";
import { each, ensureEl, gauss, minmax, normalize, P, rn } from "../utils";

declare global {
  var Burgs: BurgModule;
}
export interface Burg {
  cell: number;
  x: number;
  y: number;
  i?: number;
  state?: number;
  culture?: number;
  name?: string;
  feature?: number;
  capital?: number;
  lock?: boolean;
  port?: number;
  removed?: boolean;
  population?: number;
  type?: string;
  coa?: any;
  citadel?: number;
  plaza?: number;
  walls?: number;
  shanty?: number;
  temple?: number;
  group?: string;
  link?: string;
  MFCG?: string;
  settlementType?: string;
  isLargePort?: boolean;
  isRegionalCenter?: boolean;
  basePopulation?: number;
  flying?: number;
  skyPort?: number;
  altitude?: number;
  tradeRole?: "hub" | "waystation";
  tradeRoleManual?: boolean;
}

// Cultural spacing modifiers for settlement placement
const CULTURE_SPACING_MODIFIERS: Record<string, number> = {
  Naval: 0.7,
  Nomadic: 1.5,
  River: 0.6,
  Lake: 0.8,
  Highland: 1.2,
  Hunting: 1.3,
  Generic: 1.0
};

export function skyburgGroupFromPopulation(population: number): string {
  if (population >= 0.8) return "skyburg";
  if (population >= 0.4) return "skyburg-mid";
  return "skyburg-small";
}

class BurgModule {
  shift() {
    const { cells, features, burgs } = pack;
    const temp = grid.cells.temp;

    // port is a capital with any harbor OR any burg with a safe harbor
    // safe harbor is a cell having just one adjacent water cell
    const featurePortCandidates: Record<number, Burg[]> = {};
    for (const burg of burgs) {
      if (!burg.i || burg.lock) continue;
      if (burg.flying) continue; // skip flying burgs
      delete burg.port; // reset port status
      const cellId = burg.cell;

      const haven = cells.haven[cellId];
      const harbor = cells.harbor[cellId];
      const featureId = cells.f[haven];
      if (!featureId) continue; // no adjacent water body

      const isMulticell = features[featureId].cells > 1;
      const isHarbor = (harbor && burg.capital) || harbor === 1;
      const isFrozen = temp[cells.g[cellId]] <= 0;

      if (isMulticell && isHarbor && !isFrozen) {
        if (!featurePortCandidates[featureId]) featurePortCandidates[featureId] = [];
        featurePortCandidates[featureId].push(burg);
      }
    }

    const getCloseToEdgePoint = (cell1: number, cell2: number) => {
      const { cells, vertices } = pack;

      const [x0, y0] = cells.p[cell1];
      const commonVertices = cells.v[cell1].filter(vertex => vertices.c[vertex].some(cell => cell === cell2));
      const [x1, y1] = vertices.p[commonVertices[0]];
      const [x2, y2] = vertices.p[commonVertices[1]];
      const xEdge = (x1 + x2) / 2;
      const yEdge = (y1 + y2) / 2;

      const x = rn(x0 + 0.95 * (xEdge - x0), 2);
      const y = rn(y0 + 0.95 * (yEdge - y0), 2);

      return [x, y];
    };

    // shift ports to the edge of the water body
    Object.entries(featurePortCandidates).forEach(([featureId, burgs]) => {
      if (burgs.length < 2) return; // only one port on water body - skip
      burgs.forEach(burg => {
        burg.port = Number(featureId);
        const haven = cells.haven[burg.cell];
        const [x, y] = getCloseToEdgePoint(burg.cell, haven);
        burg.x = x;
        burg.y = y;
      });
    });

    // shift non-port river burgs a bit
    for (const burg of burgs) {
      if (!burg.i || burg.lock || burg.port || burg.flying || !cells.r[burg.cell]) continue;
      const cellId = burg.cell;
      const shift = Math.min(cells.fl[cellId] / 150, 1);
      burg.x = cellId % 2 ? rn(burg.x + shift, 2) : rn(burg.x - shift, 2);
      burg.y = cells.r[cellId] % 2 ? rn(burg.y + shift, 2) : rn(burg.y - shift, 2);
    }
  }

  private getCultureSpacingModifier(cultureType: string): number {
    return CULTURE_SPACING_MODIFIERS[cultureType] || 1.0;
  }

  generate() {
    TIME && console.time("generateBurgs");
    const { cells } = pack;

    let burgs: Burg[] = [0 as any]; // burgs array
    cells.burg = new Uint32Array(cells.i.length);

    const populatedCells = cells.i.filter(i => cells.s[i] > 0 && cells.culture[i]);
    if (!populatedCells.length) {
      ERROR && console.error("There is no populated cells with culture assigned. Cannot generate states");
      return burgs;
    }

    let burgsQuadtree = quadtree();

    // Scratch buffers shared across all placement tiers — allocate once,
    // refill in-place per tier. Avoids 7 × O(C) JS-array + typed-array
    // allocation cycles in the GC heap.
    const score = new Float32Array(cells.s.length);
    // Array.from — populatedCells may be a typed array at runtime (despite
    // PackedGraph.cells.i: number[] in the .d.ts). Plain array gives us a
    // mutable .length for the per-pass compaction below.
    const sortedScratch: number[] = Array.from(populatedCells);

    const refillScore = (randomize: (s: number) => number) => {
      for (let i = 0; i < cells.s.length; i++) score[i] = cells.s[i] * randomize(1);
    };

    const sortByScore = () => {
      sortedScratch.sort((a, b) => score[b] - score[a]);
      return sortedScratch;
    };

    const generateCapitals = () => {
      refillScore(() => 0.5 + Math.random() * 0.5);
      const sorted = sortByScore();

      const capitalsNumber = getCapitalsNumber();
      let spacing = (graphWidth + graphHeight) / 2 / capitalsNumber; // min distance between capitals

      for (let i = 0; burgs.length <= capitalsNumber; i++) {
        const cell = sorted[i];
        const [x, y] = cells.p[cell];

        if (burgsQuadtree.find(x, y, spacing) === undefined) {
          burgs.push({ cell, x, y, settlementType: "capital" });
          burgsQuadtree.add([x, y]);
        }

        // reset if all cells were checked
        if (i === sorted.length - 1) {
          WARN && console.warn("Cannot place capitals with current spacing. Trying again with reduced spacing");
          burgsQuadtree = quadtree();
          i = -1;
          burgs = [0 as any];
          spacing /= 1.2;
        }
      }

      burgs.forEach((burg, burgId) => {
        if (!burgId) return;
        burg.i = burgId;
        burg.state = burgId;
        burg.culture = cells.culture[burg.cell];
        burg.name = Names.getCultureShort(burg.culture);
        burg.feature = cells.f[burg.cell];
        burg.capital = 1;
        burg.skyPort = 1; // capitals double as airroute hubs for the flying islands
        cells.burg[burg.cell] = burgId;
      });
    };

    const identifyLargePorts = () => {
      // Identify strategic harbor cities among existing capitals that are ports
      // and place additional large port burgs at key coastal locations
      const portCells = populatedCells.filter(i => {
        if (cells.burg[i]) return false; // already has a burg
        const haven = cells.haven[i];
        if (!haven) return false;
        const harbor = cells.harbor[i];
        return harbor === 1 && cells.s[i] > 3; // safe harbor with decent population
      });

      if (!portCells.length) return;

      refillScore(() => 0.6 + Math.random() * 0.4);
      const sorted = portCells.sort((a, b) => score[b] - score[a]);

      const targetCount = Math.max(2, Math.floor(getCapitalsNumber() * 0.5));
      const portSpacing = (graphWidth + graphHeight) / 2 / (targetCount * 2);
      let added = 0;

      for (let i = 0; i < sorted.length && added < targetCount; i++) {
        const cell = sorted[i];
        const [x, y] = cells.p[cell];

        if (burgsQuadtree.find(x, y, portSpacing) !== undefined) continue;

        const burgId = burgs.length;
        const culture = cells.culture[cell];
        const name = Names.getCulture(culture);
        const feature = cells.f[cell];
        burgs.push({
          cell,
          x,
          y,
          i: burgId,
          state: 0,
          culture,
          name,
          feature,
          capital: 0,
          settlementType: "largePort",
          isLargePort: true
        });
        burgsQuadtree.add([x, y]);
        cells.burg[cell] = burgId;
        added++;
      }
    };

    const placeRegionalCenters = () => {
      // Place regional centers between primary centers (capitals + large ports)
      refillScore(() => gauss(1, 2, 0, 10, 3));
      const sorted = sortByScore();

      const capitalsCount = getCapitalsNumber();
      const targetCount = Math.max(2, Math.floor(capitalsCount * 1.5));
      const baseSpacing = (graphWidth + graphHeight) / 2 / (capitalsCount * 3);
      let added = 0;

      for (let i = 0; i < sorted.length && added < targetCount; i++) {
        if (cells.burg[sorted[i]]) continue;
        const cell = sorted[i];
        const [x, y] = cells.p[cell];

        const culture = cells.culture[cell];
        const cultureType = pack.cultures[culture]?.type || "Generic";
        const spacingMod = this.getCultureSpacingModifier(cultureType);
        const spacing = baseSpacing * spacingMod * gauss(1, 0.3, 0.5, 1.5, 2);

        if (burgsQuadtree.find(x, y, spacing) !== undefined) continue;

        const burgId = burgs.length;
        const name = Names.getCulture(culture);
        const feature = cells.f[cell];
        burgs.push({
          cell,
          x,
          y,
          i: burgId,
          state: 0,
          culture,
          name,
          feature,
          capital: 0,
          settlementType: "regionalCenter",
          isRegionalCenter: true
        });
        burgsQuadtree.add([x, y]);
        cells.burg[cell] = burgId;
        added++;
      }
    };

    const placeMarketTowns = () => {
      // ~7% of settlements, 15-30km spacing equivalent
      refillScore(() => gauss(1, 3, 0, 20, 3));
      const sorted = sortByScore();

      const totalTarget = getTownsNumber();
      const targetCount = Math.floor(totalTarget * 0.07);
      const baseSpacing = (graphWidth + graphHeight) / 150 / (totalTarget ** 0.5 / 20);
      let added = 0;

      for (let i = 0; i < sorted.length && added < targetCount; i++) {
        if (cells.burg[sorted[i]]) continue;
        const cell = sorted[i];
        const [x, y] = cells.p[cell];

        const culture = cells.culture[cell];
        const cultureType = pack.cultures[culture]?.type || "Generic";
        const spacingMod = this.getCultureSpacingModifier(cultureType);
        const spacing = baseSpacing * spacingMod * gauss(1, 0.3, 0.5, 2, 2);

        if (burgsQuadtree.find(x, y, spacing) !== undefined) continue;

        const burgId = burgs.length;
        const name = Names.getCulture(culture);
        const feature = cells.f[cell];
        burgs.push({
          cell,
          x,
          y,
          i: burgId,
          state: 0,
          culture,
          name,
          feature,
          capital: 0,
          settlementType: "marketTown"
        });
        burgsQuadtree.add([x, y]);
        cells.burg[cell] = burgId;
        added++;
      }
    };

    const placeLargeVillages = () => {
      // ~12% of settlements, 8-12km spacing equivalent
      refillScore(() => gauss(1, 3, 0, 20, 3));
      const sorted = sortByScore();

      const totalTarget = getTownsNumber();
      const targetCount = Math.floor(totalTarget * 0.12);
      const baseSpacing = (graphWidth + graphHeight) / 150 / (totalTarget ** 0.6 / 30);
      let added = 0;

      for (let i = 0; i < sorted.length && added < targetCount; i++) {
        if (cells.burg[sorted[i]]) continue;
        const cell = sorted[i];
        const [x, y] = cells.p[cell];

        const culture = cells.culture[cell];
        const cultureType = pack.cultures[culture]?.type || "Generic";
        const spacingMod = this.getCultureSpacingModifier(cultureType);
        const spacing = baseSpacing * spacingMod * gauss(1, 0.3, 0.3, 1.8, 2);

        if (burgsQuadtree.find(x, y, spacing) !== undefined) continue;

        const burgId = burgs.length;
        const name = Names.getCulture(culture);
        const feature = cells.f[cell];
        burgs.push({
          cell,
          x,
          y,
          i: burgId,
          state: 0,
          culture,
          name,
          feature,
          capital: 0,
          settlementType: "largeVillage"
        });
        burgsQuadtree.add([x, y]);
        cells.burg[cell] = burgId;
        added++;
      }
    };

    const placeSmallVillages = () => {
      // ~20% of settlements, 3-6km spacing equivalent
      refillScore(() => gauss(1, 3, 0, 20, 3));
      const sorted = sortByScore();

      const totalTarget = getTownsNumber();
      const targetCount = Math.floor(totalTarget * 0.2);
      const baseSpacing = (graphWidth + graphHeight) / 150 / (totalTarget ** 0.65 / 15);
      let added = 0;

      for (let pass = 0; added < targetCount && pass < 3; pass++) {
        for (let i = 0; i < sorted.length && added < targetCount; i++) {
          if (cells.burg[sorted[i]]) continue;
          const cell = sorted[i];
          const [x, y] = cells.p[cell];

          const culture = cells.culture[cell];
          const cultureType = pack.cultures[culture]?.type || "Generic";
          const spacingMod = this.getCultureSpacingModifier(cultureType);
          const spacing = baseSpacing * spacingMod * gauss(1, 0.3, 0.2, 1.5, 2) * (1 / (pass + 1));

          if (burgsQuadtree.find(x, y, spacing) !== undefined) continue;

          const burgId = burgs.length;
          const name = Names.getCulture(culture);
          const feature = cells.f[cell];
          burgs.push({
            cell,
            x,
            y,
            i: burgId,
            state: 0,
            culture,
            name,
            feature,
            capital: 0,
            settlementType: "smallVillage"
          });
          burgsQuadtree.add([x, y]);
          cells.burg[cell] = burgId;
          added++;
        }

        // Compact: drop cells already assigned to a burg so the next pass
        // (and later tiers sharing sortedScratch) don't re-scan them.
        let w = 0;
        for (let r = 0; r < sorted.length; r++) {
          if (!cells.burg[sorted[r]]) sorted[w++] = sorted[r];
        }
        sorted.length = w;
      }
    };

    const placeHamlets = () => {
      // remaining ~60% of settlements, 1-3km spacing equivalent
      refillScore(() => gauss(1, 3, 0, 20, 3));
      const sorted = sortByScore();

      const totalTarget = getTownsNumber();
      const currentCount = burgs.length - 1; // subtract placeholder
      const targetCount = totalTarget - currentCount;
      if (targetCount <= 0) return;

      // For large totalTarget on typical maps the initial spacing is already
      // sub-pixel, so we bound by pass count (like placeSmallVillages) rather
      // than spacing magnitude — otherwise the loop never enters and 0 hamlets
      // are placed.
      let spacing = (graphWidth + graphHeight) / 150 / (totalTarget ** 0.7 / 66);
      let added = 0;

      for (let pass = 0; added < targetCount && pass < 10; pass++) {
        for (let i = 0; added < targetCount && i < sorted.length; i++) {
          if (cells.burg[sorted[i]]) continue;
          const cell = sorted[i];
          const [x, y] = cells.p[cell];

          const culture = cells.culture[cell];
          const cultureType = pack.cultures[culture]?.type || "Generic";
          const spacingMod = this.getCultureSpacingModifier(cultureType);
          const minSpacing = spacing * spacingMod * gauss(1, 0.3, 0.2, 2, 2);

          if (burgsQuadtree.find(x, y, minSpacing) !== undefined) continue;

          const burgId = burgs.length;
          const name = Names.getCulture(culture);
          const feature = cells.f[cell];
          burgs.push({
            cell,
            x,
            y,
            i: burgId,
            state: 0,
            culture,
            name,
            feature,
            capital: 0,
            settlementType: "hamlet"
          });
          added++;
          cells.burg[cell] = burgId;
        }

        // Compact: drop cells already assigned so the next spacing pass skips them.
        let w = 0;
        for (let r = 0; r < sorted.length; r++) {
          if (!cells.burg[sorted[r]]) sorted[w++] = sorted[r];
        }
        sorted.length = w;

        spacing *= 0.5;
      }
    };

    const generateSkyBurgs = () => {
      // Target 1% of total ground burgs, clustered around a random coastline
      // anchor so the archipelago straddles land and sea. Radius is capped to
      // a fixed map fraction so the cluster stays visually bounded, and the
      // count is capped by what actually fits at the target spacing.
      const requestedCount = Math.round((burgs.length - 1) * 0.01);
      if (requestedCount < 1) return;

      const coastalCells: number[] = [];
      for (let i = 0; i < cells.t.length; i++) {
        if (cells.t[i] === 1 || cells.t[i] === -1) coastalCells.push(i);
      }
      if (!coastalCells.length) return;

      const anchorCell = coastalCells[Math.floor(Math.random() * coastalCells.length)];
      const [ax, ay] = cells.p[anchorCell];

      const minSpacing = (graphWidth + graphHeight) / 400;
      const maxRadius = Math.min(graphWidth, graphHeight) * 0.1;
      // Hexagonal-pack capacity at minSpacing (≈0.9 density), so the count
      // can't exceed what physically fits in the cluster disc.
      const capacity = Math.floor((Math.PI * maxRadius * maxRadius * 0.9) / (minSpacing * minSpacing));
      const skyburgCount = Math.min(requestedCount, capacity);
      const radius = maxRadius;

      const skyQuadtree = quadtree();
      let added = 0;
      const maxAttempts = skyburgCount * 30;

      for (let attempts = 0; added < skyburgCount && attempts < maxAttempts; attempts++) {
        const theta = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius; // uniform within disc
        const x = ax + Math.cos(theta) * r;
        const y = ay + Math.sin(theta) * r;
        if (x < 0 || x > graphWidth || y < 0 || y > graphHeight) continue;
        if (skyQuadtree.find(x, y, minSpacing) !== undefined) continue;

        const cell = window.findCell(x, y, undefined, pack) as number;
        const culture = cells.culture[cell] || 0;
        const burgId = burgs.length;
        burgs.push({
          cell,
          x,
          y,
          i: burgId,
          state: 0,
          culture,
          name: Names.getCulture(culture),
          feature: cells.f[cell],
          capital: 0,
          port: 0,
          flying: 1,
          skyPort: 1,
          altitude: 500,
          settlementType: "regionalCenter"
        });
        skyQuadtree.add([x, y]);
        added++;
      }
    };

    // 6-stage hierarchical placement + skyburg cluster
    generateCapitals();
    identifyLargePorts();
    placeRegionalCenters();
    placeMarketTowns();
    placeLargeVillages();
    placeSmallVillages();
    placeHamlets();
    generateSkyBurgs();

    pack.burgs = burgs;
    this.shift();

    TIME && console.timeEnd("generateBurgs");

    function getCapitalsNumber() {
      let number = (ensureEl("statesNumber") as HTMLInputElement).valueAsNumber;

      if (populatedCells.length < number * 10) {
        number = Math.floor(populatedCells.length / 10);
        WARN && console.warn(`Not enough populated cells. Generating only ${number} capitals/states`);
      }

      return number;
    }

    function getTownsNumber() {
      const manorsInput = ensureEl("manorsInput") as HTMLInputElement;
      const isAuto = manorsInput.value === "1000"; // '1000' is considered as auto
      if (isAuto) return rn(populatedCells.length / 5 / (grid.points.length / 10000) ** 0.8);

      return Math.min(manorsInput.valueAsNumber, populatedCells.length);
    }
  }

  getType(cellId: number, port?: number) {
    const { cells, features } = pack;

    if (port) return "Naval";

    const haven = cells.haven[cellId];
    if (haven !== undefined && features[cells.f[haven]].type === "lake") return "Lake";

    if (cells.h[cellId] > 60) return "Highland";

    if (cells.r[cellId] && cells.fl[cellId] >= 100) return "River";

    const biome = cells.biome[cellId];
    const population = cells.pop[cellId];
    if (!cells.burg[cellId] || population <= 5) {
      if (population < 5 && [1, 2, 3, 4].includes(biome)) return "Nomadic";
      if (biome > 4 && biome < 10) return "Hunting";
    }

    return "Generic";
  }

  private definePopulation(burg: Burg) {
    if (burg.flying) {
      // Skyburgs: small floating settlements, 200-1500 people. Skip the
      // ground-route connectivity modifier — flying burgs aren't on roads.
      let population = gauss(0.6, 0.4, 0.2, 1.5);
      population += (((burg.i as number) % 100) - (burg.cell % 100)) / 1000;
      burg.basePopulation = population;
      burg.population = rn(Math.max(population, 0.01), 3);
      return;
    }
    const sType = burg.settlementType || "hamlet";

    // Tier-based population ranges (population units, multiply by populationRate for actual people)
    // Capitals: 10k-200k (gauss: mean=50, dev=75, min=10, max=200)
    // Large ports: 5k-50k (gauss: mean=20, dev=30, min=5, max=50)
    // Regional centers: 1k-10k (gauss: mean=5.5, dev=4.5, min=1, max=10)
    // Market towns: 1k-10k (gauss: mean=5.5, dev=4.5, min=1, max=10)
    // Large villages: 200-1k (gauss: mean=0.6, dev=0.4, min=0.2, max=1)
    // Small villages: 50-500 (gauss: mean=0.275, dev=0.225, min=0.05, max=0.5)
    // Hamlets: 10-50 (gauss: mean=0.03, dev=0.02, min=0.01, max=0.05)

    let population: number;
    switch (sType) {
      case "capital":
        population = gauss(50, 75, 10, 200);
        break;
      case "largePort":
        population = gauss(20, 30, 5, 50);
        break;
      case "regionalCenter":
        population = gauss(5.5, 4.5, 1, 10);
        break;
      case "marketTown":
        population = gauss(5.5, 4.5, 1, 10);
        break;
      case "largeVillage":
        population = gauss(0.6, 0.4, 0.2, 1);
        break;
      case "smallVillage":
        population = gauss(0.275, 0.225, 0.05, 0.5);
        break;
      // biome-ignore lint/complexity/noUselessSwitchCase: hamlet listed explicitly to document the 7-tier system
      case "hamlet":
      default:
        population = gauss(0.03, 0.02, 0.01, 0.05);
        break;
    }

    // Apply connectivity modifier
    const cellId = burg.cell;
    const connectivityRate = Routes.getConnectivityRate(cellId);
    if (connectivityRate) population *= connectivityRate;

    // Unround with small offset
    population += (((burg.i as number) % 100) - (cellId % 100)) / 1000;

    burg.basePopulation = population;
    burg.population = rn(Math.max(population, 0.01), 3);
  }

  private defineEmblem(burg: Burg) {
    burg.type = this.getType(burg.cell, burg.port);

    // Only generate COA for settlements with pop > 0.5 (500 people) or capitals/ports
    if ((burg.population as number) <= 0.5 && !burg.capital && !burg.port) {
      return;
    }

    const state = pack.states[burg.state as number];
    const stateCOA = state.coa;

    let kinship = 0.25;
    if (burg.capital) kinship += 0.1;
    else if (burg.port) kinship -= 0.1;
    if (burg.culture !== state.culture) kinship -= 0.25;

    const type = burg.capital && P(0.2) ? "Capital" : burg.type === "Generic" ? "City" : burg.type;
    burg.coa = COA.generate(stateCOA, kinship, null, type);
    burg.coa.shield = COA.getShield(burg.culture!, burg.state!);
  }

  private defineFeatures(burg: Burg) {
    const pop = burg.population as number;
    const sType = burg.settlementType || "hamlet";

    // Settlement-type-based feature probabilities
    switch (sType) {
      case "capital":
        burg.citadel = 1;
        burg.plaza = 1;
        burg.walls = 1;
        burg.shanty = Number(pop > 60 || (pop > 40 && P(0.75)));
        burg.temple = Number(pop > 20 || P(0.7));
        break;
      case "largePort":
        burg.citadel = Number(P(0.6));
        burg.plaza = 1;
        burg.walls = Number(pop > 10 || P(0.7));
        burg.shanty = Number(pop > 30 && P(0.5));
        burg.temple = Number(pop > 15 || P(0.4));
        break;
      case "regionalCenter":
        burg.citadel = Number(pop > 5 && P(0.6));
        burg.plaza = Number(P(0.8));
        burg.walls = Number(pop > 5 || P(0.5));
        burg.shanty = Number(pop > 20 && P(0.3));
        burg.temple = Number(pop > 10 || P(0.5));
        break;
      case "marketTown":
        burg.citadel = Number(pop > 5 && P(0.3));
        burg.plaza = 1; // market towns always get plaza
        burg.walls = Number(pop > 5 || P(0.3));
        burg.shanty = 0;
        burg.temple = Number(pop > 5 || P(0.3));
        break;
      case "largeVillage":
        burg.citadel = Number(P(0.15));
        burg.plaza = Number(P(0.4));
        burg.walls = Number(P(0.2));
        burg.shanty = 0;
        burg.temple = Number(P(0.3));
        break;
      case "smallVillage":
        burg.citadel = Number(P(0.05));
        burg.plaza = Number(P(0.15));
        burg.walls = Number(P(0.05));
        burg.shanty = 0;
        burg.temple = Number(P(0.15));
        break;
      // biome-ignore lint/complexity/noUselessSwitchCase: hamlet listed explicitly to document the 7-tier system
      case "hamlet":
      default:
        burg.citadel = 0;
        burg.plaza = 0;
        burg.walls = 0;
        burg.shanty = 0;
        burg.temple = Number(P(0.05));
        break;
    }
  }

  getDefaultGroups() {
    return [
      {
        name: "capital",
        active: true,
        order: 9,
        features: { capital: true },
        preview: "watabou-city"
      },
      {
        name: "city",
        active: true,
        order: 8,
        percentile: 90,
        min: 5,
        preview: "watabou-city"
      },
      {
        name: "fort",
        active: true,
        features: { citadel: true, walls: false, plaza: false, port: false },
        order: 6,
        max: 1
      },
      {
        name: "monastery",
        active: true,
        features: { temple: true, walls: false, plaza: false, port: false },
        order: 5,
        max: 0.8
      },
      {
        name: "caravanserai",
        active: true,
        features: { port: false, plaza: true },
        order: 4,
        max: 0.8,
        biomes: [1, 2, 3]
      },
      {
        name: "trading_post",
        active: true,
        order: 3,
        features: { plaza: true },
        max: 0.8,
        biomes: [5, 6, 7, 8, 9, 10, 11, 12]
      },
      {
        name: "village",
        active: true,
        order: 2,
        min: 0.1,
        max: 2,
        preview: "watabou-village"
      },
      {
        name: "hamlet",
        active: true,
        order: 1,
        features: { plaza: false },
        max: 0.1,
        preview: "watabou-village"
      },
      {
        name: "skyburg",
        active: true,
        order: 10,
        features: { flying: true }
      },
      {
        name: "skyburg-mid",
        active: true,
        order: 10,
        features: { flying: true }
      },
      {
        name: "skyburg-small",
        active: true,
        order: 10,
        features: { flying: true }
      },
      {
        name: "town",
        active: true,
        order: 7,
        isDefault: true,
        preview: "watabou-city"
      }
    ];
  }

  private buildPopIndex(populations: number[]): Map<number, number> {
    const map = new Map<number, number>();
    for (let i = 0; i < populations.length; i++) {
      if (!map.has(populations[i])) map.set(populations[i], i);
    }
    return map;
  }

  defineGroup(burg: Burg, popIndex: Map<number, number>, popCount: number) {
    if (burg.lock && burg.group) {
      // locked burgs: don't change group if it still exists
      const group = options.burgs.groups.find((g: any) => g.name === burg.group);
      if (group) return;
    }

    // Flying burgs: assign group by population tier for zoom-level culling
    if (burg.flying) {
      burg.group = skyburgGroupFromPopulation(burg.population as number);
      return;
    }

    const defaultGroup = options.burgs.groups.find((g: any) => g.isDefault);
    if (!defaultGroup) {
      ERROR && console.error("No default group defined");
      return;
    }
    burg.group = defaultGroup.name;

    for (const group of options.burgs.groups) {
      if (!group.active) continue;
      if (group.name === "skyburg" || group.name === "skyburg-mid" || group.name === "skyburg-small") continue; // skip skyburg groups for non-flying burgs

      if (group.min) {
        const isFit = (burg.population as number) >= group.min;
        if (!isFit) continue;
      }

      if (group.max) {
        const isFit = (burg.population as number) <= group.max;
        if (!isFit) continue;
      }

      if (group.features) {
        const isFit = Object.entries(group.features as Record<string, boolean>).every(
          ([feature, value]) => Boolean(burg[feature as keyof Burg]) === value
        );
        if (!isFit) continue;
      }

      if (group.biomes) {
        const isFit = group.biomes.includes(pack.cells.biome[burg.cell]);
        if (!isFit) continue;
      }

      if (group.percentile) {
        const index = popIndex.get(burg.population as number) ?? -1;
        const isFit = index >= Math.floor((popCount * group.percentile) / 100);
        if (!isFit) continue;
      }

      burg.group = group.name; // apply fitting group
      return;
    }
  }

  specify() {
    TIME && console.time("specifyBurgs");

    pack.burgs.forEach(burg => {
      if (!burg.i || burg.removed || burg.lock) return;
      this.definePopulation(burg);
      this.defineEmblem(burg);
      this.defineFeatures(burg);
    });

    const populations = pack.burgs
      .filter(b => b.i && !b.removed)
      .map(b => b.population as number)
      .sort((a: number, b: number) => a - b); // ascending

    const popIndex = this.buildPopIndex(populations);

    pack.burgs.forEach(burg => {
      if (!burg.i || burg.removed) return;
      this.defineGroup(burg, popIndex, populations.length);
    });

    TIME && console.timeEnd("specifyBurgs");
  }

  private createWatabouCityLinks(burg: Burg) {
    const cells = pack.cells;
    const { i, name, population: burgPopulation, cell } = burg;
    const burgSeed = burg.MFCG || seed + String(burg.i).padStart(4, "0");

    const sizeRaw = 2.13 * ((burgPopulation! * populationRate) / urbanDensity) ** 0.385;
    const size = minmax(Math.ceil(sizeRaw), 6, 100);
    const population = rn(burgPopulation! * populationRate * urbanization);

    const river = cells.r[cell] ? 1 : 0;
    const coast = Number((burg.port || 0) > 0);
    const sea = (() => {
      if (!coast || !cells.haven[cell]) return null;

      // calculate see direction: 0 = east, 0.5 = north, 1 = west, 1.5 = south
      const [x1, y1] = cells.p[cell];
      const [x2, y2] = cells.p[cells.haven[cell]];
      const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;

      if (deg <= 0) return rn(normalize(Math.abs(deg), 0, 180), 2);
      return rn(2 - normalize(deg, 0, 180), 2);
    })();

    const arableBiomes = river ? [1, 2, 3, 4, 5, 6, 7, 8] : [5, 6, 7, 8];
    const farms = +arableBiomes.includes(cells.biome[cell]);

    const citadel = +(burg.citadel as number);
    const urban_castle = +(citadel && each(2)(i as number));

    const hub = Routes.isCrossroad(cell);
    const walls = +(burg.walls as number);
    const plaza = +(burg.plaza as number);
    const temple = +(burg.temple as number);
    const shantytown = +(burg.shanty as number);

    const style = "natural";

    const url = new URL("https://watabou.github.io/city-generator/");
    url.search = new URLSearchParams({
      name: name || "",
      population: population.toString(),
      size: size.toString(),
      seed: burgSeed,
      river: river.toString(),
      coast: coast.toString(),
      farms: farms.toString(),
      citadel: citadel.toString(),
      urban_castle: urban_castle.toString(),
      hub: hub.toString(),
      plaza: plaza.toString(),
      temple: temple.toString(),
      walls: walls.toString(),
      shantytown: shantytown.toString(),
      gates: (-1).toString(),
      style
    }).toString();
    if (sea) url.searchParams.append("sea", sea.toString());

    const link = url.toString();
    return { link, preview: `${link}&preview=1` };
  }

  private createWatabouVillageLinks(burg: Burg) {
    const { cells, features } = pack;
    const { i, population, cell } = burg;

    const burgSeed = seed + String(i).padStart(4, "0");
    const pop = rn(population! * populationRate * urbanization);
    const tags = [];

    if (cells.r[cell] && cells.haven[cell]) tags.push("estuary");
    else if (cells.haven[cell] && features[cells.f[cell]].cells === 1) tags.push("island,district");
    else if (burg.port) tags.push("coast");
    else if (cells.conf[cell]) tags.push("confluence");
    else if (cells.r[cell]) tags.push("river");
    else if (pop < 200 && each(4)(cell)) tags.push("pond");

    const connectivityRate = Routes.getConnectivityRate(cell);
    tags.push(connectivityRate > 1 ? "highway" : connectivityRate === 1 ? "dead end" : "isolated");

    const biome = cells.biome[cell];
    const arableBiomes = cells.r[cell] ? [1, 2, 3, 4, 5, 6, 7, 8] : [5, 6, 7, 8];
    if (!arableBiomes.includes(biome)) tags.push("uncultivated");
    else if (each(6)(cell)) tags.push("farmland");

    const temp = grid.cells.temp[cells.g[cell]];
    if (temp <= 0 || temp > 28 || (temp > 25 && each(3)(cell))) tags.push("no orchards");

    if (!burg.plaza) tags.push("no square");
    if (burg.walls) tags.push("palisade");

    if (pop < 100) tags.push("sparse");
    else if (pop > 300) tags.push("dense");

    const width = (() => {
      if (pop > 1500) return 1600;
      if (pop > 1000) return 1400;
      if (pop > 500) return 1000;
      if (pop > 200) return 800;
      if (pop > 100) return 600;
      return 400;
    })();
    const height = rn(width / 2.05);

    const style = (() => {
      if ([1, 2].includes(biome)) return "sand";
      if (temp <= 5 || [9, 10, 11].includes(biome)) return "snow";
      return "default";
    })();

    const url = new URL("https://watabou.github.io/village-generator/");
    url.search = new URLSearchParams({
      pop: pop.toString(),
      name: burg.name || "",
      seed: burgSeed,
      width: width.toString(),
      height: height.toString(),
      style,
      tags: tags.join(",")
    }).toString();

    const link = url.toString();
    return { link, preview: `${link}&preview=1` };
  }

  private createWatabouDwellingLinks(burg: Burg) {
    const burgSeed = seed + String(burg.i).padStart(4, "0");
    const pop = rn(burg.population! * populationRate * urbanization);

    const tags = (() => {
      if (pop > 200) return ["large", "tall"];
      if (pop > 100) return ["large"];
      if (pop > 50) return ["tall"];
      if (pop > 20) return ["low"];
      return ["small"];
    })();

    const url = new URL("https://watabou.github.io/dwellings/");
    url.search = new URLSearchParams({
      pop: pop.toString(),
      name: "",
      seed: burgSeed,
      tags: tags.join(",")
    }).toString();

    const link = url.toString();
    return { link, preview: `${link}&preview=1` };
  }

  getPreview(burg: Burg): { link: string | null; preview: string | null } {
    const previewGeneratorsMap: Record<string, (burg: Burg) => { link: string | null; preview: string | null }> = {
      "watabou-city": (burg: Burg) => this.createWatabouCityLinks(burg),
      "watabou-village": (burg: Burg) => this.createWatabouVillageLinks(burg),
      "watabou-dwelling": (burg: Burg) => this.createWatabouDwellingLinks(burg)
    };
    if (burg.link) return { link: burg.link, preview: burg.link };

    const group = options.burgs.groups.find((g: any) => g.name === burg.group);
    if (!group?.preview || !previewGeneratorsMap[group.preview]) return { link: null, preview: null };

    return previewGeneratorsMap[group.preview](burg);
  }

  add([x, y]: [number, number], options?: { flying?: boolean; altitude?: number }) {
    const { cells } = pack;
    const flying = Boolean(options?.flying);

    const burgId = pack.burgs.length;
    const cellId = window.findCell(x, y, undefined, pack);
    const culture = cells.culture[cellId as number];
    const name = Names.getCulture(culture);
    // Flying burgs aren't tied to ground political ownership; default to neutral.
    const state = flying ? 0 : cells.state[cellId as number];
    const feature = cells.f[cellId as number];

    const burg: Burg = {
      cell: cellId as number,
      x,
      y,
      i: burgId,
      state,
      culture,
      name,
      feature,
      capital: 0,
      port: 0,
      settlementType: flying ? "regionalCenter" : "hamlet"
    };
    if (flying) {
      burg.flying = 1;
      burg.skyPort = 1;
      burg.altitude = options?.altitude ?? 500;
    }
    this.definePopulation(burg);
    this.defineEmblem(burg);
    COArenderer.add("burg", burgId, burg.coa, x, y);
    this.defineFeatures(burg);

    const populations = pack.burgs
      .filter(b => b.i && !b.removed)
      .map(b => b.population as number)
      .sort((a: number, b: number) => a - b); // ascending

    const popIndex = this.buildPopIndex(populations);

    this.defineGroup(burg, popIndex, populations.length);

    pack.burgs.push(burg);
    // Skyburgs don't occupy the per-cell ground burg slot, so a flying burg
    // can share a cell with a ground burg and other skyburgs can stack here.
    if (!flying) cells.burg[cellId as number] = burgId;

    if (flying) {
      Routes.rebuildAirroutes();
    } else {
      const newRoute = Routes.connect(cellId as number);
      if (newRoute && layerIsOn("toggleRoutes")) drawRoute(newRoute);
    }

    drawBurgIcon(burg);
    drawBurgLabel(burg);

    return burgId;
  }

  changeGroup(burg: Burg, group: string | null) {
    if (group) {
      burg.group = group;
    } else {
      const validBurgs = pack.burgs.filter(b => b.i && !b.removed);
      const populations = validBurgs.map(b => b.population as number).sort((a, b) => a - b);
      const popIndex = this.buildPopIndex(populations);
      this.defineGroup(burg, popIndex, populations.length);
    }

    drawBurgIcon(burg);
    drawBurgLabel(burg);
  }

  remove(burgId: number) {
    const burg = pack.burgs[burgId];
    if (!burg) return tip(`Burg ${burgId} not found`, false, "error");

    pack.cells.burg[burg.cell] = 0;
    burg.removed = true;

    const noteId = notes.findIndex(note => note.id === `burg${burgId}`);
    if (noteId !== -1) notes.splice(noteId, 1);

    if (burg.coa) {
      document.getElementById(`burgCOA${burgId}`)?.remove();
      emblems.select(`#burgEmblems > use[data-i='${burgId}']`).remove();
      delete burg.coa;
    }

    removeBurgIcon(burg.i!);
    removeBurgLabel(burg.i!);
  }
}
window.Burgs = new BurgModule();
