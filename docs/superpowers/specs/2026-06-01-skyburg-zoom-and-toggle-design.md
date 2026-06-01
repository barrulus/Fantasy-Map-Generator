# Skyburg Zoom Tiering & Toggle Design

## Goal

1. **Zoom tiering** — Skyburgs appear at zoom levels proportional to their population, using the same group-based `BURG_MIN_ZOOM` system that land burgs use.
2. **Layer toggle** — A single "Skyburgs" button in the layers panel hides/shows skyburg icons, labels, and air routes together.

## Background

The existing zoom-culling system works as follows:

- `BURG_MIN_ZOOM` in `public/main.js` maps group IDs to minimum zoom thresholds.
- Each burg is placed in an SVG sub-group matching its `group` property (e.g. `#burgIcons > g#city`).
- The zoom handler iterates sub-groups, reads `BURG_MIN_ZOOM[sub.id]` and hides/shows accordingly.
- The draw functions already handle arbitrary group names — no changes needed there.

Currently all skyburgs share `group: "skyburg"` with `BURG_MIN_ZOOM["skyburg"] = 4`, so every skyburg appears at the same zoom level regardless of size.

## Part 1: Population-based zoom tiering

### Population tiers

| Group | Population | Min zoom |
|-------|-----------|----------|
| `"skyburg"` | ≥ 800 | 4 (existing) |
| `"skyburg-mid"` | 400–799 | 6 |
| `"skyburg-small"` | < 400 | 8 |

These thresholds mirror land burg tiers: capital/city at 4, town at 6, fort/monastery at 7-8.

### Files changed

**`public/main.js`** — extend `BURG_MIN_ZOOM` with two new entries:

```javascript
const BURG_MIN_ZOOM = {
  states: 0,
  capital: 1, skyburg: 4, "skyburg-mid": 6, "skyburg-small": 8,
  city: 4, town: 6,
  fort: 7, monastery: 7, caravanserai: 7, trading_post: 7,
  village: 10, hamlet: 14
};
```

**`src/modules/burgs-generator.ts`** — in `generateSkyBurgs()`, after population is set on each new burg, assign `group` based on population:

```typescript
const skyburgGroup = (b: Burg) => {
  if (b.population >= 800) return "skyburg";
  if (b.population >= 400) return "skyburg-mid";
  return "skyburg-small";
};
// applied when constructing each skyburg object
```

No other files need changes. The zoom handler, `drawBurgIcons()`, `drawBurgLabels()`, and SVG group creation all operate on group names and require no modification.

### Backwards compatibility

Saved maps that have all skyburgs in `"skyburg"` still load and display correctly — they all appear at zoom 4 as before.

## Part 2: Skyburgs layer toggle

### Behaviour

- Button off (default): skyburg icons, labels, and air routes are hidden.
- Button on: all three are visible, subject to zoom thresholds from Part 1.
- Toggling does not affect land burg icons/labels or other route groups.

### Files changed

**`src/index.html`** — add `<li>` after the Routes button (around line 591):

```html
<li
  id="toggleSkyburgs"
  data-tip="Sky burgs and air routes: click to toggle, drag to raise or lower the layer"
  onclick="toggleSkyburgs(event)"
>
  Skyburgs
</li>
```

**`public/modules/ui/layers.js`** — add `toggleSkyburgs()` after `toggleRoutes()`, following the same pattern:

```javascript
function toggleSkyburgs(event) {
  if (!layerIsOn("toggleSkyburgs")) {
    turnButtonOn("toggleSkyburgs");
    // show icons
    burgIcons.selectAll("#skyburg, #skyburg-mid, #skyburg-small").style("display", null);
    // show labels
    burgLabels.selectAll("#skyburg, #skyburg-mid, #skyburg-small").style("display", null);
    // show air routes
    routes.select("#airroutes").style("display", null);
  } else {
    burgIcons.selectAll("#skyburg, #skyburg-mid, #skyburg-small").style("display", "none");
    burgLabels.selectAll("#skyburg, #skyburg-mid, #skyburg-small").style("display", "none");
    routes.select("#airroutes").style("display", "none");
    turnButtonOff("toggleSkyburgs");
  }
}
```

Also add a `getLayer` entry in `layers.js` so drag-to-reorder works:

```javascript
if (id === "toggleSkyburgs") return burgIcons;
```

### Layer presets

`toggleSkyburgs` is **not** added to any default preset — it is an optional custom layer. Users can include it in a custom preset via the existing preset mechanism.

### Load/save state

On map load, `layers.js` already calls `turnOn("toggleX")` for visible layers. Since skyburgs default to hidden, no load-time changes are needed. The hidden state persists across sessions via the existing layer state save mechanism.

## Out of scope

- Skyburg organic placement (separate spec, item 3)
- Hub-and-spoke air routes (separate spec, item 3)
- Air route zoom culling (no `ROUTE_MIN_ZOOM` entry for `airroutes` — acceptable for now)
