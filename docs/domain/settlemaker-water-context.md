# Settlemaker measured settlement water

FMG implements the sender side of Settlemaker's `water-context-v1` contract
(`settlemaker/docs/water-context-v1.md`). The production renderer supports this
contract for both villages and cities.

## Rollout

Normal builds export measured water to `https://settlemaker.com/fmg` by default.
`VITE_SETTLEMAKER_WATER_CONTEXT_URL` is an optional build-time endpoint override,
not an enable switch. An unset or empty override uses the production endpoint.
This prevents river ports from being exported as ocean-bearing-only previews.

To exercise a supporting local renderer:

```sh
VITE_SETTLEMAKER_WATER_CONTEXT_URL=http://127.0.0.1:5173/fmg npm run dev
```

Production endpoints must use HTTPS and the `/fmg` path, without a query or
fragment. Any custom endpoint must support water-context v1 for both villages
and cities. Both embedded and external settlement previews use the same URL,
and every positive population uses the measured contract. Previously saved
bearing-only URLs cannot recover river geometry; reopen the burg preview from
the source map to create a new URL.

Villages initially reserve 6 km. Cities start at 8 km and scale with population
(16 km for 173,976 residents, 26 km for 500,000). The reserve allows waterfront
alignment and development on both river banks. If an associated shore is farther
away, FMG searches within the map and surveys at least its measured distance plus
the reserve, rounded up to a kilometre. These remain coverage estimates, not
guarantees of sufficient land for every settlement.
Set `VITE_SETTLEMAKER_WATER_SURVEY_RADIUS_M=6000` to request a larger envelope for
a deployment, or pass `{surveyRadiusM: 6000}` as the second argument to
`createSettlemakerPreview` for an individual request. The explicit request takes
precedence. Radius values must be finite and at least 3000 metres.

The renderer checks its actual planning extent and reports `water-coverage-exceeded`
with `requiredSurveyRadiusM` when it needs more geography. Use that value for a
new request; FMG does not automatically receive or retry cross-origin renderer
errors. Export and compression failures remain visible in the burg editor and on
external-open attempts. Large encoded payloads use a URL fragment, keeping
geometry out of the HTTP request without dropping any water data.

## Sender behavior

- Survey the selected radius around the actual burg coordinates, independent of port
  status. Export its enclosing square as simple filled water pieces, with
  islands retained as dry land. Always include `coastlineGeometry`, including
  an explicit empty array for a dry survey. No simple-coast approximation is used.
- Use `Coastline.getFeaturePath`, shared with drawing and saving. Loading adopts
  the saved SVG boundary; surveying does not regenerate or mutate it. Map changes,
  coastline edits and coastline settings invalidate the geometry cache/index.
- Convert map coordinates once using the selected distance unit. Flatten curves
  adaptively within 0.2 m; report a conservative combined `geometryErrorM` of
  0.5 m. Pack adjacent fill pieces without filling islands or closing channels;
  remove collinear arithmetic noise and shorten coordinate tails to five decimal
  metres only when edge contacts, crossings and rings remain unchanged. Reserve
  the rounding error within the geometry budget and retain full precision when
  those checks fail. Reject ambiguous narrow or crossing curved shores instead
  of silently changing local topology.
- Measure exposed real shores from the same flattened boundary that supplies
  the polygons. Shared piece edges and survey-square closures are not banks.
  If real shores lie beyond coverage, search the canonical full boundary.
- Unsupported custom units produce `unknown-units`, with no metric geometry.
  FMG currently has no custom metres-per-unit setting.
- Apply FMG's Catmull-Rom alpha 0.1 interpolation to the complete edited/meandered
  centre anchors before clipping, with `courseSource: "fmg-catmull-rom-0.1"`
  and `meander: false`. Capture full-precision cubic controls, flatten local
  curves adaptively to 0.2 m, then quantize exported river coordinates to 0.01 m
  (at most 0.0071 m extra error). Conservative cubic control hulls include bends
  entering coverage even when their anchor chords remain outside. No new random
  bends are introduced. This shares FMG's smoothing family, but does not claim
  equality with the midpoint of separately offset and rounded painted banks.
- Evaluate the existing physical width model at every original course point
  using cumulative discharge and the full-course point index. Convert those
  kilometre-valued model widths with `* 1000`; map-unit conversion applies only
  to coordinates. Interpolate widths linearly in each cubic segment's parameter
  at adaptive stations, retaining the original anchor widths. `widthsM` carries
  this profile and `widthM` is its nearest-burg fallback. Neither uses
  `River.width`, which only describes the mouth.
- River widths are estimates, identified by `widthSource: "fmg-local-width-model"`.
  Settlemaker reports `water-river-width-modelled` and approximate water status.
  The geometry tolerance covers coast/lake geometry and interpolated centreline, not estimated river banks or agreement with the painted river
  boundary or its visual midline.
  The displayed river outline has illustrative map-unit offsets and is not
  relabelled as physical survey geometry. Missing or zero local model widths
  retain `omittedRivers` warnings instead of inventing a width.
- Survey all river courses for intersections, including crossings whose cell
  centres fall outside the context window. Crop courses beyond the selected
  survey square plus four maximum half-widths and one metre, matching the
  consumer's capped bank miters at sharp bends, so artificial
  endpoints cannot become local banks. Interpolate widths at crop points and
  keep disconnected reentries as separate runs with the original river ID.
  Associated rivers are surveyed around their nearest source reach even when
  marker displacement puts them outside the ordinary burg survey. Coordinates
  remain in the original burg-local frame. Available positive-width reaches are
  retained when an associated river has an unavailable source tip; omitted tips
  still produce a width warning.
- Send `waterfront` independently of port status. Prefer the river in the burg's
  cell, otherwise the nearest immediate neighbouring river cell. Include
  `riverId`, plus `shoreKind` and `shoreFeatureId` for an adjacent ocean or lake.
  These semantic relationships let Settlemaker align water with the settlement
  while retaining its measured source geometry and recording the approximation.
  A cartographic marker offset is not a physical river-bank clearance.
- For ports, send `harbourWaterKind` from the adjacent haven feature, or `river`
  for an inland river port, with `harbourRiverId` from that associated river.
  This association prevents selecting an unrelated nearby river. A downstream
  ocean ID does not turn a river port
  into an ocean harbour. This identifies the local water type, not bathymetry
  or a military role; FMG's `Naval` burg type only means it is a port.
- Keep the compressed version-1 `i` envelope. Geometry uses
  `geometryEncoding: "xy-tuples"`: coast vertices and river centreline points are
  lossless `[x, y]` pairs. Encoded values up to 8192 characters use `?i=`, larger
  values use `#i=` for both embedded and external previews. Compression or survey
  failures remain visible; there is no geometry-dropping flat-URL fallback.

Surveys extending beyond the map rectangle fail explicitly; wrapped geography
is not inferred. The associated-shore search is bounded by the available map
rectangle and fails explicitly if the named feature cannot be found. Detailed
geometry is preserved through fragment transport without automatic simplification.

## Renderer handoff and validation

Settlemaker owns water-union bank queries, metric layout, bounded planning,
frame/coverage validation, input precedence and visible iframe diagnostics.
The FMG sender does not implement those renderer behaviors or an iframe message
protocol. Verify those behaviors against the supporting release in both
embedded and external-open flows when changing the integration.

Focused tests cover distance/units, finite lakes and islands, peninsula geometry,
curve inclusion and precision, narrow channels, union shore measurement, crop
closures, unknown units, missing local river widths, saved geometry invalidation,
query/fragment transport, compact geometry, population 1000/1001, Tetlapan-sized and large city payloads,
larger survey radii, local harbour-water classification, river source/mouth width
differences, width-unit invariance, edited courses and coastal river payloads. The 11,115 m
Tarrimas-Ha case is synthetic geography reproducing the measured distance; it
does not replay the original Borteland save.

Earlier browser validation, before fragment transport, covered 394 generated
villages: 391 encoded successfully, including 34 with water, and three exceeded
the former URL budget. Saving/reloading with hidden water layers retained the exact
saved boundary and surveying left displayed paths untouched. These checks used
a local URL target to inspect payloads, not a running measured-water renderer.
The older 1.112.1 map fixture also retained its saved boundary through loading
and a subsequent measured survey.

The Lougy regressions preserve Hasingsbury's non-port river, Newcester's original
river despite a 20 km marker displacement, Kinglewes's river/coast association,
and Helster's river port. Shore-search tests cover a coast 19 km beyond the marker
and a missing named feature. Complete emitted URLs are also checked against the
Settlemaker decoder and renderer during integration validation.
