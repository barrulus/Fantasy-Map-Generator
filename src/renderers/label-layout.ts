export interface GlyphMetric {
  advance: number; // em
  u0: number;
  v0: number;
  u1: number;
  v1: number; // atlas-pixel rect of this glyph's cell
}

export interface FontGeometry {
  cellEm: number; // glyph cell width/height in em (same for every glyph of a font)
  originXEm: number; // em from cell-left edge to the pen origin
  baselineYEm: number; // em from cell-top edge down to the baseline
}

export interface LabelQuad {
  x: number;
  y: number; // top-left in map units
  w: number;
  h: number; // size in map units
  u0: number;
  v0: number;
  u1: number;
  v1: number; // atlas px
}

export interface LaidOutLabel {
  quads: LabelQuad[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Lay out one label as per-glyph textured quads, centered horizontally on (anchorX, anchorY)
 * with the baseline at anchorY. fontSize is map-units-per-em. Pure: no DOM, no GL.
 */
export function layoutLabel(
  text: string,
  metrics: Record<string, GlyphMetric>,
  geom: FontGeometry,
  fontSize: number,
  anchorX: number,
  anchorY: number
): LaidOutLabel {
  const chars = [...text].filter(ch => metrics[ch]);
  let totalAdvance = 0;
  for (const ch of chars) totalAdvance += metrics[ch].advance;

  const cell = geom.cellEm * fontSize;
  const originX = geom.originXEm * fontSize;
  const baselineY = geom.baselineYEm * fontSize;

  let penX = anchorX - (totalAdvance * fontSize) / 2;
  const quads: LabelQuad[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const ch of chars) {
    const m = metrics[ch];
    const x = penX - originX;
    const y = anchorY - baselineY;
    quads.push({ x, y, w: cell, h: cell, u0: m.u0, v0: m.v0, u1: m.u1, v1: m.v1 });
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + cell > maxX) maxX = x + cell;
    if (y + cell > maxY) maxY = y + cell;
    penX += m.advance * fontSize;
  }

  if (!quads.length) {
    minX = maxX = anchorX;
    minY = maxY = anchorY;
  }
  return { quads, minX, minY, maxX, maxY };
}
