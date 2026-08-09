import { minmax } from "./numberUtils";

// Pan/zoom transform for a fixed viewport whose content is viewport-sized at k=1
// (the burg-editor preview iframe). Transform maps content px c to viewport px c*k + offset.

export interface PanZoom {
  k: number;
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 32;
export const PAN_ZOOM_IDENTITY: PanZoom = { k: 1, x: 0, y: 0 };

// Keep the scaled content covering the whole viewport: no gaps at any edge.
export function clampPanZoom({ k, x, y }: PanZoom, viewport: Viewport): PanZoom {
  return {
    k,
    x: minmax(x, viewport.width * (1 - k), 0),
    y: minmax(y, viewport.height * (1 - k), 0)
  };
}

// Rescale by factor keeping the content point under `point` (viewport px) fixed.
export function zoomAt(t: PanZoom, point: { x: number; y: number }, factor: number, viewport: Viewport): PanZoom {
  const k = minmax(t.k * factor, MIN_ZOOM, MAX_ZOOM);
  const ratio = k / t.k;
  return clampPanZoom({ k, x: point.x - (point.x - t.x) * ratio, y: point.y - (point.y - t.y) * ratio }, viewport);
}

export function panBy(t: PanZoom, dx: number, dy: number, viewport: Viewport): PanZoom {
  return clampPanZoom({ k: t.k, x: t.x + dx, y: t.y + dy }, viewport);
}
