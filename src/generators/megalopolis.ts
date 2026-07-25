import type { Burg } from "./burgs-generator";

// A megalopolis is DERIVED, never stored: all non-removed GROUND burgs sharing
// a cell, when there are >=2 of them. Flying burgs never join (they already
// stack freely over any cell and keep their own sky economy). The anchor is
// the cell's primary ground burg (pack.cells.burg[cell]); it holds the pooled
// treasury and hosts the market. See
// docs/superpowers/specs/2026-07-25-megalopolis-design.md

// Scale threshold: below -> one composite icon/label; at/above -> individual members.
export const MEGALOPOLIS_SPLIT_ZOOM = 4;
export const COMPOSITE_ICON_SCALE = 1.6;
export const RING_ICON_SCALE = 2.2;

export interface Megalopolis {
  cell: number;
  anchor: Burg;
  members: Burg[]; // ground burgs only, anchor first
  population: number; // sum over ground members
}

export function findMegalopolises(burgs: Burg[], cellsBurg: ArrayLike<number>): Map<number, Megalopolis> {
  const byCell = new Map<number, Burg[]>();
  for (const b of burgs) {
    if (!b || !b.i || b.removed || b.flying) continue; // ground burgs only
    const list = byCell.get(b.cell);
    if (list) list.push(b);
    else byCell.set(b.cell, [b]);
  }

  const megas = new Map<number, Megalopolis>();
  for (const [cell, list] of byCell) {
    if (list.length < 2) continue;
    const anchorId = cellsBurg[cell];
    if (!anchorId) continue; // stale slot; derive nothing rather than guess
    const anchor = list.find(b => b.i === anchorId);
    if (!anchor) continue; // stale slot; derive nothing rather than guess
    const members = [anchor, ...list.filter(b => b.i !== anchorId)];
    const population = members.reduce((sum, b) => sum + (b.population || 0), 0);
    megas.set(cell, { cell, anchor, members, population });
  }
  return megas;
}

export function groupedMemberIds(megas: Map<number, Megalopolis>): Set<number> {
  const ids = new Set<number>();
  for (const m of megas.values()) for (const b of m.members) if (b.i !== m.anchor.i) ids.add(b.i);
  return ids;
}

export function pooledPopulation(megas: Map<number, Megalopolis>): Map<number, number> {
  const pooled = new Map<number, number>();
  for (const m of megas.values()) pooled.set(m.anchor.i, m.population);
  return pooled;
}

export function megalopolisName(anchor: Burg): string {
  return `Greater ${anchor.name}`;
}

// Bridge for classic JS in public/ (main.js zoom hook, general.js tooltip).
declare global {
  var Megalopolis: {
    find: typeof findMegalopolises;
    memberIds: typeof groupedMemberIds;
    name: typeof megalopolisName;
    SPLIT_ZOOM: number;
  };
}
if (typeof window !== "undefined") {
  window.Megalopolis = {
    find: findMegalopolises,
    memberIds: groupedMemberIds,
    name: megalopolisName,
    SPLIT_ZOOM: MEGALOPOLIS_SPLIT_ZOOM
  };
}
