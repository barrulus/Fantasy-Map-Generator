# Route rendering redesign — design

Written 2026-07-23. Goal: routes should read as a road network — a legible hierarchy from trunk
highways down to footpaths — instead of the fat dashed "noise" they become at town zoom today.

## Problem

Routes render into `#routes > g#{group} > g#{type} > path` (`drawRoutes`, `layers.js:861`). Two
faults make them noise:

1. **Everything scales with zoom.** Route paths live inside the zoom-transformed `#viewbox`, and
   nothing counteracts it (only the grid uses `vector-effect: non-scaling-stroke`). So a road's
   `stroke-width` and `stroke-dasharray` grow with the map: a `width 0.7 / dasharray 2` road with a
   butt linecap becomes a fat orange rectangle at town zoom. Trade routes (`width 1 / dash "3 2"`,
   near-black) become dark blocks.
2. **Dash character is per-group, not per-type.** Royal and main roads are solid (dasharray none),
   but market / town / local / trail / footpath all inherit the roads group's single `dasharray: 2`
   and differ only in width. A footpath and a market road look identical in kind.

The route *types* are not lost — the generator still assigns `royal, main, market, town, local,
trail, footpath` overland plus `feeder`/`trade` for sea and trade lanes
(`routes-generator.ts:819–1355`), and every preset still defines `#routes #royal … #footpath`. They
are simply rendered without visual differentiation and at a scale that turns them to ticks.

## Goal

Routes render at a **constant on-screen size** at every zoom, with a **per-type line character**
(solid → dashed → dotted by importance), so the hierarchy reads at a glance. Values live in the
style presets so they stay user-editable; the mechanic is what this work delivers.

Non-goal: changing how many routes are generated. This is rendering only.

## Design

### 1. Constant on-screen width — `non-scaling-stroke`

Every route path gets `vector-effect: non-scaling-stroke`. The path still moves and scales with the
map (roads stay glued to the terrain), but the stroke width and dash pattern are evaluated in screen
space, so they never balloon. A 2px royal road is 2px at every zoom; its dashes stay crisp.

Applied once via a CSS rule rather than per-path, so it costs nothing per redraw and cannot be
forgotten on a new route group:

```css
#routes path { vector-effect: non-scaling-stroke; }
```

Consequence: preset widths, currently in map units (0.15–0.98, hairline once non-scaling), are
retuned to screen pixels (below). This coupling is intentional — the mechanic and the values ship
together, or every route becomes a hairline.

### 2. Per-type line hierarchy (screen px)

Overland, in the `roads`/`trails` groups:

| Type | Width | Dash (screen px) | Character |
|---|---|---|---|
| royal | 2.0 | none | solid trunk |
| main | 1.4 | none | solid |
| market | 1.1 | `6 4` | long dash |
| town | 0.9 | `4 3` | medium dash |
| local | 0.7 | `2.5 2.5` | short dash |
| trail | 0.6 | `0.5 3` (round cap) | dotted |
| footpath | 0.5 | `0.5 2` (round cap) | fine dotted |

Special groups keep their identity, restyled to the same scale:

| Group | Width | Dash | Colour |
|---|---|---|---|
| searoutes | 0.8 | `1 4` (round cap) | white / pale blue |
| airroutes | 0.9 | `6 4` (round cap) | purple |
| traderoutes | 1.3 | `6 2 1 2` (dash-dot) | dark, slightly bolder |

Rule: **solid = major (royal, main); dashed = secondary with the dash shrinking as importance drops
(market → local); dotted = paths (trail, footpath).** Dotted types use `stroke-linecap: round` so a
`0.5`-length dash renders as a dot, not a sliver.

These are defaults/starting values. The user tunes them in the Style editor afterwards; the point of
this work is that the *mechanic* (non-scaling + per-type character) is in place.

### 3. Where the values live

- **Style presets** (`public/styles/*.json`): each carries `#routes #{type}` entries (widths, dash,
  cap) and the `#searoutes` / `#airroutes` / `#traderoutes` group entries. `default.json` is updated
  to the table above; the other presets are updated to match so a preset switch does not revert to
  the old fat look. (Presets that intentionally differ visually may diverge later — out of scope.)
- **Code fallback** (`applyRouteTypeStyle`, and the group style application): a built-in default map
  of the same values, applied when a preset omits a given type, so a stripped or custom preset still
  renders the hierarchy rather than falling back to the group default.

### 4. What does not change

- `drawRoutes` structure (`#routes > g#{group} > g#{type} > path`) is unchanged.
- Route generation, counts, and types are unchanged.
- The Skyburgs toggle hiding `#airroutes` and any layer on/off behaviour is unchanged.
- The Style editor still edits these attributes; it now edits screen-px values, which is what the
  user asked to tune.

## Testing

- **Pure-ish:** the default route-style map is a plain data structure; a unit test asserts every type
  the generator can emit (`royal, main, market, town, local, trail, footpath` + the three special
  groups) has a default width and dash, so a new route type can never render unstyled.
- **DOM:** a test that after `drawRoutes`, route paths resolve `vector-effect: non-scaling-stroke`
  and each type subgroup carries its distinct dash (i.e. market ≠ town ≠ trail, not all the group
  default).
- **Browser verification (required):** on a real map at town zoom, confirm routes render as thin
  crisp lines with a visible solid/dashed/dotted hierarchy, not fat ticks; and that zooming does not
  change their on-screen thickness. Screenshot before/after.

## Open items

- Screen-px values are a first calibration; expect one tuning pass once seen on a real map. The
  Style editor is the tuning surface, so no code change is needed to adjust them.
- Whether every one of the 12 presets is updated now or only the common ones is a plan-level call;
  the code fallback means an un-updated preset still renders correctly, just not pixel-tuned.
