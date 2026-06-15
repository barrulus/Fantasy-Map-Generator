import type { Burg } from "../modules/burgs-generator";

/** Distinct non-space glyphs across all live burg names (skips burg[0] + removed). */
export function collectGlyphs(burgs: Burg[]): Set<string> {
  const set = new Set<string>();
  for (const b of burgs) {
    if (!b || !b.i || b.removed || !b.name) continue;
    for (const ch of b.name) if (ch !== " ") set.add(ch);
  }
  return set;
}

/**
 * Felzenszwalb & Huttenlocher 1-D squared Euclidean distance transform.
 * Input: f[i] = 0 where the feature is present, large (≈1e20) where absent.
 * Output: squared distance from each cell to the nearest feature cell.
 */
export function edt1d(f: ArrayLike<number>): Float64Array {
  const n = f.length;
  const d = new Float64Array(n);
  const v = new Int32Array(n); // locations of parabolas in lower envelope
  const z = new Float64Array(n + 1); // boundaries between parabolas
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }
  return d;
}
