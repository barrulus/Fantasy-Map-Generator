import type { Burg } from "./burgs-generator";

export interface TradeNode {
  index: number;
  x: number;
  y: number;
  component: number;
  burg: Burg;
}

// Adjacency over trade nodes: an undirected edge exists when two nodes are in the
// same navigable component and within one leg (squared distance <= maxLegDist2).
// O(n^2) over the small trade-node set.
export function buildLegGraph(
  nodes: TradeNode[],
  maxLegDist2: number,
  dist2: (a: TradeNode, b: TradeNode) => number
): number[][] {
  const adj: number[][] = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].component !== nodes[j].component) continue;
      if (dist2(nodes[i], nodes[j]) > maxLegDist2) continue;
      adj[i].push(j);
      adj[j].push(i);
    }
  }
  return adj;
}

export interface TradeRoleConfig {
  importance: (b: Burg) => number;
  isLargePort: (b: Burg) => boolean;
  minHubSize: number;
  capitalByState: Map<number, Burg>;
  dist2: (ax: number, ay: number, bx: number, by: number) => number;
}

// Sets burg.tradeRole on hubs (one per state: the port nearest the capital that
// clears minHubSize) and waystations (every other large port). Burgs flagged
// tradeRoleManual keep whatever role they have and are skipped.
export function assignTradeRoles(burgs: Burg[], cfg: TradeRoleConfig): void {
  const { importance, isLargePort, minHubSize, capitalByState, dist2 } = cfg;

  // Reset non-manual roles so regeneration is idempotent. Skip the numeric
  // burgs[0] placeholder (writing a property onto `0` throws in strict mode).
  for (const b of burgs) {
    if (!b || !b.i) continue;
    if (!b.tradeRoleManual) b.tradeRole = undefined;
  }

  // Hubs: nearest qualifying port to each state's capital.
  const portsByState = new Map<number, Burg[]>();
  for (const b of burgs) {
    if (b.tradeRoleManual) continue;
    if (!b.i || b.removed || b.flying || !b.port) continue;
    if (importance(b) < minHubSize) continue;
    const s = b.state;
    if (s === undefined) continue;
    const list = portsByState.get(s);
    if (list) list.push(b);
    else portsByState.set(s, [b]);
  }

  const hubs = new Set<Burg>();
  for (const [state, ports] of portsByState) {
    const cap = capitalByState.get(state);
    if (!cap) continue;
    let best: Burg | null = null;
    let bestD = Infinity;
    for (const p of ports) {
      const d = dist2(p.x, p.y, cap.x, cap.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) {
      best.tradeRole = "hub";
      hubs.add(best);
    }
  }

  // Waystations: every large port not already a (manual or auto) hub.
  for (const b of burgs) {
    if (b.tradeRoleManual) continue;
    if (!b.i || b.removed || b.flying || !b.port) continue;
    if (b.tradeRole === "hub" || hubs.has(b)) continue;
    if (isLargePort(b)) b.tradeRole = "waystation";
  }
}

export interface TradeLeg {
  a: number; // node index (a < b)
  b: number;
  uses: number;
}

export interface TradeNetworkResult {
  routes: number[][]; // each: node-index sequence hub..hub
  legs: TradeLeg[]; // unique undirected legs + usage count
}

// BFS shortest (fewest-hop) path between a pair of nodes, bounded to maxHops legs.
// Returns the node-index path, or null if unreachable within the cap.
function bfsPath(nodeCount: number, adj: number[][], start: number, goal: number, maxHops: number): number[] | null {
  if (start === goal) return null;
  const prev = new Int32Array(nodeCount).fill(-1);
  const depth = new Int32Array(nodeCount).fill(-1);
  const queue = [start];
  depth[start] = 0;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (depth[cur] >= maxHops) continue; // can't extend further
    for (const next of adj[cur]) {
      if (depth[next] !== -1) continue;
      depth[next] = depth[cur] + 1;
      prev[next] = cur;
      if (next === goal) {
        const path = [goal];
        let c = goal;
        while (prev[c] !== -1) {
          c = prev[c];
          path.push(c);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

// For each unordered hub pair, route a fewest-hop path (<= maxHops) over the leg
// graph. Viable paths become trade routes; their legs are unioned with usage counts.
export function routeTradeNetwork(
  nodeCount: number,
  adj: number[][],
  hubIndices: number[],
  maxHops: number
): TradeNetworkResult {
  const routes: number[][] = [];
  const legMap = new Map<number, TradeLeg>();

  for (let i = 0; i < hubIndices.length; i++) {
    for (let j = i + 1; j < hubIndices.length; j++) {
      const path = bfsPath(nodeCount, adj, hubIndices[i], hubIndices[j], maxHops);
      if (!path) continue;
      routes.push(path);
      for (let k = 0; k < path.length - 1; k++) {
        const a = Math.min(path[k], path[k + 1]);
        const b = Math.max(path[k], path[k + 1]);
        const key = a * nodeCount + b;
        const existing = legMap.get(key);
        if (existing) existing.uses++;
        else legMap.set(key, { a, b, uses: 1 });
      }
    }
  }

  return { routes, legs: [...legMap.values()] };
}
