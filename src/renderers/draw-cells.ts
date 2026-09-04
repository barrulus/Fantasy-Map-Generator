import { ensureEl } from "@/utils";

// One path for every cell breaks GPU rasterization somewhere past 250K cells: Chromium drops the
// draw and the layer goes blank. Bounded paths keep each draw op within what the raster handles.
const CELLS_PER_PATH = 50000;

export function drawCells(): void {
  const isGridMode = customization === 1; // the heightmap editor works on the grid graph
  const cellIds = (isGridMode ? grid.cells.i : pack.cells.i) as ArrayLike<number>;
  const getPolygon = isGridMode
    ? (cellId: number) => Grid.getPolygon(cellId)
    : (cellId: number) => Pack.getPolygon(cellId);

  const paths: string[] = [];
  for (let start = 0; start < cellIds.length; start += CELLS_PER_PATH) {
    let d = "";
    const end = Math.min(start + CELLS_PER_PATH, cellIds.length);
    for (let i = start; i < end; i++) d += `M${getPolygon(cellIds[i])}`;
    paths.push(/* html */ `<path d="${d}" />`);
  }
  ensureEl("cells").innerHTML = paths.join("");
}
