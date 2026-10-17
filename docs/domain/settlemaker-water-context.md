# Settlemaker measured settlement water

FMG implements the sender side of Settlemaker's `water-context-v1` contract
(`settlemaker/docs/water-context-v1.md`, revision `8ebc23a`). The renderer must
implement that contract before this mode is enabled.

## Rollout

`VITE_SETTLEMAKER_WATER_CONTEXT_URL` is a build-time opt-in. Leave it unset for
normal production builds until a deployed Settlemaker release explicitly supports
water-context v1 for both villages and cities. An old decoder ignores the new field and can still
invent a nearby shore from the legacy bearing.

To exercise a supporting local renderer:

```sh
VITE_SETTLEMAKER_WATER_CONTEXT_URL=http://127.0.0.1:5173/fmg npm run dev
```

Production endpoints must use HTTPS and the `/fmg` path, without a query or
fragment. Pin the supporting renderer release in the deployment and configure
its endpoint when building FMG. This option routes both embedded and external
settlement previews to the same URL. Every positive population uses the measured
contract when enabled, including cities. Leaving the endpoint unset retains the
existing production integration.

Villages initially survey 3 km; cities initially survey 4 km. These are starting
coverage envelopes, not guarantees of sufficient land for every settlement.
Set `VITE_SETTLEMAKER_WATER_SURVEY_RADIUS_M=6000` to request a larger envelope for
a deployment, or pass `{surveyRadiusM: 6000}` as the second argument to
`createSettlemakerPreview` for an individual request. The explicit request takes
precedence. Radius values must be finite and at least 3000 metres.

The renderer checks its actual planning extent and reports `water-coverage-exceeded`
with `requiredSurveyRadiusM` when it needs more geography. Use that value for a
new request; FMG does not automatically receive or retry cross-origin renderer
errors. Export, compression and URL-budget failures remain visible in the burg
editor and on external-open attempts. Increasing coverage can exceed the URL
budget; it never silently replaces measured geometry with a bearing.

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
  0.5 m. Do not round or simplify exported coordinates. Reject ambiguous narrow
  or crossing curved shores instead of silently changing local topology.
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
  Detailed river courses share the existing URL budget and fail explicitly
  when too large; no course is silently removed or simplified.
- For ports, send `harbourWaterKind` from the adjacent haven feature, or `river`
  for an inland river port, with `harbourRiverId` from the burg cell's river ID.
  This association prevents selecting an unrelated nearby river. A downstream
  ocean ID does not turn a river port
  into an ocean harbour. This identifies the local water type, not bathymetry
  or a military role; FMG's `Naval` burg type only means it is a port.
- Keep the compressed `i` envelope. If the encoded payload exceeds 8192 bytes,
  compression fails, or geometry cannot be surveyed safely, show the failure
  in the burg editor and on an external-open attempt. Do not discard measured
  state by falling back to a flat URL.

Surveys extending beyond the map rectangle fail explicitly; wrapped geography
is not inferred. Very detailed coasts can exceed the URL budget. There is no
automatic simplification or resurvey in this implementation.

## Renderer handoff and validation

Settlemaker owns water-union bank queries, metric layout, bounded planning,
frame/coverage validation, input precedence and visible iframe diagnostics.
The FMG sender does not implement those renderer behaviors or an iframe message
protocol. Before enabling production, verify those behaviors against the
supporting release in both embedded and external-open flows.

Focused tests cover distance/units, finite lakes and islands, peninsula geometry,
curve inclusion and precision, narrow channels, union shore measurement, crop
closures, unknown units, missing local river widths, saved geometry invalidation,
URL-budget failures, population 1000/1001, Tetlapan-sized and large city payloads,
larger survey radii, local harbour-water classification, river source/mouth width
differences, width-unit invariance, edited courses and coastal river payloads. The 11,115 m
Tarrimas-Ha case is synthetic geography reproducing the measured distance; it
does not replay the original Borteland save.

Browser validation with the sender enabled covered 394 generated villages:
391 encoded successfully, including 34 with water, and three correctly failed
the URL budget. Saving/reloading with hidden water layers retained the exact
saved boundary and surveying left displayed paths untouched. These checks used
a local URL target to inspect payloads, not a running measured-water renderer.
The older 1.112.1 map fixture also retained its saved boundary through loading
and a subsequent measured survey.
