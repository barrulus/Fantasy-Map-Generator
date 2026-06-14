const TILE = 64; // px per tile (atlas raster resolution)
const COLS = 8; // 8x8 = up to 64 group tiles

export interface AtlasTile {
  tileIndex: number;
  size: number; // map-unit diameter (group font-size)
}
export interface BurgAtlas {
  canvas: HTMLCanvasElement;
  tiles: Record<string, AtlasTile>; // by group name
  cols: number;
  rows: number;
  tile: number;
}

// Serialize one group's symbol to an <svg> data URL using the live #icon-* symbol
// content + the group's current fill/stroke/stroke-width, sized to fill the tile.
function symbolSVG(symbolId: string, fill: string, stroke: string, strokeWidth: number): string {
  const sym = document.getElementById(symbolId.replace(/^#/, ""));
  const viewBox = sym?.getAttribute("viewBox") || "0 0 10 10";
  const inner = sym?.innerHTML || `<circle cx="0" cy="0" r="5"/>`;
  // viewBox "0 0 10 10" with shapes centered at the origin (e.g. circle cx0 cy0 r5):
  // shift the viewBox to -w/2..w/2 so the centered symbol is fully visible.
  const [, , vbw, vbh] = viewBox.split(/\s+/).map(Number);
  const vb = `${-vbw / 2} ${-vbh / 2} ${vbw} ${vbh}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="${vb}">` +
    `<g fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}">${inner}</g></svg>`
  );
}

function loadImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

// Build the atlas for all current #burgIcons groups. Reads live <g> attributes.
export async function buildBurgAtlas(): Promise<BurgAtlas> {
  const groupEls = Array.from(document.querySelectorAll<SVGGElement>("#burgIcons > g"));
  const rows = Math.max(1, Math.ceil(groupEls.length / COLS));
  const canvas = document.createElement("canvas");
  canvas.width = COLS * TILE;
  canvas.height = rows * TILE;
  const ctx = canvas.getContext("2d")!;
  const tiles: Record<string, AtlasTile> = {};

  await Promise.all(
    groupEls.map(async (g, idx) => {
      const symbolId = g.dataset.icon || g.querySelector("use")?.getAttribute("href") || "#icon-circle";
      const fill = g.getAttribute("fill") || "#ffffff";
      const stroke = g.getAttribute("stroke") || "#000000";
      const sw = +(g.getAttribute("stroke-width") || 1);
      const fontSize = parseFloat(getComputedStyle(g).fontSize) || 2; // map-unit diameter
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      tiles[g.id] = { tileIndex: idx, size: fontSize };
      try {
        const img = await loadImage(symbolSVG(symbolId, fill, stroke, sw));
        ctx.drawImage(img, col * TILE, row * TILE, TILE, TILE);
      } catch {
        // symbol failed to load — fall back to a plain circle tile so the burg still shows
        const img = await loadImage(symbolSVG("#icon-circle", fill, stroke, sw));
        ctx.drawImage(img, col * TILE, row * TILE, TILE, TILE);
      }
    })
  );

  return { canvas, tiles, cols: COLS, rows, tile: TILE };
}
