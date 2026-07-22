export interface CollisionBox {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  weight: number;
}

/**
 * Greedy, priority-ordered rectangle collision resolution: sort boxes by weight (higher wins),
 * then walk the sorted list keeping placed boxes and dropping any that overlaps one already
 * placed. Pure and fully recomputed on every call — no memory between calls, so a box that lost
 * a contested spot in one call can win it back in the next once its neighbour is gone.
 *
 * Touching edges (e.g. one box's `right` equal to another's `left`) do NOT count as a collision —
 * overlap requires strictly positive intersection on both axes.
 *
 * Ties in weight are broken by `id` (ascending) so the result is deterministic regardless of the
 * order boxes are passed in.
 */
export function selectNonOverlapping(boxes: CollisionBox[]): Set<string> {
  const sorted = [...boxes].sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const placed: CollisionBox[] = [];
  const kept = new Set<string>();

  for (const box of sorted) {
    let collides = false;
    for (const p of placed) {
      if (box.left < p.right && box.right > p.left && box.top < p.bottom && box.bottom > p.top) {
        collides = true;
        break;
      }
    }
    if (collides) continue;

    kept.add(box.id);
    placed.push(box);
  }

  return kept;
}

// public/main.js is a classic script and can only reach TS through globals.
if (typeof window !== "undefined") {
  Object.assign(window, { selectNonOverlapping });
}
