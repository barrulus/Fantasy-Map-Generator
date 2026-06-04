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

  // Reset non-manual roles so regeneration is idempotent.
  for (const b of burgs) {
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
