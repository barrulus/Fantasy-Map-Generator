# Settlemaker measured village water

FMG implements the sender side of Settlemaker's `water-context-v1` contract
(`settlemaker/docs/water-context-v1.md`, revision `8ebc23a`). The renderer must
implement that contract before this mode is enabled.

## Rollout

`VITE_SETTLEMAKER_WATER_CONTEXT_URL` is a build-time opt-in. Leave it unset for
normal production builds until a deployed Settlemaker release explicitly supports
water-context v1 for villages. An old decoder ignores the new field and can still
invent a nearby shore from the legacy bearing.

To exercise a supporting local renderer:

```sh
VITE_SETTLEMAKER_WATER_CONTEXT_URL=http://127.0.0.1:5173/fmg npm run dev
```

Production endpoints must use HTTPS and the `/fmg` path, without a query or
fragment. Pin the supporting renderer release in the deployment and configure
its endpoint when building FMG. This option routes both embedded and external
village previews to the same URL. Population 1–1000 uses the new contract;
cities continue using the existing production URL and payload.

## Sender behavior

- Survey a 3 km radius around the actual burg coordinates, independent of port
  status. Export the enclosing 6 km square as simple filled water pieces, with
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
- Local river widths are unavailable from the burg context. Omit river surveys
  and identify context rivers through `omittedRivers`; never substitute the
  kilometre-valued river mouth width for the width beside the burg.
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
URL-budget failures, and population 1000/1001 rollout boundaries. The 11,115 m
Tarrimas-Ha case is synthetic geography reproducing the measured distance; it
does not replay the original Borteland save.

Browser validation with the sender enabled covered 394 generated villages:
391 encoded successfully, including 34 with water, and three correctly failed
the URL budget. Saving/reloading with hidden water layers retained the exact
saved boundary and surveying left displayed paths untouched. These checks used
a local URL target to inspect payloads, not a running measured-water renderer.
The older 1.112.1 map fixture also retained its saved boundary through loading
and a subsequent measured survey.
