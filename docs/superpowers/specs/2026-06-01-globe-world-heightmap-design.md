# Globe World Heightmap Design

## Goal

Produce heightmap output suitable for wrapping onto a 3D globe (equirectangular, 2:1 aspect ratio):

1. **Edge continuity** — left and right edges of the map must be ocean so the antimeridian seam is invisible when the texture wraps around the sphere.
2. **Realistic elevation distribution** — most land should be plains/gentle hills (h=20–40); mountains are the exception, not the rule. Current templates produce too much high terrain and near-universal snowcaps.

## Approach

Two changes, both small in scope:

- **New `Power` template step** — exposes the existing `power` parameter in `HeightmapGenerator.modify()` as a first-class template tool. Allows a single curve to reshape the entire elevation histogram without touching individual hill heights.
- **New `globeWorld` template** — uses `Power` plus range-constrained primitives to guarantee ocean edges and an Earth-like elevation distribution.

## Part 1: `Power` step

### Files changed

- `src/modules/heightmap-generator.ts`

### Changes

Add `"Power"` to the `Tool` type union:

```typescript
type Tool = "Hill" | "Pit" | "Range" | "Trough" | "Strait" | "Mask" | "Invert" | "Add" | "Multiply" | "Smooth" | "Power";
```

Add one branch in `addStep()`, after the `"Multiply"` case:

```typescript
if (tool === "Power") {
  this.modify(a3, 0, 1, +a2);
  return;
}
```

### Template syntax

```
Power <exponent> <range>
```

- `exponent` — floating-point power applied to `(h - 20)` for land cells; values in `0.8–0.95` produce useful Earth-like compression.
- `range` — same as `Multiply`: `"land"`, `"all"`, or a numeric range like `"40-80"`.

### Elevation compression reference (Power 0.9, `land` range)

| Raw h | After Power 0.9 | Terrain type |
|-------|----------------|--------------|
| 100   | 57             | High peak    |
| 80    | 47             | Mountain     |
| 60    | 38             | Hill         |
| 40    | 34             | Low hill     |
| 30    | 28             | Plain        |
| 25    | 24             | Coastal flat |

The formula is `(h - 20) ** 0.9 + 20`. Low elevations (plains) are barely affected; high elevations are substantially compressed.

## Part 2: `globeWorld` template

### Files changed

- `public/config/heightmap-templates.js`

### Template string

```
Hill 1 75-85 22-38 20-80
Hill 1 75-85 62-78 20-80
Hill 4-5 15-25 20-80 15-85
Range 2-3 60-75 25-75 25-75
Smooth 2
Power 0.9 land
Mask 2
Smooth 3
```

### Step-by-step intent

| Step | Purpose |
|------|---------|
| `Hill 1 75-85 22-38 20-80` | Western continent nucleus, high initial peak, X constrained to 22–38% of map width |
| `Hill 1 75-85 62-78 20-80` | Eastern continent nucleus, symmetric |
| `Hill 4-5 15-25 20-80 15-85` | Low spreading hills that become plains after Power compression; X constrained to 20–80% |
| `Range 2-3 60-75 25-75 25-75` | Interior mountain ridges; both X and Y kept well inside map bounds |
| `Smooth 2` | Blend hills before compression to avoid sharp peaks |
| `Power 0.9 land` | Compress elevation histogram: peaks ~47–52, plains ~24–28 |
| `Mask 2` | Strong edge falloff — halves heights at left/right edges, pushing BFS residuals below h=20 (ocean threshold) |
| `Smooth 3` | Final blend for gradual coastlines |

### Edge guarantee

`Mask 2` applies `h * (1 + distance) / 2` where `distance = (1 - nx²)(1 - ny²)`:

- At x=0 (left/right edge): `distance = 0`, result = `h / 2`
- A residual cell at h=35 → 17.5 → ocean
- Combined with hill X-range constraints (20–80%), the outer 10% on each side receives no direct hill placement and is halved by Mask, reliably landing below h=20

### Elevation outcome

After `Power 0.9` + `Smooth 3`:

- Plains (low spreading hills h=15–25 → post-Power ~24–28, post-smooth ~24–32)
- Hills (continent nucleus falloff ~35–45)
- Mountains (range ridges h=60–75 → post-Power ~38–46)
- Peaks (nucleus cores h=75–85 → post-Power ~47–52)

No cells should reach h=70+ (the snowcap threshold in FMG's 3D renderer) under normal generation. Snowcaps only appear if `Math.random` skews to the top of the hill height range (85) at the nucleus center.

### Registration

Add to the return object in `heightmap-templates.js`:

```javascript
globeWorld: {id: 14, name: "Globe World", template: globeWorld, probability: 5},
```

`probability: 5` gives it roughly equal weight to `oldWorld` and `pangea` in random selection.

## Out of scope

- Winding order / GeoJSON normalization (separate concern)
- North/south edge continuity (polar caps are not visible seams on a globe; excluded by design)
- Toroidal Voronoi generation (full wrap-around cell boundaries; significant scope, deferred)
